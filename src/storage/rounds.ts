import { getDb } from './indexed';
import type { Patient } from './indexed';
import { notifyDayArchived, notifyPatientsChanged } from '@/ui/hooks/glanceableEvents';
import {
  decryptRowIfEncrypted,
  decryptRowsIfEncrypted,
  isEncryptedRow,
  isPhiEncryptV7Enabled,
  wrapPatientForWrite,
  type SealedPatientRow,
} from '@/crypto/phiRow';

export const SNAPSHOT_HISTORY_CAP = 20;

export interface DaySnapshot {
  id: string; // YYYY-MM-DD; primary key
  date: string; // duplicates id for clarity
  archivedAt: number; // ms timestamp
  patients: Patient[]; // frozen copy (discharged ones included per Aux 2)
}

export async function putDaySnapshot(snap: DaySnapshot): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('daySnapshots', 'readwrite');
  const store = tx.objectStore('daySnapshots');
  await store.put(snap);
  // Cap to last SNAPSHOT_HISTORY_CAP by archivedAt ascending.
  const all = (await store.getAll()) as DaySnapshot[];
  if (all.length > SNAPSHOT_HISTORY_CAP) {
    const sorted = [...all].sort((a, b) => a.archivedAt - b.archivedAt);
    const toDelete = sorted.slice(0, all.length - SNAPSHOT_HISTORY_CAP);
    for (const s of toDelete) await store.delete(s.id);
  }
  await tx.done;
}

export async function listDaySnapshots(): Promise<DaySnapshot[]> {
  const db = await getDb();
  const all = (await db.getAll('daySnapshots')) as DaySnapshot[];
  return all.sort((a, b) => b.archivedAt - a.archivedAt); // newest first
}

export const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

/**
 * Archive today's roster: snapshot the current `patients` table into
 * `daySnapshots` keyed by today's date (YYYY-MM-DD), then clear `planToday`
 * on every live patient. The snapshot freezes `planToday` BEFORE the clear so
 * yesterday's plans are recoverable. Same-date re-archive replaces the prior
 * snapshot (Q5b), enforced by upsert-on-id semantics.
 *
 * Atomicity: the snapshot put + per-patient clears all run inside a single
 * multi-store IDB transaction (`daySnapshots` + `patients`, readwrite). If
 * any operation fails, the entire transaction aborts — neither the snapshot
 * nor the clears persist, so re-running is genuinely safe (cf. the original
 * bug where a partial clear with a persisted snapshot could be overwritten
 * with corrupted data on retry).
 *
 * Sets `localStorage.LAST_ARCHIVED_KEY = today` and dispatches
 * `ward-helper:day-archived` after the tx commits.
 */
export async function archiveDay(): Promise<DaySnapshot> {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const archivedAt = Date.now();
  const db = await getDb();

  // PR-B2.2 Pattern-C staged multi-store pattern. The pre-B2.2 version
  // ran getAll + structuredClone + put + per-patient clears inside one
  // [daySnapshots, patients] readwrite tx. That worked when patients
  // were plaintext, but B2.2's reseal-on-write would inject
  // `crypto.subtle.encrypt` awaits inside the tx and poison it.
  //
  // Three phases:
  //   Phase 1 — readonly tx on patients, get all raw rows, close tx.
  //   Phase 2 — out-of-tx: decrypt-if-encrypted, then PRE-SEAL each
  //             planToday-clear write (so the Phase-3 tx contains no
  //             non-IDB awaits).
  //   Phase 3 — readwrite multi-store tx, write snapshot + sealed
  //             (or plaintext) patient updates.
  //
  // daySnapshots stays plaintext at rest per the carve-out
  // (`src/crypto/phi.ts` header) — the snapshot's `patients` field is a
  // structuredClone of the DECRYPTED array, not of sealed rows. Downstream
  // consumers (MorningArchivePrompt, dayContinuity) read this field as
  // Patient[], not SealedPatientRow[].
  //
  // Atomicity downgrade (DELIBERATE — flag for future reader): another
  // patient-mutation (e.g. a tomorrow-note add) landing between Phase 1
  // and Phase 3 will appear in the post-clear patient row but NOT in the
  // frozen snapshot. Single-tab single-user UX bounds this; archiveDay
  // has exactly 2 call sites (`MorningArchivePrompt::handleArchive` and
  // `handleConfirmReplace`) both gated on user button taps.

  // Phase 1 — readonly read.
  const readTx = db.transaction('patients', 'readonly');
  const rawPatients = (await readTx.objectStore('patients').getAll()) as Array<
    Patient | SealedPatientRow
  >;
  await readTx.done;

  // Phase 2 — decrypt out-of-tx.
  const patients = await decryptRowsIfEncrypted<Patient>(rawPatients, 'patient');

  // Phase 2b — pre-seal every planToday-clear write so Phase 3 has no
  // crypto await. Only patients with non-empty planToday need a write;
  // every other row is unchanged.
  const flagOn = isPhiEncryptV7Enabled();
  const writes: Array<{ value: Patient | SealedPatientRow }> = [];
  for (const p of patients) {
    if (p.planToday !== '') {
      const next: Patient = { ...p, planToday: '', updatedAt: archivedAt };
      writes.push({
        value: flagOn ? await wrapPatientForWrite(next) : next,
      });
    }
  }

  // Frozen snapshot of the DECRYPTED patients array — daySnapshots carve-
  // out leaves these plaintext at rest.
  const snapshot: DaySnapshot = {
    id: today,
    date: today,
    archivedAt,
    patients: structuredClone(patients),
  };

  // Phase 3 — readwrite multi-store tx; sync writes only.
  const writeTx = db.transaction(['daySnapshots', 'patients'], 'readwrite');
  const snapshotsStore = writeTx.objectStore('daySnapshots');
  const patientsStore = writeTx.objectStore('patients');

  await snapshotsStore.put(snapshot);
  const allSnaps = (await snapshotsStore.getAll()) as DaySnapshot[];
  if (allSnaps.length > SNAPSHOT_HISTORY_CAP) {
    const sorted = [...allSnaps].sort((a, b) => a.archivedAt - b.archivedAt);
    const toDelete = sorted.slice(0, allSnaps.length - SNAPSHOT_HISTORY_CAP);
    for (const s of toDelete) await snapshotsStore.delete(s.id);
  }

  for (const w of writes) {
    await patientsStore.put(w.value);
  }

  await writeTx.done;

  localStorage.setItem(LAST_ARCHIVED_KEY, today);
  notifyDayArchived();
  notifyPatientsChanged();
  return snapshot;
}

