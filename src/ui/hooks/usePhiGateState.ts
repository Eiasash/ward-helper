/**
 * usePhiGateState — derives the cold-start PHI-unlock-gate state.
 *
 * Four states:
 *   - `loading`  : initial async check in flight; render nothing
 *                  (or a thin loading affordance — the gate is rare).
 *   - `guest`    : not logged in. No PHI gate ever applies.
 *   - `unlocked` : logged in AND (key in memory OR no sealed data on
 *                  disk). Routes can render normally.
 *   - `locked`   : logged in AND sealed data on disk AND no key in
 *                  memory. The Unlock screen must render IN PLACE OF
 *                  the routes.
 *
 * Re-derives on every `'ward-helper:auth'` (login/logout/register) and
 * every `'ward-helper:phi-key'` (set/clear) event. The boot useEffect's
 * `attemptPhiUnlock` chain sets the key on success — when that lands,
 * the phi-key event flips us from `locked` → `unlocked` and the gate
 * auto-disappears without manual orchestration.
 */
import { useEffect, useState } from 'react';
import { getCurrentUser, subscribeAuthChanges } from '@/auth/auth';
import { hasPhiKey, subscribePhiKeyChanges } from '@/crypto/phi';
import { isPhiBackfillComplete } from '@/storage/phiBackfill';

export type PhiGateState = 'loading' | 'guest' | 'unlocked' | 'locked';

export function usePhiGateState(): PhiGateState {
  const [state, setState] = useState<PhiGateState>('loading');

  useEffect(() => {
    let cancelled = false;
    async function recompute(): Promise<void> {
      const user = getCurrentUser();
      if (!user) {
        if (!cancelled) setState('guest');
        return;
      }
      if (hasPhiKey()) {
        if (!cancelled) setState('unlocked');
        return;
      }
      // No key in memory. If no sealed data on disk, the user can use the
      // app freely; new writes won't seal until the backfill completes
      // (which can't happen without a key, but no rows need it yet).
      const sealed = await isPhiBackfillComplete();
      if (cancelled) return;
      setState(sealed ? 'locked' : 'unlocked');
    }
    void recompute();
    const unAuth = subscribeAuthChanges(() => { void recompute(); });
    const unKey = subscribePhiKeyChanges(() => { void recompute(); });
    return () => {
      cancelled = true;
      unAuth();
      unKey();
    };
  }, []);

  return state;
}
