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
} from '@/crypto/phi';
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
  | { kind: 'backfill-failed'; error: Error };

async function _deriveAndBackfill(password: string): Promise<PhiUnlockOutcome> {
  const salt = await loadOrCreatePhiSalt();
  const key = await derivePhiKey(password, salt);
  setPhiKey(key);
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
  return _deriveAndBackfill(password);
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
}
