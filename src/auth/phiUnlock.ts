/**
 * PHI key derivation orchestrator (PR-B2.2).
 *
 * Sits between the auth layer (login/register/cold-start) and the PHI
 * crypto layer. Owns the ordering invariant from the brief:
 *   PHI backfill runs AFTER successful login AND AFTER key derivation.
 *
 * Two entry points:
 *
 *   - `attemptPhiUnlock()` — for the WARM login/register subscriber and
 *     the COLD-start `loadPersistedLoginPassword` resolution. Reads the
 *     login password from in-memory stash; if none, this is a no-op
 *     (the cold-start gate UI handles the "logged in but no password
 *     in memory" case by prompting).
 *
 *   - `attemptPhiUnlockWithPassword(pwd)` — for the cold-start gate UI
 *     when the user types their password manually. Takes the password
 *     directly, stashes it (so subsequent ops like cloud-push find it),
 *     then runs the same derive+backfill pipeline.
 *
 * Both routes converge in `_deriveAndBackfill` which is the single
 * place that derives + sets the key + runs the sentinel-gated backfill.
 *
 * Failure modes:
 *   - No password available → returns 'no-password' (caller falls back).
 *   - Salt load fails (IDB error) → throws.
 *   - Derive fails (crypto error) → throws.
 *   - Backfill fails (decrypt-on-mixed-state, IDB error) → returns
 *     'backfill-failed' with the error attached.
 *
 * The function is named `attempt*` deliberately — it's best-effort and
 * the caller decides UX based on the return shape. A logged-in user with
 * no persisted password is not a fatal state; the cold-start gate
 * surfaces it.
 */

import {
  derivePhiKey,
  setPhiKey,
  clearPhiKey,
  hasPhiKey,
  loadOrCreatePhiSalt,
  unsealRow,
} from '@/crypto/phi';
import { clearDecryptFailureCount, isEncryptedRow } from '@/crypto/phiRow';
import { getDb } from '@/storage/indexed';
import {
  getLastLoginPasswordOrNull,
  stashLastLoginPassword,
  getCurrentUser,
} from './auth';
import {
  runPhiBackfillIfNeeded,
  type PhiBackfillReport,
} from '@/storage/phiBackfill';

export type PhiUnlockOutcome =
  | { kind: 'ok'; report: PhiBackfillReport }
  | { kind: 'no-user' }
  | { kind: 'no-password' }
  | { kind: 'already-unlocked' }
  | { kind: 'wrong-password' }
  | { kind: 'backfill-failed'; error: Error };

// ─── Probe (PR v1.46.1) ─────────────────────────────────────────────────
//
// Verifies the just-derived key against rows that are actually on disk.
// The cold-start manual-unlock path (`attemptPhiUnlockWithPassword`) has no
// server-side bcrypt check — without this probe, a mistyped password would
// silently set a wrong key, the sentinel-gated backfill would skip,
// `hasPhiKey()` would flip to true, the gate would clear, and the user's
// subsequent NEW writes (via the pure-writer paths `putPatient` / `putNote`
// / `setRoster`) would seal under the wrong key. After eventually logging
// back in with the correct password, those wrong-key rows would orphan
// permanently. This is the destructive failure mode v1.46.0 left open.
//
// Probe strategy (per the v1.46.1 review):
//   - Pull up to 3 sealed rows PER store across patients/notes/roster.
//     Multi-row sampling guards against the false-reject case where a
//     single row is genuinely corrupt (damaged ciphertext, not wrong key).
//   - Test isEncryptedRow first so a stray plaintext row (mixed-state
//     storage during a partial backfill on a different store) doesn't
//     enter the probe set and get misread as a key failure.
//   - One successful decrypt = key correct. Return 'verified' early —
//     no point exhausting the sample if we've already proven the key.
//   - Zero sealed rows in any store = nothing to verify against. Returns
//     'no-sealed-rows'. The caller (verify-mode) accepts this as a
//     DOCUMENTED RESIDUAL — see hotfix note in docs/audit/. Empty-PHI
//     cold-start is the one population the probe cannot protect; the
//     bake's station 6 measures it explicitly rather than assuming it.
//   - All samples failed AND at least one was sealed = wrong-key.
//
// Calls `unsealRow` directly (not `decryptRowIfEncrypted`) to avoid the
// user-facing `incrementDecryptFailureCount` side-effect — probe failures
// during password-typing aren't user-visible incidents.
async function _probeKeyAgainstSealedRows(): Promise<
  'verified' | 'no-sealed-rows' | 'wrong-key'
