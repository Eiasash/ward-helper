import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { authResetPasswordWithToken } from '@/auth/auth';

/**
 * Password reset landing screen — reached via the link in the recovery
 * email at `#/reset-password?token=<plaintext>`. Reads the token from
 * the URL, asks the user for a new password (twice), calls the
 * `auth_reset_password_with_token` RPC, and on success punts back to /
 * with a success-flash query param the GuestAccount card surfaces.
 *
 * Token-error UX: if the token is missing/invalid/used/expired, show a
 * specific Hebrew message and a "request a new link" link back to the
 * regular login screen (which has the שכחת סיסמה? entry point).
 */
export function PasswordReset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    if (!token) {
      setStatus({ tone: 'err', msg: 'הקישור לא תקין — חסר token.' });
      return;
    }
    if (pwd.length < 6) {
      setStatus({ tone: 'err', msg: 'הסיסמה חייבת להיות לפחות 6 תווים.' });
      return;
    }
    if (pwd !== pwd2) {
      setStatus({ tone: 'err', msg: 'הסיסמאות לא תואמות.' });
      return;
    }

    setBusy(true);
    const res = await authResetPasswordWithToken(token, pwd);
    setBusy(false);

    if (res.ok) {
      setStatus({ tone: 'ok', msg: '✅ הסיסמה אופסה. מעביר אותך להתחברות…' });
      // Brief pause so the user sees the success message before redirect
      setTimeout(() => navigate('/settings'), 1500);
    } else {
      setStatus({ tone: 'err', msg: tokenErrorMessage(res.error, res.message) });
    }
  }

  if (!token) {
    return (
      <section style={{ padding: 16 }}>
        <h1>איפוס סיסמה</h1>
        <div className="account-status err" style={{ padding: 12, marginTop: 12, border: '1px solid #ef444444', borderRadius: 8, background: '#ef444411' }}>
          הקישור לא תקין — חסר token. ודא שהעתקת את הקישור המלא מהאימייל.
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="primary"
          style={{ marginTop: 16 }}
        >
          חזרה להתחברות
        </button>
      </section>
    );
  }

  return (
    <section style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <h1>איפוס סיסמה</h1>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
        הזן סיסמה חדשה. לאחר האיפוס תועבר למסך ההתחברות.
      </p>
      <form className="account-form" onSubmit={onSubmit}>
        <input
          type="password"
          placeholder="סיסמה חדשה (לפחות 6 תווים)"
          autoComplete="new-password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          disabled={busy}
          required
          minLength={6}
        />
        <input
          type="password"
          placeholder="הקלד שוב את הסיסמה החדשה"
          autoComplete="new-password"
          value={pwd2}
          onChange={(e) => setPwd2(e.target.value)}
          disabled={busy}
          required
          minLength={6}
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'מאפס…' : '🔐 אפס סיסמה'}
        </button>
      </form>
      {status && (
        <div
          className={`account-status ${status.tone}`}
          style={{
            marginTop: 12,
            padding: 12,
            border: `1px solid ${status.tone === 'ok' ? '#22c55e44' : '#ef444444'}`,
            borderRadius: 8,
            background: status.tone === 'ok' ? '#22c55e11' : '#ef444411',
          }}
        >
          {status.msg}
        </div>
      )}
    </section>
  );
}

function tokenErrorMessage(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'invalid_token':
      return 'הקישור לא תקין. ייתכן שהוא נשבר או שכבר השתמשת בו. בקש קישור חדש מתפריט "שכחת סיסמה?".';
    case 'token_used':
      return 'הקישור הזה כבר נוצל. בקש קישור חדש.';
    case 'token_expired':
      return 'הקישור פג תוקף (24 שעות). בקש קישור חדש.';
    case 'weak_password':
      return 'הסיסמה החדשה קצרה מדי (לפחות 6 תווים).';
    case 'missing_field':
      return 'חסר שדה. נסה שוב.';
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