const BACKFILL_KEY = 'ward-helper.v1_40_0_backfilled';

export async function runV1_40_0_BackfillIfNeeded(): Promise<void> {
  if (localStorage.getItem(BACKFILL_KEY) === '1') return;
  try {
    const db = await getDb();
    //
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PR-B2.1 STAGED CURSOR PATTERN — explicit per the design pin
    //   (`.audit_logs/2026-05-14-pr-b2-design-pins.md` §"Cursor staged-
    //    pattern"). The B2.1 fresh-eye round 2 (Q2) confirmed: the
    //   `idb` library's contract is "do NOT await other things between
    //   the start and end of your transaction." The pre-B2.1 single-tx
    //   cursor only awaited IDB-internal operations (cursor.update /
    //   continue). Decryption uses crypto.subtle.decrypt (a non-IDB
    //   Promise) and would poison the tx mid-iteration.
    //
    // The pattern:
    //   Phase 1 — readonly tx: open cursor, collect every row's raw
    //             value synchronously, close the tx.
    //   Phase 2 — out-of-tx: sniff each row. Under B2.1's expected
    //             world (no encrypted rows present yet) all rows are
    //             plaintext and we proceed. Encrypted rows would
    //             require decrypt + re-seal which lands in B2.2; B2.1
    //             aborts with a clear error rather than silently
    //             downgrading sealed rows to plaintext.
    //   Phase 3 — readwrite tx: apply the v1.40.0 backfill mutation
    //             (default fields) and write each row back.
    //
    // Under B2.1's world this is end-state-identical to the prior
    // single-tx version. The staging adds two-tx overhead but the
    // function runs at most once per install (BACKFILL_KEY gate), so
    // the cost is paid exactly once and is irrelevant.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Phase 1 — readonly tx, collect rows.
    const readTx = db.transaction('patients', 'readonly');
    const readStore = readTx.objectStore('patients');
    const collected: Array<Patient | SealedPatientRow> = [];
    let cursor = await readStore.openCursor();
    while (cursor) {
      collected.push(cursor.value as Patient | SealedPatientRow);
      cursor = await cursor.continue();
    }
    await readTx.done;

    // Phase 2 — out-of-tx classification + decryption. Under B2.1 every
    // row was plaintext; B2.2 replaces the abort-on-encrypted branch with
    // decrypt-and-continue, so v1.40.0 backfill can re-run even after the
    // PHI backfill has sealed some rows (e.g. a fresh schema migration
    // landing AFTER the PHI flag is on).
    const decryptedRows = await Promise.all(
      collected.map((r) =>
        isEncryptedRow(r)
          ? decryptRowIfEncrypted<Patient>(r, 'patient')
          : Promise.resolve(r as Patient),
      ),
    );
    if (decryptedRows.some((r) => r === null)) {
      throw new Error(
        'runV1_40_0_BackfillIfNeeded: decrypt failed on some rows',
      );
    }
    const rows = decryptedRows as Patient[];

    // Phase 2b — pre-compute (and pre-seal if flag on) every write so
    // the Phase-3 tx contains no non-IDB awaits. Same discipline as
    // archiveDay's Pattern-C staging.
    const flagOn = isPhiEncryptV7Enabled();
    const writeValues: Array<Patient | SealedPatientRow> = [];
    for (const p of rows) {
      const next: Patient = {
        ...p,
        discharged: p.discharged ?? false,
        tomorrowNotes: p.tomorrowNotes ?? [],
        handoverNote: p.handoverNote ?? '',
        planLongTerm: p.planLongTerm ?? '',
        planToday: p.planToday ?? '',
        clinicalMeta: p.clinicalMeta ?? {},
      };
      writeValues.push(flagOn ? await wrapPatientForWrite(next) : next);
    }

    // Phase 3 — readwrite tx, sync IDB writes only.
    const writeTx = db.transaction('patients', 'readwrite');
    const writeStore = writeTx.objectStore('patients');
    for (const v of writeValues) {
      await writeStore.put(v);
    }
    await writeTx.done;

    localStorage.setItem(BACKFILL_KEY, '1');
  } catch (err) {
    // Don't set marker on failure — retries next boot.
    // Reads tolerate missing fields via ?? defaults at every read site.
    console.warn('[rounds] v1.40.0 backfill failed; will retry next boot', err);
  }
}