> {
  const db = await getDb();
  const SAMPLES_PER_STORE = 3;
  const sealedSamples: Array<{ iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> = [];
  const stores = ['patients', 'notes', 'roster'] as const;
  for (const storeName of stores) {
    const tx = db.transaction(storeName, 'readonly');
    const rows = (await tx.objectStore(storeName).getAll()) as unknown[];
    await tx.done;
    let count = 0;
    for (const r of rows) {
      if (!isEncryptedRow(r)) continue;
      sealedSamples.push(r.enc);
      count++;
      if (count >= SAMPLES_PER_STORE) break;
    }
  }
  if (sealedSamples.length === 0) return 'no-sealed-rows';
  for (const sealed of sealedSamples) {
    const result = await unsealRow(sealed);
    if (result !== null) return 'verified';
  }
  return 'wrong-key';
}

/**
 * Derive the PHI key from `password` + persisted salt, set it in memory,
 * (optionally) verify against on-disk sealed rows, then run the sentinel-
 * gated backfill.
 *
 * `verify` defaults to false — the warm-login paths
 * (`attemptPhiUnlock`) pass through a server-bcrypt-validated password
 * stash, so probe is redundant there. The cold-start manual path
 * (`attemptPhiUnlockWithPassword`) sets verify=true because the password
 * came directly from user typing without a server hop.
 *
 * Verify-mode fail-closed bias: false-reject (probe rejects a correct
 * password — e.g. all sampled rows are corrupt for reasons other than
 * wrong-key) is an annoyance the user recovers from by retyping; false-
 * accept (wrong key sealed over real data) is destructive.
 */
async function _deriveAndBackfill(
  password: string,
  verify: boolean = false,
): Promise<PhiUnlockOutcome> {
  const salt = await loadOrCreatePhiSalt();
  const key = await derivePhiKey(password, salt);
  setPhiKey(key);
  if (verify) {
    let probeResult: 'verified' | 'no-sealed-rows' | 'wrong-key';
    try {
      probeResult = await _probeKeyAgainstSealedRows();
    } catch (err) {
      // Probe-side IDB error. Fail-closed — clear the key and surface as
      // backfill-failed (honest "system error" rather than misattributed
      // as wrong-password). User retries; if it's a persistent IDB
      // problem, they'll see the same outcome and know it's not their
      // password.
      clearPhiKey();
      return {
        kind: 'backfill-failed',
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
    if (probeResult === 'wrong-key') {
      clearPhiKey();
      return { kind: 'wrong-password' };
    }
    // 'verified' or 'no-sealed-rows' → proceed. Note that the empty-store
    // case ('no-sealed-rows') is the DOCUMENTED RESIDUAL: with zero
    // sealed rows on disk, the probe has nothing to check against. The
    // user could be typing a wrong password and we'd accept it. This
    // narrows the destructive surface from "every cold-start manual
    // unlock with sealed rows" (which the probe now covers) to "cold-
    // start manual unlock on an install that's completed backfill but
    // currently has zero PHI rows" (extreme edge case). Station 6 of
    // the v1.46.1 bake measures this explicitly.
  }
  try {
    const report = await runPhiBackfillIfNeeded();
    return { kind: 'ok', report };
  } catch (err) {
    return {
      kind: 'backfill-failed',
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Default unlock path. No-ops if there's no current user or no in-memory
 * password. Idempotent: if a key is already set, returns 'already-unlocked'
 * without re-deriving.
 */
export async function attemptPhiUnlock(): Promise<PhiUnlockOutcome> {
  if (!getCurrentUser()) return { kind: 'no-user' };
  if (hasPhiKey()) return { kind: 'already-unlocked' };
  const password = getLastLoginPasswordOrNull();
  if (!password) return { kind: 'no-password' };
  return _deriveAndBackfill(password);
}

/**
 * Cold-start gate path. Used by the `Unlock.tsx` screen when the user
 * is logged in but their password isn't in memory (private-window
 * reload, profile reset). Stashes the password so subsequent cloud-push
 * calls find it.
 *
 * Returns the same outcome shape — backfill-failed is recoverable
 * (retry next boot), no-password is impossible (we just got it).
 */
export async function attemptPhiUnlockWithPassword(
  password: string,
): Promise<PhiUnlockOutcome> {
  if (!getCurrentUser()) return { kind: 'no-user' };
  stashLastLoginPassword(password);
  if (hasPhiKey()) return { kind: 'already-unlocked' };
  // verify=true: the cold-start gate's password came from user typing,
  // not from a server-bcrypt-verified stash. Probe against on-disk
  // sealed rows before declaring the key correct. See `_deriveAndBackfill`
  // docblock for the residual-on-empty-store note.
  return _deriveAndBackfill(password, true);
}

/**
 * Called from `auth.ts::logout`. Clears the in-memory PHI key so a
 * subsequent user logging in on the same device doesn't accidentally
 * inherit the previous user's decryption capability. The encrypted rows
 * on disk stay sealed — re-derivation works for the new user's password
 * + same salt (different key, different rows on next user, but that's
 * the post-Tier-2 multi-user story; today ward-helper is single-user-
 * per-device).
 *
 * Wrapped here so the import surface in `auth.ts` stays focused on auth
 * concerns; the auth file shouldn't know about PHI key internals.
 */
export function clearPhiKeyOnLogout(): void {
  clearPhiKey();
  // Reset the session-scoped decrypt-failure count too — different user
  // logging in next means no decrypt failures from the prior session
  // apply. If failures occur for the new user, the counter starts fresh.
  clearDecryptFailureCount();
}
