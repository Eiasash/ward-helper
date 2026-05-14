/**
 * Department roster store — the "today's patients" snapshot imported
 * once at the start of rounds and consumed by Today.tsx + the batch
 * SOAP runner.
 *
 * Design choices (Phase D, PR #pending v1.38.0):
 *
 *   - Local-only. No cloud sync, no Supabase row. The roster is
 *     ephemeral by definition — re-imported each morning, replaced
 *     when next imported, auto-cleared after 24h via ageOutRoster()
 *     on app boot. If cross-device roster sync is ever needed, that's
 *     Phase F. Don't pre-build it.
 *
 *   - PR-B2.1: in scope for PHI-at-rest encryption (Adjustment 2C).
 *     Pre-B2.1 the doc said "plaintext at rest matches patients."
 *     B2.1's fresh-eye PHI-scope check (`crypto/phi.ts:10-12`) found
 *     that roster carries direct PHI (tz, name, room, dxShort) per
 *     the RosterPatient interface, same severity as the patients
 *     store. B2.1 wires the read seam (`getRoster` via
 *     decryptRowsIfEncrypted); B2.2 will land the write side + the
 *     staged-pattern refactor of ageOutRoster's read-then-delete tx.
 *
 *   - "Snapshot" semantics. setRoster(patients) is a clear-then-insert
 *     transaction: the daily roster doesn't accumulate, it gets replaced.
 *     A second import wipes the first. (If future workflows want
 *     additive imports, that's a UI concern — staged in the modal,
 *     committed as one setRoster call.)
 */

import { getDb } from './indexed';
import {
  decryptRowsIfEncrypted,
  isPhiEncryptV7Enabled,
  wrapRosterForWrite,
  type SealedRosterRow,
} from '@/crypto/phiRow';

const STORE = 'roster';

/** Lookback for the boot-time ageOut sweep. Older rows are dropped. */
export const ROSTER_AGE_OUT_MS = 24 * 60 * 60 * 1000;

export interface RosterPatient {
  /** Stable client-side id (crypto.randomUUID at import time). */
  id: string;
  /**
   * Israeli ת.ז. when extractable from the source. Null when the OCR
   * couldn't read it, the paste source omitted it, or the manual row
   * left it blank. Roster patients without a tz can still drive the
   * batch SOAP flow — the SOAP's own extract step recovers identity
   * from the clinical screenshots.
   */
  tz: string | null;
  name: string;
  age: number | null;
  sex: 'M' | 'F' | null;
  room: string | null;
  bed: string | null;
  losDays: number | null;
  dxShort: string | null;
  /** Provenance — useful for debug + future audit of import quality. */
  sourceMode: 'ocr' | 'paste' | 'manual';
  importedAt: number;
}

/**
 * Replace the entire roster with `patients`. Atomic: clears the store
 * and inserts new rows in a single readwrite transaction so a partial
 * write can't leave the user with a mix of old + new rows.
 */
export async function setRoster(patients: RosterPatient[]): Promise<void> {
  const db = await getDb();
  // PR-B2.2: setRoster is a PURE WRITER (not in the brief's 9-throw
  // enumeration because it never read first) but it writes to a store
  // in PHI scope. Under flag-on, each row needs wrapping. Pre-seal
  // out-of-tx so the readwrite clear+put tx contains no crypto await.
  const flagOn = isPhiEncryptV7Enabled();
  const writes: Array<RosterPatient | SealedRosterRow> = [];
  for (const p of patients) {
    writes.push(flagOn ? await wrapRosterForWrite(p) : p);
  }
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  for (const w of writes) {
    await tx.store.put(w);
  }
  await tx.done;
}

/**
 * List the current roster. Order is insertion order (matches what the
 * importer staged) — the modal preview-edit step is the place to
 * reorder if the doctor wants a different sort.
 */
export async function getRoster(): Promise<RosterPatient[]> {
  const db = await getDb();
  // PR-B2.1: cross the read seam. Same flag-off byte-equal pattern as
  // listPatients/listAllNotes — the helper's fast path returns the raw
  // array unchanged when no row is encrypted (B2.1's world).
  const rows = (await db.getAll(STORE)) as Array<RosterPatient | SealedRosterRow>;
  return decryptRowsIfEncrypted<RosterPatient>(rows, 'roster');
}

/** Empty the roster. Used by the modal's "discard" path + tests. */
export async function clearRoster(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}

/**
 * Drop rows older than `ROSTER_AGE_OUT_MS` (default 24h). Called on
 * app boot from App.tsx so a doctor who imports the roster Tuesday
 * morning and opens the app Wednesday morning doesn't see stale
 * patients. Cheap (<50 rows, full scan) — no need to index importedAt.
 *
 * Returns the number of rows dropped, primarily for tests; production
 * callers can ignore.
 */
export async function ageOutRoster(now: number = Date.now()): Promise<number> {
  const cutoff = now - ROSTER_AGE_OUT_MS;
  const db = await getDb();
  // PR-B2.2 Pattern-B staged delete. Phase 1 read, Phase 2 decrypt out-
  // of-tx (so `importedAt` is reachable even on sealed rows), Phase 3
  // readwrite-delete of expired rows. The 24h TTL must keep working
  // under flag-on or stale PHI lingers past the documented window.
  //
  // Atomicity downgrade vs the pre-B2.2 single-tx: a concurrent
  // setRoster call landing between Phase 1 and Phase 3 could re-import
  // a roster whose rows are all newer-than-cutoff; the Phase-3 deletes
  // then race against those fresh rows by id. In practice setRoster
  // and ageOutRoster don't run concurrently — ageOutRoster fires once
  // at boot, setRoster fires from the modal commit. UX-mitigated.
  const readTx = db.transaction(STORE, 'readonly');
  const rawRows = (await readTx.objectStore(STORE).getAll()) as Array<
    RosterPatient | SealedRosterRow
  >;
  await readTx.done;
  const rows = await decryptRowsIfEncrypted<RosterPatient>(rawRows, 'roster');
  const writeTx = db.transaction(STORE, 'readwrite');
  let dropped = 0;
  for (const r of rows) {
    if (r.importedAt < cutoff) {
      await writeTx.objectStore(STORE).delete(r.id);
      dropped++;
    }
  }
  await writeTx.done;
  return dropped;
}
