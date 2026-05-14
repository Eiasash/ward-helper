import { getDb } from './indexed';
import type { Patient } from './indexed';
import { notifyDayArchived, notifyPatientsChanged } from '@/ui/hooks/glanceableEvents';
import {
  isEncryptedRow,
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

  const tx = db.transaction(['daySnapshots', 'patients'], 'readwrite');
  const snapshotsStore = tx.objectStore('daySnapshots');
  const patientsStore = tx.objectStore('patients');

  // Read live patients within the same tx (consistency).
  // PR-B2.1: sync-sniff-inside-tx. Under flag-off + no encrypted rows
  // (B2.1's world) every row is plaintext, fast path runs identical to
  // today. Under premature flag-on we throw — archiveDay's structuredClone
  // would otherwise produce a daySnapshot containing encrypted-shaped
  // rows that downstream consumers (MorningArchivePrompt, dayContinuity)
  // expect to be plaintext. B2.2 will refactor this into the staged
  // multi-store pattern: read patients out, close tx, decrypt out-of-tx,
  // reopen multi-store tx for the snapshot put + planToday clears.
  // daySnapshots itself stays plaintext at rest per the carve-out
  // (`src/crypto/phi.ts` header — cloud-side already encrypted, local-rest
  // threat model assumes OS disk encryption).
  const rawPatients = (await patientsStore.getAll()) as Array<Patient | SealedPatientRow>;
  if (rawPatients.some((r) => isEncryptedRow(r))) {
    throw new Error(
      'archiveDay: encountered encrypted patient row but B2.2 staged multi-store pattern not yet wired at this site',
    );
  }
  const patients = rawPatients as Patient[];

  // Frozen copy — capture planToday BEFORE clearing. structuredClone
  // isolates the returned snapshot from any future caller mutation
  // (ward-helper targets es2022, which has structuredClone in all
  // supported runtimes including the test env).
  const snapshot: DaySnapshot = {
    id: today,
    date: today,
    archivedAt,
    patients: structuredClone(patients),
  };

  // Snapshot write + cap (mirrors putDaySnapshot's logic, inlined so the
  // whole archive runs inside one tx — calling putDaySnapshot here would
  // open a second tx and break atomicity).
  await snapshotsStore.put(snapshot);
  const allSnaps = (await snapshotsStore.getAll()) as DaySnapshot[];
  if (allSnaps.length > SNAPSHOT_HISTORY_CAP) {
    const sorted = [...allSnaps].sort((a, b) => a.archivedAt - b.archivedAt);
    const toDelete = sorted.slice(0, allSnaps.length - SNAPSHOT_HISTORY_CAP);
    for (const s of toDelete) await snapshotsStore.delete(s.id);
  }

  // Clear planToday for all live patients (skip rows already empty).
  for (const p of patients) {
    if (p.planToday !== '') {
      await patientsStore.put({ ...p, planToday: '', updatedAt: archivedAt });
    }
  }

  await tx.done;

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

    // Phase 2 — out-of-tx classification. The staging exists explicitly
    // so we can do non-IDB work here without poisoning the tx. Under
    // B2.1 every row is plaintext (flag-off, no encrypted rows present).
    // If we encounter an encrypted row, abort — re-sealing requires
    // wrapPatientForWrite which lands in B2.2.
    if (collected.some((r) => isEncryptedRow(r))) {
      throw new Error(
        'runV1_40_0_BackfillIfNeeded: encountered encrypted patient row but B2.2 re-seal-on-write not yet wired at this site',
      );
    }
    const plaintextRows = collected as Patient[];

    // Phase 3 — readwrite tx, apply mutations.
    const writeTx = db.transaction('patients', 'readwrite');
    const writeStore = writeTx.objectStore('patients');
    for (const p of plaintextRows) {
      await writeStore.put({
        ...p,
        discharged: p.discharged ?? false,
        tomorrowNotes: p.tomorrowNotes ?? [],
        handoverNote: p.handoverNote ?? '',
        planLongTerm: p.planLongTerm ?? '',
        planToday: p.planToday ?? '',
        clinicalMeta: p.clinicalMeta ?? {},
      });
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
 * Mark a patient as discharged. Records `dischargedAt = Date.now()` so the UI
 * can sort/show discharged-today rosters and so re-admit (`unDischargePatient`)
 * can compute the gap.
 *
 * Atomicity: the read+write run inside a single `readwrite` transaction so a
 * concurrent caller can't observe a stale row between get and put. Mirrors
 * `unDischargePatient` for consistency even though `dischargePatient` itself
 * doesn't have a read-modify-write hazard (its writes are absolute, not
 * additive).
 */
export async function dischargePatient(patientId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('patients', 'readwrite');
  const store = tx.objectStore('patients');
  // PR-B2.1 sync-sniff-inside-tx (see design pin). Throw on encrypted —
  // B2.2 lands the staged read+decrypt+reseal+write pattern.
  const raw = (await store.get(patientId)) as Patient | SealedPatientRow | undefined;
  if (!raw) {
    await tx.done;
    throw new Error(`Patient ${patientId} not found`);
  }
  if (isEncryptedRow(raw)) {
    await tx.done;
    throw new Error(
      `dischargePatient: encrypted patient row ${patientId} but B2.2 staged-pattern not yet wired at this site`,
    );
  }
  const p = raw;
  const now = Date.now();
  await store.put({
    ...p,
    discharged: true,
    dischargedAt: now,
    updatedAt: now,
  });
  await tx.done;
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
  const db = await getDb();
  const tx = db.transaction('patients', 'readwrite');
  const store = tx.objectStore('patients');
  // PR-B2.1 sync-sniff-inside-tx (see design pin). See dischargePatient
  // for the rationale; same pattern repeats at every read-then-write tx
  // site until B2.2 replaces with staged-pattern.
  const raw = (await store.get(patientId)) as Patient | SealedPatientRow | undefined;
  if (!raw) {
    await tx.done;
    throw new Error(`Patient ${patientId} not found`);
  }
  if (isEncryptedRow(raw)) {
    await tx.done;
    throw new Error(
      `unDischargePatient: encrypted patient row ${patientId} but B2.2 staged-pattern not yet wired at this site`,
    );
  }
  const p = raw;
  const today = new Date().toLocaleDateString('en-CA');
  const reAdmitLine = `חזר לאשפוז ב-${today} לאחר ${gapDays} ימים: ${reason}`;
  const newHandoverNote = p.handoverNote
    ? `${p.handoverNote}\n${reAdmitLine}`
    : reAdmitLine;
  await store.put({
    ...p,
    discharged: false,
    dischargedAt: undefined,
    handoverNote: newHandoverNote,
    updatedAt: Date.now(),
  });
  await tx.done;
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
  const db = await getDb();
  const tx = db.transaction('patients', 'readwrite');
  const store = tx.objectStore('patients');
  // PR-B2.1 sync-sniff-inside-tx (see design pin).
  const raw = (await store.get(patientId)) as Patient | SealedPatientRow | undefined;
  if (!raw) {
    await tx.done;
    throw new Error(`Patient ${patientId} not found`);
  }
  if (isEncryptedRow(raw)) {
    await tx.done;
    throw new Error(
      `addTomorrowNote: encrypted patient row ${patientId} but B2.2 staged-pattern not yet wired at this site`,
    );
  }
  const p = raw;
  await store.put({
    ...p,
    tomorrowNotes: [...(p.tomorrowNotes ?? []), text],
    updatedAt: Date.now(),
  });
  await tx.done;
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
  const db = await getDb();
  const tx = db.transaction('patients', 'readwrite');
  const store = tx.objectStore('patients');
  // PR-B2.1 sync-sniff-inside-tx (see design pin).
  const raw = (await store.get(patientId)) as Patient | SealedPatientRow | undefined;
  if (!raw) {
    await tx.done;
    throw new Error(`Patient ${patientId} not found`);
  }
  if (isEncryptedRow(raw)) {
    await tx.done;
    throw new Error(
      `dismissTomorrowNote: encrypted patient row ${patientId} but B2.2 staged-pattern not yet wired at this site`,
    );
  }
  const p = raw;
  const next = (p.tomorrowNotes ?? []).filter((_, i) => i !== lineIdx);
  await store.put({ ...p, tomorrowNotes: next, updatedAt: Date.now() });
  await tx.done;
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
  const db = await getDb();
  const tx = db.transaction('patients', 'readwrite');
  const store = tx.objectStore('patients');
  // PR-B2.1 sync-sniff-inside-tx (see design pin).
  const raw = (await store.get(patientId)) as Patient | SealedPatientRow | undefined;
  if (!raw) {
    await tx.done;
    throw new Error(`Patient ${patientId} not found`);
  }
  if (isEncryptedRow(raw)) {
    await tx.done;
    throw new Error(
      `promoteToHandover: encrypted patient row ${patientId} but B2.2 staged-pattern not yet wired at this site`,
    );
  }
  const p = raw;
  const lines = p.tomorrowNotes ?? [];
  const line = lines[lineIdx];
  if (line === undefined) {
    await tx.done;
    throw new Error(
      `Patient ${patientId} tomorrowNotes[${lineIdx}] not found (length: ${lines.length})`,
    );
  }
  const nextHandover = (p.handoverNote ?? '') + (p.handoverNote ? '\n' : '') + line;
  const nextTomorrow = lines.filter((_, i) => i !== lineIdx);
  await store.put({
    ...p,
    handoverNote: nextHandover,
    tomorrowNotes: nextTomorrow,
    updatedAt: Date.now(),
  });
  await tx.done;
  notifyPatientsChanged();
}