/**
 * Pattern-A staged-update helper (PR-B2.2). Shared by the 5 patient-mutation
 * sites in this file (dischargePatient, unDischargePatient, addTomorrowNote,
 * dismissTomorrowNote, promoteToHandover) — each of which reduces to "read
 * one patient, mutate it, write it back." The shape was documented by the
 * brief's Pattern A pseudocode; this helper is the single source of truth.
 *
 * The staging:
 *   Phase 1 — readonly tx, get the raw row, close tx.
 *   Phase 2 — out-of-tx: decrypt if encrypted (`crypto.subtle.decrypt` is a
 *             non-IDB Promise and would poison a still-open tx).
 *   Phase 3 — readwrite tx, mutate + reseal-if-flagged + put, close tx.
 *
 * Atomicity downgrade (DELIBERATE — flag for future reader): the pre-B2.2
 * single-tx pattern held the readonly lock through the write, preventing a
 * "two concurrent calls read the same row and both append" race. The
 * staged version reintroduces that race. ward-helper is single-tab single-
 * user per CLAUDE.md so concurrent double-tap is UX-mitigated (button
 * disabled while in-flight, no parallel tabs), and the brief explicitly
 * accepts this trade. Do NOT "fix" by reopening a multi-step single-tx —
 * that would re-poison the tx with decrypt-await.
 */
async function _stagedPatientUpdate(
  patientId: string,
  caller: string,
  mutator: (p: Patient) => Patient,
): Promise<void> {
  const db = await getDb();
  // Phase 1 — readonly tx, get raw row.
  const readTx = db.transaction('patients', 'readonly');
  const raw = (await readTx.objectStore('patients').get(patientId)) as
    | Patient
    | SealedPatientRow
    | undefined;
  await readTx.done;
  if (!raw) throw new Error(`Patient ${patientId} not found`);
  // Phase 2 — decrypt out-of-tx.
  const p: Patient | null | undefined = isEncryptedRow(raw)
    ? await decryptRowIfEncrypted<Patient>(raw, 'patient')
    : (raw as Patient);
  if (!p) {
    throw new Error(`${caller}: decrypt failed on patient ${patientId}`);
  }
  // Phase 3a — mutate + pre-seal (if flag on) BEFORE opening writeTx.
  // Doing `await wrapPatientForWrite(next)` after `db.transaction(...)`
  // returns would await crypto.subtle.encrypt inside the open tx, the
  // microtask queue would yield, and the tx would close before .put()
  // fires (TransactionInactiveError). Same discipline as archiveDay
  // Phase 2b and the runV1_40_0_BackfillIfNeeded cursor.
  const next = mutator(p);
  const valueToWrite: Patient | SealedPatientRow = isPhiEncryptV7Enabled()
    ? await wrapPatientForWrite(next)
    : next;
  // Phase 3b — readwrite tx, sync writes only.
  const writeTx = db.transaction('patients', 'readwrite');
  await writeTx.objectStore('patients').put(valueToWrite);
  await writeTx.done;
}

/**
 * Mark a patient as discharged. Records `dischargedAt = Date.now()` so the UI
 * can sort/show discharged-today rosters and so re-admit (`unDischargePatient`)
 * can compute the gap.
 *
 * Atomicity: now uses the staged Pattern-A helper. See helper docblock for
 * the deliberate atomicity downgrade vs the pre-B2.2 single-tx version.
 */
