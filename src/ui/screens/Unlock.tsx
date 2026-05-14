/**
 * Cold-start PHI-unlock gate (PR-B2.2).
 *
 * Mounted IN PLACE OF the normal Routes when `usePhiGateState() ===
 * 'locked'` (logged in + sealed data on disk + no in-memory PHI key).
 *
 * Typical trigger: the user closed and reopened the app on a device
 * where the persisted login password was wiped (private window,
 * profile reset). The encrypted rows on disk are unrecoverable without
 * the password, so we block the route surface and prompt explicitly.
 *
 * On submit:
 *   - Calls attemptPhiUnlockWithPassword which derives the key, sets
 *     it, runs the (already-complete) backfill (a noop on sentinel),
 *     and stashes the password so cloud-push works on the new session.
 *   - On success, `setPhiKey` fires the `ward-helper:phi-key` event;
 *     usePhiGateState recomputes to 'unlocked'; this component
 *     naturally unmounts and the routes render.
 *
 * Failure modes surfaced verbatim:
 *   - Wrong password → backfill-failed (or decrypt failure later) →
 *     show "סיסמה שגויה — נסה שוב."
 *   - No-user → shouldn't render this component if state is right; if
 *     somehow reached, log it.
 *
 * Note: this is the only place the user types their login password
 * outside the login screen. The visual treatment uses the same input
 * pattern as AccountSection's login form so the affordance is
 * familiar.
 */
import { useState } from 'react';
import { attemptPhiUnlockWithPassword, type PhiUnlockOutcome } from '@/auth/phiUnlock';
import { getCurrentUser } from '@/auth/auth';

interface Props {
  /**
   * Called when the unlock succeeded. The parent usually doesn't need
   * this — the phi-key event handler in `usePhiGateState` flips the
   * gate state from 'locked' to 'unlocked' and the parent re-renders
   * — but exposed for tests and any future caller that wants explicit
   * post-unlock orchestration.
   */
  onUnlocked?: () => void;
}

export function Unlock({ onUnlocked }: Props = {}): JSX.Element {
  const user = getCurrentUser();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('נדרשת סיסמה');
      return;
    }
    setBusy(true);
    const outcome: PhiUnlockOutcome = await attemptPhiUnlockWithPassword(password);
    setBusy(false);
    // v1.46.1: explicit branch per outcome variant. Default-fallthrough
    // is the bug class we just memory-folded (see ward-helper B2.2 review);
    // every kind gets an explicit branch and the unreachable tail still
    // fails-closed.
    if (outcome.kind === 'ok' || outcome.kind === 'already-unlocked') {
      setPassword('');
      onUnlocked?.();
      return;
    }
    if (outcome.kind === 'wrong-password') {
      // The verify-probe inside attemptPhiUnlockWithPassword tested the
      // derived key against on-disk sealed rows and got zero successful
      // decrypts. The key was cleared from memory before returning, so
      // hasPhiKey() is back to false; the gate stays mounted naturally.
      setError('סיסמה שגויה — נסה שוב.');
      setPassword('');
      return;
    }
    if (outcome.kind === 'backfill-failed') {
      // Genuine system error (IDB read failed, probe threw, backfill
      // sweep threw). Be honest about it — pre-v1.46.1 we displayed
      // "סיסמה שגויה" here which was wrong; that case now has its own
      // 'wrong-password' branch above.
      setError(`שגיאה במערכת: ${outcome.error.message}`);
      return;
    }
    if (outcome.kind === 'no-user') {
      setError('שגיאה: אין משתמש מחובר.');
      return;
    }
    // 'no-password' is impossible here (we just passed one in).
    // Any other kind = type-system regression caller — fail-closed.
    setError('שגיאה לא צפויה. נסה שוב.');
  }

  const displayName = user?.displayName ?? user?.username ?? 'משתמש';

  return (
    <section className="unlock-gate" dir="auto" aria-labelledby="unlock-h1">
      <h1 id="unlock-h1">🔒 פתח גישה לנתונים מוצפנים</h1>
      <p>
        שלום {displayName}. הנתונים הקליניים על המכשיר הזה מוצפנים. הכנס את
        סיסמת ההתחברות שלך כדי לפתוח אותם.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="unlock-pwd">סיסמה:</label>
        <input
          id="unlock-pwd"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !password}>
          {busy ? 'פותח...' : 'פתח'}
        </button>
        {error && (
          <p role="alert" className="unlock-error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
