/**
 * PHI-at-rest one-shot backfill (PR-B2.2).
 *
 * Reads every patient/note/roster row that's still plaintext, seals it
 * via `sealRow`, and writes the sealed envelope back to disk. On success,
 * sets the durable `Settings.phiEncryptedV7 = true` sentinel and flips
 * the per-tab `localStorage.phi_encrypt_v7` flag — at which point every
 * new write through the storage layer's wrap-aware writers seals
 * automatically.
 *
 * Idempotent. Sentinel-gated: if `phiEncryptedV7 === true` is already
 * set, the runner re-flips the per-tab flag (in case localStorage was
 * wiped) and returns. If the runner is interrupted mid-sweep, the next
 * boot finds mixed plaintext+sealed state — the read seam reads both
 * fine, and the next runner pass picks up the still-plaintext rows.
 *
 * Failure handling: any thrown error (no key, decrypt failure on
 * already-sealed row from a different key, IDB quota) bubbles up; the
 * caller decides whether to swallow + retry next boot. The sentinel is
 * NOT set on failure, so the next boot retries automatically.
 *
 * Hazard discipline: the same tx-poison foot-gun that bit
 * `_stagedPatientUpdate` applies here. Every seal happens BEFORE the
 * relevant readwrite tx opens, so no `await crypto.subtle.encrypt` ever
 * runs inside an open tx.
 *
 * Ordering: this runs AFTER `runV1_40_0_BackfillIfNeeded` and AFTER
 * the PHI key has been derived + set via `setPhiKey`. Both ordering
 * invariants are enforced by the caller (`src/auth/phiUnlock.ts` for
 * warm + cold-start auth paths). Don't call this from module top-level
 * — it requires the in-memory PHI key.
 */

import { getDb, getSettings, patchSettings, type Patient, type Note } from './indexed';
import { hasPhiKey, sealRow } from '@/crypto/phi';
import {
  isEncryptedRow,
  setPhiEncryptV7Enabled,
  type SealedPatientRow,
  type SealedNoteRow,
  type SealedRosterRow,
} from '@/crypto/phiRow';
import type { RosterPatient } from './roster';

/**
 * Returns true if this install has completed the PHI backfill (durable
 * sentinel is set). Used by `phiUnlock.ts` to decide whether to render
 * the cold-start gate (sentinel set + no in-memory key = need unlock).
 */
export async function isPhiBackfillComplete(): Promise<boolean> {
  const settings = await getSettings();
  return settings?.phiEncryptedV7 === true;
}

async function backfillStore<TPlain extends { id: string }, TSealed>(
  storeName: 'patients' | 'notes' | 'roster',
  buildSealedRow: (plain: TPlain, sealed: Awaited<ReturnType<typeof sealRow>>) => TSealed,
): Promise<{ examined: number; sealed: number }> {
  const db = await getDb();

  // Phase 1 — readonly read.
  const readTx = db.transaction(storeName, 'readonly');
  const raw = (await readTx.objectStore(storeName).getAll()) as Array<TPlain | TSealed>;
  await readTx.done;

  // Phase 2 — seal plaintext rows OUT-of-tx (each seal awaits
  // crypto.subtle.encrypt). Skip rows already sealed (idempotency).
  const writes: TSealed[] = [];
  let examined = 0;
  for (const r of raw) {
    examined++;
    if (isEncryptedRow(r)) continue;
    const plain = r as TPlain;
    const sealed = await sealRow(plain);
    writes.push(buildSealedRow(plain, sealed));
  }

  if (writes.length === 0) return { examined, sealed: 0 };

  // Phase 3 — readwrite, sync writes only.
  const writeTx = db.transaction(storeName, 'readwrite');
  const writeStore = writeTx.objectStore(storeName);
  for (const w of writes) {
    await writeStore.put(w as unknown as Patient);
  }
  await writeTx.done;
  return { examined, sealed: writes.length };
}

export interface PhiBackfillReport {
  /** Total rows examined (sum across all three stores). */
  examined: number;
  /** Rows that were plaintext and got sealed in this pass. */
  sealed: number;
  /** Per-store breakdown for diagnostics. */
  byStore: {
    patients: { examined: number; sealed: number };
    notes: { examined: number; sealed: number };
    roster: { examined: number; sealed: number };
  };
  /** Whether the sentinel was set in this pass (true on first successful run). */
  sentinelSet: boolean;
}

/**
 * Run the PHI backfill. Idempotent — sentinel-gated. Returns a structured
 * report so the caller (boot diagnostic / breadcrumb log) can summarize.
 *
 * Order is patients → notes → roster. If any single-store backfill throws,
 * the function rejects without setting the sentinel — next boot retries.
 */
export async function runPhiBackfillIfNeeded(): Promise<PhiBackfillReport> {
  // Sentinel-gated: skip if already done.
  if (await isPhiBackfillComplete()) {
    // Defensive: re-flip the per-tab flag in case localStorage was wiped
    // (private window, profile reset). The sentinel is the source of
    // truth; the flag is the per-tab fast path.
    setPhiEncryptV7Enabled();
    return {
      examined: 0,
      sealed: 0,
      byStore: {
        patients: { examined: 0, sealed: 0 },
        notes: { examined: 0, sealed: 0 },
        roster: { examined: 0, sealed: 0 },
      },
      sentinelSet: false,
    };
  }

  // Key required — refuse to seal without one. Caller is supposed to
  // gate on hasPhiKey() before invoking, but defense-in-depth.
  if (!hasPhiKey()) {
    throw new Error('runPhiBackfillIfNeeded: no PHI key set');
  }

  const patients = await backfillStore<Patient, SealedPatientRow>(
    'patients',
    (p, enc) => ({ id: p.id, enc }),
  );
  const notes = await backfillStore<Note, SealedNoteRow>(
    'notes',
    (n, enc) => ({ id: n.id, patientId: n.patientId, enc }),
  );
  const roster = await backfillStore<RosterPatient, SealedRosterRow>(
    'roster',
    (r, enc) => ({ id: r.id, enc }),
  );

  // All three stores swept successfully — set the durable sentinel +
  // flip the per-tab flag in one operation. The sentinel is what
  // future boots read to decide whether to re-derive the key.
  await patchSettings({ phiEncryptedV7: true });
  setPhiEncryptV7Enabled();

  return {
    examined: patients.examined + notes.examined + roster.examined,
    sealed: patients.sealed + notes.sealed + roster.sealed,
    byStore: { patients, notes, roster },
    sentinelSet: true,
  };
}