export async function dischargePatient(patientId: string): Promise<void> {
  await _stagedPatientUpdate(patientId, 'dischargePatient', (p) => {
    const now = Date.now();
    return { ...p, discharged: true, dischargedAt: now, updatedAt: now };
  });
  notifyPatientsChanged();
}

/**
 * Reverse a discharge: clear `discharged` + `dischargedAt`, and append a
 * Hebrew re-admit line to `handoverNote` so the next shift sees context.
 * Caller passes `gapDays` (days between discharge and re-admit) and a free-text
 * `reason` (e.g. "re-admission via capture", a complaint, a note from the ER).
 *
 * Atomicity: the read+write run inside a single `readwrite` transaction so two
 * concurrent calls (e.g. doctor double-tap) can't both read the same `p` and
 * both compute their own appended line — the second write would otherwise
 * silently lose the first's appended line.
 */
export async function unDischargePatient(
  patientId: string,
  gapDays: number,
  reason: string,
): Promise<void> {
  await _stagedPatientUpdate(patientId, 'unDischargePatient', (p) => {
    const today = new Date().toLocaleDateString('en-CA');
    const reAdmitLine = `חזר לאשפוז ב-${today} לאחר ${gapDays} ימים: ${reason}`;
    const newHandoverNote = p.handoverNote
      ? `${p.handoverNote}\n${reAdmitLine}`
      : reAdmitLine;
    return {
      ...p,
      discharged: false,
      dischargedAt: undefined,
      handoverNote: newHandoverNote,
      updatedAt: Date.now(),
    };
  });
  notifyPatientsChanged();
}

/**
 * Append a single ephemeral "tomorrow" note line to a patient. These lines
 * are surfaced on the morning rounds screen and can be dismissed (forgotten)
 * or promoted into the durable `handoverNote` once the work has actually
 * happened.
 *
 * Atomicity: read+write inside one `readwrite` tx so two concurrent calls
 * (e.g. doctor double-tap or dictation hitting twice) can't both read the
 * same `p` and overwrite each other's appended line.
 */
export async function addTomorrowNote(patientId: string, text: string): Promise<void> {
  await _stagedPatientUpdate(patientId, 'addTomorrowNote', (p) => ({
    ...p,
    tomorrowNotes: [...(p.tomorrowNotes ?? []), text],
    updatedAt: Date.now(),
  }));
  notifyPatientsChanged();
}

/**
 * Drop a single ephemeral tomorrow-note line by index. Used when the
 * underlying todo no longer applies (e.g. labs were resulted overnight).
 *
 * Atomicity: read+write inside one `readwrite` tx so a concurrent
 * `addTomorrowNote` / `promoteToHandover` can't be silently clobbered by
 * a stale `p` snapshot.
 */
export async function dismissTomorrowNote(patientId: string, lineIdx: number): Promise<void> {
  await _stagedPatientUpdate(patientId, 'dismissTomorrowNote', (p) => {
    const next = (p.tomorrowNotes ?? []).filter((_, i) => i !== lineIdx);
    return { ...p, tomorrowNotes: next, updatedAt: Date.now() };
  });
  notifyPatientsChanged();
}

/**
 * Promote an ephemeral tomorrow-note line into the durable `handoverNote`:
 * append it (newline-separated) and remove it from `tomorrowNotes` in the
 * same tx so the line never appears in both places.
 *
 * Out-of-bounds `lineIdx` throws explicitly — symmetric with the
 * patient-not-found branch. Silent no-ops would let UI in PR 3 swallow
 * stale-state bugs (clinical-safety rule: don't hide confusion).
 *
 * Atomicity: critical here because the operation reads `handoverNote` AND
 * `tomorrowNotes`, mutates both, and writes them together. A non-tx version
 * would risk losing an appended handover line on a concurrent write.
 */
export async function promoteToHandover(patientId: string, lineIdx: number): Promise<void> {
  await _stagedPatientUpdate(patientId, 'promoteToHandover', (p) => {
    const lines = p.tomorrowNotes ?? [];
    const line = lines[lineIdx];
    if (line === undefined) {
      // Out-of-bounds index throws explicitly — symmetric with the
      // patient-not-found branch in the helper. The mutator throw
      // propagates cleanly: Phase 1's readTx is already closed, the
      // writeTx hasn't opened yet, so nothing is left dangling.
      throw new Error(
        `Patient ${patientId} tomorrowNotes[${lineIdx}] not found (length: ${lines.length})`,
      );
    }
    const nextHandover = (p.handoverNote ?? '') + (p.handoverNote ? '\n' : '') + line;
    const nextTomorrow = lines.filter((_, i) => i !== lineIdx);
    return {
      ...p,
      handoverNote: nextHandover,
      tomorrowNotes: nextTomorrow,
      updatedAt: Date.now(),
    };
  });
  notifyPatientsChanged();
}
