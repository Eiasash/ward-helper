/**
 * PostLoginRestorePrompt — fresh-device discoverability for cloud restore.
 *
 * The 2026-04-30 v1.31.0 cross-device sync ship landed the wiring (push w/
 * username, pullByUsername RPC, auth-aware branching in restoreFromCloud)
 * but left a UX gap: a user logging in on a fresh device still has to walk
 * to Settings → type passphrase → tap Restore. The blobs land instantly
 * once they do, but the action isn't discoverable. SESSION_LEARNINGS_2026-
 * 04-30.md §1 documented this as the remaining ticketable follow-up.
 *
 * What this component does:
 *   - Listens for `ward-helper:auth` CustomEvents with `detail.action='login'`.
 *     Register events are ignored intentionally — a brand-new account has
 *     no cloud data to restore.
 *   - On login, checks `getDbStats()`. If the device already has any
 *     patients or notes locally, the prompt is suppressed (the user is
 *     on their normal device — auto-pulling would feel intrusive and is
 *     redundant since they already have their data; they can still
 *     manually pull from Settings if needed).
 *   - If the device is in zero-state AND the user hasn't been prompted
 *     before for this username on this device, surfaces a modal that
 *     asks for the cloud passphrase and runs `restoreFromCloud(p)`.
 *   - Either action (Restore or "Not now") sets a localStorage suppress
 *     marker keyed on the username so subsequent logins don't re-prompt.
 *
 * What this component does NOT do:
 *   - It never stores the passphrase. Mirrors the existing Settings
 *     restore card. The user will be re-prompted on the next zero-state
 *     login on a new device, which is the intended behaviour.
 *   - It does not gate any clinical functionality. It's purely additive.
 *   - It doesn't pre-decrypt or sample blobs to give a "X notes available"
 *     count — that would require the passphrase, which we don't have until
 *     they type it. The intro is intentionally vague about quantity.
 */

import { useEffect, useState } from 'react';
import {
  getCurrentUser,
  subscribeAuthChanges,
  type AuthChangeAction,
} from '@/auth/auth';
import { getDbStats } from '@/storage/indexed';
import { restoreFromCloud, type RestoreResult } from '@/notes/save';

const SUPPRESS_KEY_PREFIX = 'ward-helper.restore-prompted.';

/** Exported for tests so they can clear marker state between cases. */
export function _suppressKey(username: string): string {
  return SUPPRESS_KEY_PREFIX + username;
}

/**
 * Decide whether to surface the prompt for this user on this device.
 * Pure function so tests can pin the heuristic without mounting React.
 *
 * Returns false (skip) on:
 *   - any localStorage read error (defensive — never surface a prompt
 *     in a state where we can't honour later "don't show again")
 *   - prior prompt marker for this username
 *   - non-empty IndexedDB (the device already has data)
 *   - getDbStats throws (e.g. IDB unavailable in private mode) — fail
 *     silent, don't blow up the auth event handler
 */
export async function shouldPromptRestore(username: string): Promise<boolean> {
  if (!username) return false;
  try {
    if (localStorage.getItem(_suppressKey(username))) return false;
  } catch {
    return false;
  }
  try {
    const stats = await getDbStats();
    if (stats.notes > 0 || stats.patients > 0) return false;
  } catch {
    return false;
  }
  return true;
}

export function PostLoginRestorePrompt() {
  const [show, setShow] = useState(false);
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<RestoreResult | null>(null);

  useEffect(() => {
    let alive = true;
    const handler = async (action: AuthChangeAction) => {
      if (action !== 'login') return;
      const user = getCurrentUser();
      if (!user) return;
      if (!(await shouldPromptRestore(user.username))) return;
      if (!alive) return;
      setUsername(user.username);
      setShow(true);
    };
    const unsub = subscribeAuthChanges(handler);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  function close(persistSuppress: boolean) {
    if (persistSuppress && username) {
      try {
        localStorage.setItem(_suppressKey(username), String(Date.now()));
      } catch {
        // ignore — worst case we re-prompt next login, which is mild
      }
    }
    setShow(false);
    setPass('');
    setErr('');
    setResult(null);
    setBusy(false);
  }

  async function onRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!pass || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await restoreFromCloud(pass);
      setResult(r);
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  return (
    <div
      className="restore-prompt-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-prompt-title"
    >
      <div className="restore-prompt-card">
        <h2 id="restore-prompt-title">לשחזר מהענן?</h2>
        <p className="restore-prompt-intro">
          אין כאן הערות עדיין. אם יש לך גיבוי בענן עבור{' '}
          <strong>{username}</strong> אפשר לשחזר אותו עכשיו.
          <br />
          סיסמת הגיבוי דרושה ולא נשמרת.
        </p>

        {!result && (
          <form className="restore-prompt-form" onSubmit={onRestore}>
            <label htmlFor="restore-prompt-pass" className="visually-hidden">
              סיסמת גיבוי
            </label>
            <input
              id="restore-prompt-pass"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="סיסמת גיבוי"
              dir="ltr"
              autoFocus
              disabled={busy}
              autoComplete="current-password"
            />
            <div className="restore-prompt-actions">
              <button
                type="submit"
                className="primary"
                disabled={busy || !pass}
              >
                {busy ? 'משחזר…' : 'שחזר'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => close(true)}
                disabled={busy}
              >
                לא עכשיו
              </button>
            </div>
            {err && <div className="restore-prompt-err">{err}</div>}
          </form>
        )}

        {result && (
          <div className="restore-prompt-result">
            <p>
              ✅ שוחזרו: {result.restoredPatients} מטופלים ·{' '}
              {result.restoredNotes} הערות
              {result.scanned > 0 ? ` (מתוך ${result.scanned})` : ''}
              {' ('}
              {result.source === 'username' ? 'חשבון מחובר' : 'מכשיר זה'}
              {')'}
            </p>
            {result.skipped.length > 0 && (
              <p className="restore-prompt-skipped">
                {result.skipped.length} רשומות דולגו (סיסמה שגויה / פגומות)
              </p>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => close(true)}
            >
              סגור
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
