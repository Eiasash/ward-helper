/**
 * Orphan-canary guardrail.
 *
 * Why this exists: the canary blob has a fixed `blob_id = __canary__`, so
 * pushing a new canary unconditionally overwrites whatever was there. If
 * the user logs in with passphrase A but cloud data is encrypted with
 * passphrase B, the first save (or manual cloud push) overwrites B's
 * canary with A's — and after that, B's data is functionally
 * inaccessible: restoreFromCloud's fast-fail returns 'wrong-passphrase'
 * before ever attempting the bulk decrypt loop.
 *
 * Real incident — 2026-05-07 user diagnostic: 86 cloud rows existed,
 * canary.verify returned wrong-passphrase + ms:828 from the diag button,
 * and the canary had ALREADY been overwritten by an earlier cloudPush
 * armed with the new passphrase. The old data is still in Supabase but
 * locked behind a canary marker that no longer recognises the original
 * passphrase.
 *
 * Fix: before any canary push, do a session-level check. If existing
 * data is present AND the current passphrase doesn't decrypt the
 * existing canary, refuse the push. The old canary (and therefore the
 * old data's recoverability) is preserved. Caller surfaces the orphan
 * state to the UI so the user can decide.
 *
 * Cost: ONE extra `pullByUsername` on the first canary-push of a session.
 * Subsequent pushes use cached state. Acceptable for the safety win.
 */
import {
  pullAllBlobs,
  pullByUsername,
  verifyCanaryFromRows,
  CANARY_BLOB_ID,
} from '@/storage/cloud';
import { pushBreadcrumb } from '@/ui/components/MobileDebugPanel';

export type CanaryProtectionState = 'unknown' | 'safe' | 'orphan';

let state: CanaryProtectionState = 'unknown';
let inFlight: Promise<CanaryProtectionState> | null = null;

/**
 * Idempotent session-level check. First call does the network probe;
 * subsequent calls return the cached result. Concurrent callers wait on
 * the same in-flight check (no duplicate pulls).
 *
 * Returns 'safe' on any error path — we never lock the user out of pushes
 * due to a transient network blip. Errors are breadcrumbed for diagnostics.
 */
export async function checkCanaryProtection(
  passphrase: string,
  username: string | null,
): Promise<CanaryProtectionState> {
  if (state !== 'unknown') return state;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const rows = username && username.trim()
        ? await pullByUsername(username)
        : await pullAllBlobs();

      const nonCanaryCount = rows.filter(
        (r) => !(r.blob_type === 'canary' && r.blob_id === CANARY_BLOB_ID),
      ).length;

      if (nonCanaryCount === 0) {
        // No existing data → nothing to orphan, push is always safe.
        state = 'safe';
        pushBreadcrumb('canary.protection.checked', {
          result: 'safe',
          reason: 'no-existing-data',
        });
        return state;
      }

      const verifyStatus = await verifyCanaryFromRows(passphrase, rows);
      if (verifyStatus === 'wrong-passphrase') {
        state = 'orphan';
        pushBreadcrumb('canary.protection.checked', {
          result: 'orphan',
          orphanedRowCount: nonCanaryCount,
        });
      } else {
        // 'ok' or 'absent' (no canary in cloud yet) — safe to (re)arm.
        state = 'safe';
        pushBreadcrumb('canary.protection.checked', {
          result: 'safe',
          canary: verifyStatus,
        });
      }
      return state;
    } catch (err) {
      // Conservative: prefer letting the push proceed over locking the
      // user out on a network hiccup. The caller's normal error path
      // surfaces transient failures via breadcrumb separately.
      state = 'safe';
      pushBreadcrumb('canary.protection.checkfail', { error: String(err) });
      return state;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Read-only accessor for UI. Used by Settings/Today to show a banner when
 * orphan state is detected.
 */
export function getCanaryProtectionState(): CanaryProtectionState {
  return state;
}

/**
 * Explicit user override: "I understand my old cloud data won't be
 * recoverable — push anyway." Wired to a Settings button. Transitions
 * 'orphan' → 'safe', allowing subsequent canary pushes to proceed.
 */
export function clearOrphanProtection(): void {
  if (state === 'orphan') {
    state = 'safe';
    pushBreadcrumb('canary.protection.override');
  }
}

/** Test-only reset. Production code never calls this. */
export function _resetCanaryProtectionForTests(): void {
  state = 'unknown';
  inFlight = null;
}
