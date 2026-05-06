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
 *   - Plaintext at rest in IndexedDB. Matches the existing posture for
 *     the `patients` and `notes` stores in indexed.ts — the per-repo
 *     CLAUDE.md invariant is "no plaintext PHI **leaves the device**",
 *     not "no plaintext PHI exists at rest." Roster rows live in IDB
 *     in the same threat model as `patients`.
 *
 *   - "Snapshot" semantics. setRoster(patients) is a clear-then-insert
 *     transaction: the daily roster doesn't accumulate, it gets replaced.
 *     A second import wipes the first. (If future workflows want
 *     additive imports, that's a UI concern — staged in the modal,
 *     committed as one setRoster call.)
 */

import { getDb } from './indexed';

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
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  for (const p of patients) {
    await tx.store.put(p);
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
  return (await db.getAll(STORE)) as RosterPatient[];
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
  const tx = db.transaction(STORE, 'readwrite');
  const rows = (await tx.store.getAll()) as RosterPatient[];
  let dropped = 0;
  for (const r of rows) {
    if (r.importedAt < cutoff) {
      await tx.store.delete(r.id);
      dropped++;
    }
  }
  await tx.done;
  return dropped;
}
