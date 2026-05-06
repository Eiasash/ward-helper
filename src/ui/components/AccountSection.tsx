import { useState } from 'react';
import {
  authLogin,
  authRegister,
  changePasswordWithReencrypt,
  authRequestPasswordReset,
  authSetEmail,
  setAuthSession,
  logout,
  stashLastLoginPassword,
  clearLastLoginPassword,
  validateUsername,
  validatePassword,
  normalizeUsername,
  type AuthUser,
} from '@/auth/auth';
import { tryAutoUnlock } from '@/crypto/unlock';
import { setPassphrase } from '@/ui/hooks/useSettings';
import { useAuth } from '../hooks/useAuth';
import { pushBreadcrumb } from './MobileDebugPanel';

// Loose email format check — full RFC validation rejects valid edge cases
// for marginal benefit. Server (auth_set_email RPC) does the same regex.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Account section embedded in Settings. Logged-in: shows the account chip
 * with change-password + logout. Logged-out: tabbed login/register.
 *
 * State boundaries:
 *   - The user state itself comes from useAuth() (subscribed to the
 *     'ward-helper:auth' event), so a successful login/logout re-renders
 *     this without a manual setUser call.
 *   - In-flight RPC + status messages live as local state; cleared on tab
 *     change so a stale "wrong password" doesn't bleed across modes.
 */
export function AccountSection() {
  const user = useAuth();
  return (
    <>
      <h2>👤 חשבון</h2>
      {user ? <AuthedAccount user={user} /> : <GuestAccount />}
    </>
  );
}

function AuthedAccount({ user }: { user: AuthUser }) {
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  // One-shot warning: if onRegister persisted a partial-failure flag (email
  // step failed but account was created and the user was auto-logged-in),
  // show it once and consume the flag so it doesn't repeat across navigations.
  const [registerEmailWarning] = useState<string | null>(() => {
    try {
      const code = sessionStorage.getItem('ward-helper.register-email-failed');
      if (!code) return null;
      sessionStorage.removeItem('ward-helper.register-email-failed');
      return code;
    } catch {
      return null;
    }
  });

  const initial = (user.displayName || user.username).slice(0, 1).toUpperCase();
  const display = user.displayName || user.username;

  return (
    <div className="account-card-authed">
      <div className="account-row">
        <div className="account-avatar" aria-hidden="true">
          {initial}
        </div>
        <div className="account-info">
          <div className="account-display-name">{display}</div>
          <div className="account-handle">@{user.username}</div>
        </div>
      </div>
      <div className="account-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => setShowChangePwd((v) => !v)}
        >
          🔑 שנה סיסמה
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setShowEmailForm((v) => !v)}
        >
          📧 אימייל לאיפוס
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            // Drop the session-only login-password stash. Do NOT clear the
            // cachedUnlockBlob itself — keeping it lets the same user re-login
            // silently (a different user logging in on the same device gets
            // tryAutoUnlock returning null because their password doesn't
            // match the cached blob, falling through to the prompt).
            clearLastLoginPassword();
            logout();
          }}
        >
          🚪 התנתק
        </button>
      </div>
      {registerEmailWarning && (
        <div
          className="account-status err"
          style={{
            marginTop: 10,
            padding: 10,
            border: '1px solid #f59e0b66',
            borderRadius: 6,
            background: '#f59e0b14',
            fontSize: 13,
          }}
        >
          ⚠ האימייל לא נשמר במהלך הרשמה ({registerEmailWarning}). לחץ 📧 אימייל
          לאיפוס למעלה כדי להוסיף אותו עכשיו — זה נדרש לפני שמשחזרים סיסמה.
        </div>
      )}
      {showChangePwd && <ChangePasswordForm username={user.username} onDone={() => setShowChangePwd(false)} />}
      {showEmailForm && <SetEmailForm username={user.username} onDone={() => setShowEmailForm(false)} />}
      <div className="account-note">
        חשבון אחד פותח את ארבע האפליקציות (Mishpacha, Pnimit, Geri, ward-helper).
        סנכרון הערות בין מכשירים — בקרוב.
      </div>
    </div>
  );
}

