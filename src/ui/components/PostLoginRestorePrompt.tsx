/**
 * PostLoginRestorePrompt — fresh-device discoverability for cloud restore.
 *
 * v1.35.2 redesign: no more separate-passphrase prompt. Cloud encryption
 * uses the user's login password directly (the stash from AccountSection).
 * If the login password is in memory, the prompt presents a one-tap
 * "שחזר" button. If it's not (very rare — would mean the user just
 * logged in but the stash isn't populated), we direct them to log out
 * and back in.
 *
 * What this component does:
 *   - Listens for `ward-helper:auth` CustomEvents with `detail.action='login'`.
 *     Register events are ignored — a brand-new account has no cloud data
 *     to restore.
 *   - On login, checks `getDbStats()`. If the device already has any
 *     patients or notes locally, the prompt is suppressed (the user is on
 *     their normal device — auto-pulling would feel intrusive and is
 *     redundant).
 *   - If the device is in zero-state AND the user hasn't been prompted
 *     before for this username on this device, surfaces a modal that
 *     offers a one-tap restore using the login password.
 *   - Either action sets a localStorage suppress marker keyed on the
 *     username so subsequent logins don't re-prompt.
 *
 * What this component does NOT do:
 *   - It does not gate any clinical functionality. It's purely additive.
 *   - It does not pre-decrypt or sample blobs to give a "X notes available"
 *     count.
 */

import { useEffect, useState } from 'react';
import {
  getCurrentUser,
  getLastLoginPasswordOrNull,
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
        // Worst case: re-prompt next login. Mild.
      }
    }
    setShow(false);
    setErr('');
    setResult(null);
    setBusy(false);
  }

  async function onRestore() {
    if (busy) return;
    const loginPwd = getLastLoginPasswordOrNull();
    if (!loginPwd) {
      setErr(
        'סיסמת הכניסה לא בזיכרון. נסה להתנתק ולהתחבר מחדש לפני שחזור.',
      );
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await restoreFromCloud(loginPwd);
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
          <strong>{username}</strong> אפשר לשחזר אותו עכשיו —
          הגיבוי מוצפן עם סיסמת הכניסה שלך, לכן אין צורך בסיסמה נוספת.
        </p>

        {!result && (
          <div className="restore-prompt-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={onRestore}
            >
              {busy ? 'משחזר…' : 'שחזר עכשיו'}
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
        )}
        {err && <div className="restore-prompt-err">{err}</div>}

        {result && (
          <div className="restore-prompt-result">
            {result.wrongPassphrase ? (
              <p>
                ⚠️ הגיבוי בענן הוצפן עם סיסמת כניסה אחרת מהנוכחית
                (כנראה שינוי סיסמה, או נתונים ישנים מגרסה קודמת). השחזור
                האוטומטי לא הצליח. אפשר להמשיך לעבוד מקומית, ולהחליף את
                הגיבוי הישן דרך Settings → גיבוי לענן עכשיו אחרי שתוסיף
                כמה הערות.
              </p>
            ) : (
              <p>
                ✅ שוחזרו: {result.restoredPatients} מטופלים ·{' '}
                {result.restoredNotes} הערות
                {result.scanned > 0 ? ` (מתוך ${result.scanned})` : ''}
                {' ('}
                {result.source === 'username' ? 'חשבון מחובר' : 'מכשיר זה'}
                {')'}
              </p>
            )}
            {result.skipped.length > 0 && (
              <p className="restore-prompt-skipped">
                {result.skipped.length} רשומות דולגו (פורמט לא נתמך)
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