function ChangePasswordForm({
  username,
  onDone,
}: {
  username: string;
  onDone: () => void;
}) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const pErr = validatePassword(newPwd);
    if (pErr) {
      setStatus({ tone: 'err', msg: pErr });
      return;
    }
    setBusy(true);
    const res = await changePasswordWithReencrypt(username, oldPwd, newPwd);
    setBusy(false);
    if (res.ok) {
      setStatus({ tone: 'ok', msg: 'הסיסמה עודכנה ✓' });
      setOldPwd('');
      setNewPwd('');
      setTimeout(onDone, 1200);
    } else {
      setStatus({
        tone: 'err',
        msg: res.error === 'invalid_password' ? 'סיסמה ישנה שגויה' : res.message || 'שגיאה',
      });
    }
  }

  return (
    <form className="account-form" onSubmit={onSubmit} style={{ marginTop: 10 }}>
      <input
        type="password"
        placeholder="סיסמה ישנה"
        autoComplete="current-password"
        value={oldPwd}
        onChange={(e) => setOldPwd(e.target.value)}
        disabled={busy}
      />
      <input
        type="password"
        placeholder="סיסמה חדשה (לפחות 6 תווים)"
        autoComplete="new-password"
        value={newPwd}
        onChange={(e) => setNewPwd(e.target.value)}
        disabled={busy}
      />
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'מעדכן…' : 'עדכן סיסמה'}
      </button>
      {status && <div className={`account-status ${status.tone}`}>{status.msg}</div>}
    </form>
  );
}

/**
 * Add or update the email on the user's account. Required before they can
 * use the password-recovery flow ('שכחת סיסמה?'). Calls auth_set_email RPC
 * which validates the current password (sensitive op).
 *
 * UX: form is idempotent — submitting an email that already matches the
 * current value is a no-op. Submitting a different email updates it.
 * Server enforces uniqueness across all app_users (Geri/IM/FM/ward-helper).
 */
function SetEmailForm({
  username,
  onDone,
}: {
  username: string;
  onDone: () => void;
}) {
  const [pwd, setPwd] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      setStatus({ tone: 'err', msg: 'כתובת אימייל לא תקינה' });
      return;
    }
    if (!pwd) {
      setStatus({ tone: 'err', msg: 'נדרשת הסיסמה הנוכחית כדי לעדכן אימייל' });
      return;
    }
    setBusy(true);
    const res = await authSetEmail(username, pwd, trimmed);
    setBusy(false);
    if (res.ok) {
      setStatus({ tone: 'ok', msg: `✓ אימייל עודכן: ${res.email ?? trimmed}` });
      setPwd('');
      setEmail('');
      setTimeout(onDone, 1500);
    } else {
      setStatus({ tone: 'err', msg: setEmailErrorMessage(res.error, res.message) });
    }
  }

  return (
    <form className="account-form" onSubmit={onSubmit} style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
        הוסף אימייל כדי שתוכל לאפס סיסמה דרך 'שכחת סיסמה?'. נדרשת הסיסמה הנוכחית.
      </div>
      <input
        type="email"
        placeholder="כתובת אימייל"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
        dir="ltr"
        required
      />
      <input
        type="password"
        placeholder="הסיסמה הנוכחית"
        autoComplete="current-password"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        disabled={busy}
        required
      />
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'מעדכן…' : '📧 שמור אימייל'}
      </button>
      {status && <div className={`account-status ${status.tone}`}>{status.msg}</div>}
    </form>
  );
}

function setEmailErrorMessage(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'missing_field':
      return 'חסרים שדות. מלא את שניהם.';
    case 'invalid_email':
      return 'כתובת אימייל לא תקינה.';
    case 'invalid_credentials':
      return 'הסיסמה הנוכחית שגויה.';
    case 'email_taken':
      return 'אימייל זה כבר רשום לחשבון אחר. השתמש באימייל אחר או צור קשר עם המנהל.';
    case 'network':
      return 'בעיית רשת. בדוק חיבור ונסה שוב.';
    case 'rpc_error':
      return fallback ? `שגיאת שרת: ${fallback}` : 'שגיאת שרת. נסה שוב.';
    default:
      if (code && fallback) return `שגיאה (${code}): ${fallback}`;
      if (code) return `שגיאה: ${code}`;
      return fallback || 'שגיאה. נסה שוב.';
  }
}

function GuestAccount() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  // Optional email at registration time. Empty string = skip; the account is
  // created without an email (same as pre-2026-05-02 behavior). When provided,
  // we chain authSetEmail right after authRegister so password-recovery works
  // immediately on the new account.
  const [registerEmail, setRegisterEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);

  // Forgot-password flow state. Three steps:
  //   'idle' = link visible, form hidden
  //   'form' = email input visible
  //   'sent' = "check your email" confirmation
  const [forgotMode, setForgotMode] = useState<'idle' | 'form' | 'sent'>('idle');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  function switchTab(t: 'login' | 'register') {
    setTab(t);
    setStatus(null);
    // Don't clear username — likely the same on re-login attempt — but clear password.
    setPassword('');
    setRegisterEmail('');
    // Reset forgot flow when switching tabs
    setForgotMode('idle');
    setForgotEmail('');
    setForgotError(null);
  }

  async function onForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotError(null);
    const trimmed = forgotEmail.trim().toLowerCase();
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      setForgotError('כתובת אימייל לא תקינה');
      return;
    }
    setForgotBusy(true);
    const res = await authRequestPasswordReset(trimmed);
    setForgotBusy(false);
    if (res.ok) {
      // Anti-enumeration: ALWAYS show "check your email", whether or not the
      // server actually had a matching account.
      setForgotMode('sent');
    } else {
      setForgotError(forgotErrorMessage(res.error, res.message));
    }
  }

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const u = normalizeUsername(username);
    const uErr = validateUsername(u);
    if (uErr) {
      setStatus({ tone: 'err', msg: uErr });
      return;
    }
    const pErr = validatePassword(password);
    if (pErr) {
      setStatus({ tone: 'err', msg: pErr });
      return;
    }
    setBusy(true);
    pushBreadcrumb('login.start', { username: u });
    const res = await authLogin(u, password);
    if (res.ok && res.user) {
      // CRITICAL ordering (see feedback_react_setauthsession_unmount_race):
      // any await that needs `password` must happen BEFORE setAuthSession,
      // because that call swaps <GuestAccount> → <AuthedAccount> on the
      // next tick and unmounts this component. Stash + auto-unlock are
      // safe-before, the singleton setPassphrase mutation is also safe.
      stashLastLoginPassword(password);
      pushBreadcrumb('login.stashed');
      const cachedPass = await tryAutoUnlock(password);
      pushBreadcrumb('login.tryAutoUnlock', { hadCache: cachedPass !== null });
      if (cachedPass !== null) {
        setPassphrase(cachedPass);
      }
      setBusy(false);
      setAuthSession(res.user.username, res.user.display_name, 'login');
      setPassword('');
    } else {
      setBusy(false);
      pushBreadcrumb('login.err', { error: res.error });
      setStatus({ tone: 'err', msg: errorMessage(res.error, res.message) });
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const u = normalizeUsername(username);
    const uErr = validateUsername(u);
    if (uErr) {
      setStatus({ tone: 'err', msg: uErr });
      return;
    }
    const pErr = validatePassword(password);
    if (pErr) {
      setStatus({ tone: 'err', msg: pErr });
      return;
    }
    // Email is optional. Validate format only when provided.
    const trimmedEmail = registerEmail.trim().toLowerCase();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setStatus({ tone: 'err', msg: 'כתובת אימייל לא תקינה' });
      return;
    }
    setBusy(true);
    const dn = displayName.trim() || null;
    const res = await authRegister(u, password, dn);
    if (!res.ok || !res.user) {
      setBusy(false);
      setStatus({ tone: 'err', msg: errorMessage(res.error, res.message) });
      return;
    }
    // Critical ordering: do the email step BEFORE setAuthSession, because
    // setAuthSession fires the auth-change event which causes useAuth() to
    // swap <GuestAccount> → <AuthedAccount>. Awaiting authSetEmail across
    // that unmount means subsequent setStatus calls land on a stale closure
    // (silently ignored in React 18). Bug observed in production
    // 2026-05-02: account `eiasashhab55555` was created, the email step
    // never landed, user saw bare "שגיאה" with no indication that
    // registration had actually succeeded.
    if (trimmedEmail) {
      const emailRes = await authSetEmail(res.user.username, password, trimmedEmail);
      if (!emailRes.ok) {
        // Persist a one-shot flag so the AuthedAccount surfaces this too if
        // the user dismisses the inline message and we still auto-login.
        sessionStorage.setItem(
          'ward-helper.register-email-failed',
          emailRes.error || 'unknown',
        );
        setStatus({
          tone: 'err',
          msg: `✓ חשבון נוצר אך האימייל לא נשמר: ${setEmailErrorMessage(emailRes.error, emailRes.message)} ניתן להוסיף אותו דרך 📧 אימייל לאיפוס לאחר התחברות.`,
        });
        // Don't auto-login — keep the GuestAccount mounted so the user reads
        // the message. They can switch to the login tab to enter the new
        // account, where the SetEmailForm under 📧 אימייל לאיפוס will retry.
        setBusy(false);
        return;
      }
    }
    // All steps succeeded (or email was skipped). Auto-login last.
    setAuthSession(res.user.username, res.user.display_name, 'register');
    setBusy(false);
    setPassword('');
  }

  return (
    <div className="account-card-guest">
      <div className="account-intro">
        התחבר כדי לסנכרן הערות בין מכשירים בעתיד. <strong>אין חובה</strong> —
        אפשר להמשיך כאורח כרגיל.
      </div>
      <div className="account-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'login'}
          className={tab === 'login' ? 'active' : ''}
          onClick={() => switchTab('login')}
        >
          התחברות
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'register'}
          className={tab === 'register' ? 'active' : ''}
          onClick={() => switchTab('register')}
        >
          הרשמה
        </button>
      </div>

      {tab === 'login' ? (
        <>
          <form className="account-form" onSubmit={onLogin}>
            <input
              type="text"
              placeholder="שם משתמש"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
            <input
              type="password"
              placeholder="סיסמה"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'מתחבר…' : '🔓 התחבר'}
            </button>
          </form>

          {/* Forgot-password — collapsed link → email form → confirmation */}
          {forgotMode === 'idle' && (
            <button
              type="button"
              className="account-link"
              onClick={() => setForgotMode('form')}
              style={{ background: 'none', border: 'none', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', padding: '8px 0', fontSize: 13 }}
            >
              שכחת סיסמה?
            </button>
          )}

          {forgotMode === 'form' && (
            <form className="account-form" onSubmit={onForgotSubmit} style={{ marginTop: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                הזן את כתובת האימייל המקושרת לחשבון שלך — נשלח לך קישור לאיפוס סיסמה.
              </div>
              <input
                type="email"
                placeholder="כתובת אימייל"
                autoComplete="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                disabled={forgotBusy}
                dir="ltr"
              />
              <button type="submit" className="primary" disabled={forgotBusy}>
                {forgotBusy ? 'שולח…' : '📧 שלח קישור איפוס'}
              </button>
              <button
                type="button"
                onClick={() => { setForgotMode('idle'); setForgotEmail(''); setForgotError(null); }}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, marginTop: 4 }}
              >
                ביטול
              </button>
              {forgotError && <div className="account-status err">{forgotError}</div>}
            </form>
          )}

          {forgotMode === 'sent' && (
            <div className="account-status ok" style={{ marginTop: 12, padding: 12, border: '1px solid #22c55e44', borderRadius: 8, background: '#22c55e11' }}>
              ✉️ אם לכתובת זו מקושר חשבון, תוך זמן קצר תקבל אימייל עם קישור לאיפוס. תוקף הקישור: 24 שעות.
              <br />
              <button
                type="button"
                onClick={() => { setForgotMode('idle'); setForgotEmail(''); }}
                style={{ background: 'none', border: 'none', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, marginTop: 8 }}
              >
                חזרה
              </button>
            </div>
          )}
        </>
      ) : (
        <form className="account-form" onSubmit={onRegister}>
          <input
            type="text"
            placeholder="שם משתמש (3-32 תווים, אנגלית קטנה+מספרים)"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
          <input
            type="password"
            placeholder="סיסמה (לפחות 6 תווים)"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <input
            type="text"
            className="display-name-input"
            placeholder="שם להצגה (אופציונלי)"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
          />
          <input
            type="email"
            placeholder="אימייל לאיפוס סיסמה (אופציונלי)"
            autoComplete="email"
            value={registerEmail}
            onChange={(e) => setRegisterEmail(e.target.value)}
            disabled={busy}
            dir="ltr"
          />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'יוצר…' : '✨ צור חשבון'}
          </button>
        </form>
      )}

      {status && <div className={`account-status ${status.tone}`}>{status.msg}</div>}
    </div>
  );
}

function forgotErrorMessage(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'invalid_email':
      return 'כתובת אימייל לא תקינה';
    case 'email_not_configured':
      return 'שירות איפוס סיסמה לא מוגדר עדיין. פנה למנהל המערכת.';
    case 'email_send_failed':
      return 'שליחת האימייל נכשלה. נסה שוב או פנה למנהל המערכת.';
    case 'function_error':
    case 'rpc_error':
      return fallback ? `שגיאת שרת: ${fallback}` : 'שגיאת שרת. נסה שוב בעוד כמה שניות.';
    case 'network':
      return 'בעיית רשת. בדוק חיבור ונסה שוב.';
    case 'bad_response':
      return 'תגובה לא תקינה מהשרת. נסה שוב.';
    default:
      if (code && fallback) return `שגיאה (${code}): ${fallback}`;
      if (code) return `שגיאה: ${code}`;
      return fallback || 'שגיאה. נסה שוב.';
  }
}

function errorMessage(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'invalid_username':
      return 'שם משתמש לא תקין';
    case 'invalid_password':
      return 'סיסמה שגויה';
    case 'username_taken':
      return 'שם המשתמש תפוס';
    case 'locked_out':
      return 'החשבון נעול אחרי 5 ניסיונות. נסה שוב מאוחר יותר';
    case 'network':
      return 'בעיית רשת. בדוק חיבור ונסה שוב.';
    case 'rpc_error':
      // Backend RPC threw — surface the raw message so the user has something
      // actionable instead of bare 'שגיאה'.
      return fallback ? `שגיאת שרת: ${fallback}` : 'שגיאת שרת. נסה שוב.';
    case 'bad_response':
      // RPC returned null/non-object — typically transient backend issue.
      return 'תגובה לא תקינה מהשרת. נסה שוב בעוד כמה שניות.';
    default:
      // Pre-2026-05-02: failures of any kind landed on bare 'שגיאה' with no
      // hint about cause. Now we surface the raw code + message so the user
      // can paste it into a support thread (or a Claude session) and have
      // something to act on. Last-resort 'שגיאה' only fires when neither is
      // present — unlikely but kept for back-compat.
      if (code && fallback) return `שגיאה (${code}): ${fallback}`;
      if (code) return `שגיאה: ${code}`;
      return fallback || 'שגיאה';
  }
}
