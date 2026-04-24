import { useState, useEffect } from 'react';
import {
  useApiKey,
  setPassphrase,
  getPassphrase,
  clearPassphrase,
  useBidiAudit,
} from '../hooks/useSettings';
import { load as loadCosts, reset as resetCosts } from '@/agent/costs';
import { restoreFromCloud, type RestoreResult } from '@/notes/save';
import { activePath, type RequestPath } from '@/agent/client';

export function Settings() {
  const { present, save, clear } = useApiKey();
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [bidiAuditOn, setBidiAuditOn] = useBidiAudit();
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreErr, setRestoreErr] = useState('');
  const [path, setPath] = useState<RequestPath | null>(null);

  // Re-runs whenever `present` flips (save/clear in useApiKey bumps it).
  // No polling, no refresh button — the path only changes when the key changes.
  useEffect(() => {
    let cancelled = false;
    activePath().then((p) => {
      if (!cancelled) setPath(p);
    });
    return () => {
      cancelled = true;
    };
  }, [present]);

  async function onSaveKey() {
    if (!key.startsWith('sk-ant-')) {
      setMsg('מפתח לא תקין');
      return;
    }
    await save(key);
    setKey('');
    setMsg('מפתח נשמר ✓');
  }

  function onSavePass() {
    if (pass.length < 8) {
      setMsg('סיסמה קצרה מדי');
      return;
    }
    setPassphrase(pass);
    setPass('');
    setMsg('סיסמה בזיכרון ✓');
  }

  async function onClearKey() {
    await clear();
    setMsg('מפתח נמחק');
  }

  async function onRestore() {
    const p = getPassphrase();
    if (!p) {
      setRestoreErr('הפעל קודם את סיסמת הגיבוי למעלה — צריך אותה כדי לפענח את הגיבוי בענן.');
      return;
    }
    if (!confirm(
      'זה ימשוך את כל הרשומות המוצפנות מהענן ויכתוב אותן למכשיר הזה. ' +
      'רשומות מקומיות עם אותו מזהה יוחלפו. להמשיך?'
    )) return;
    setRestoring(true);
    setRestoreErr('');
    setRestoreResult(null);
    try {
      const res = await restoreFromCloud(p);
      setRestoreResult(res);
    } catch (e) {
      setRestoreErr((e as Error).message ?? 'נכשל');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section>
      <h1>הגדרות</h1>

      <h2>Anthropic API Key</h2>
      <div
        style={{
          background: 'var(--card)',
          padding: '4px 10px',
          borderRadius: 6,
          marginBottom: 8,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {path === null
          ? '…'
          : path === 'direct'
          ? '🟢 פנייה ישירה (api.anthropic.com)'
          : '🟡 Toranot proxy — פסק זמן 10 שניות'}
      </div>
      {present === null ? (
        <p>...</p>
      ) : present ? (
        <p>
          ✓ מפתח אישי מוגדר — פניות ישירות ל-<code>api.anthropic.com</code>
        </p>
      ) : (
        <div
          style={{
            background: 'var(--warn)',
            color: 'black',
            padding: 10,
            borderRadius: 8,
            marginBottom: 8,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <strong>אין מפתח — משתמש ב-Toranot proxy.</strong>
          <br />
          הפרוקסי קצוב ל-10 שניות ונפסק בשגיאת 504 על רישומים ארוכים (קבלה/שחרור).
          הגדר מפתח כדי לעקוף את המגבלה הזאת.
        </div>
      )}
      <input
        dir="auto"
        placeholder="sk-ant-..."
        value={key}
        onChange={(e) => setKey(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSaveKey}>שמור מפתח</button>
        {present && <button className="ghost" onClick={onClearKey}>מחק</button>}
      </div>

      <h2>סיסמת גיבוי (Supabase)</h2>
      <p>{getPassphrase() ? '✓ פעילה (תפוג אחרי 15 דק׳)' : 'לא פעילה — הגיבוי לא ירוץ'}</p>
      <input
        type="password"
        dir="auto"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSavePass}>הפעל סיסמה</button>
        <button className="ghost" onClick={clearPassphrase}>נקה סיסמה</button>
      </div>

      <h2>שחזור מהענן</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
        מכשיר חדש? IDB נמחק? זה מושך את כל הגיבויים המוצפנים מ-Supabase,
        מפענח אותם עם סיסמת הגיבוי שלמעלה, וכותב אותם למכשיר הזה.
      </p>
      <button
        onClick={onRestore}
        disabled={restoring}
        className="ghost"
      >
        {restoring ? 'משחזר...' : '⬇ שחזר מהענן'}
      </button>
      {restoreResult && (
        <div
          style={{
            background: 'var(--card)',
            padding: 10,
            borderRadius: 8,
            marginTop: 8,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>שוחזר ✓</strong>
          <br />
          נסרקו: {restoreResult.scanned}
          {' · '}שוחזרו מטופלים: {restoreResult.restoredPatients}
          {' · '}הערות: {restoreResult.restoredNotes}
          {restoreResult.skipped.length > 0 && (
            <>
              <br />
              דילוג: {restoreResult.skipped.length} רשומות (סיסמה שגויה /
              פורמט לא תואם). ראה console.
            </>
          )}
        </div>
      )}
      {restoreErr && (
        <p style={{ color: 'var(--warn)', fontSize: 13, marginTop: 8 }}>
          {restoreErr}
        </p>
      )}

      <h2>עלות מצטברת</h2>
      {(() => {
        const c = loadCosts();
        return (
          <p>
            ${c.usd.toFixed(3)} · {c.inputTokens + c.outputTokens} tokens
            {' '}
            ({c.inputTokens} in / {c.outputTokens} out)
          </p>
        );
      })()}
      <button
        className="ghost"
        onClick={() => {
          resetCosts();
          setMsg('עלויות אופסו');
        }}
      >
        אפס מונה
      </button>

      <h2>אבחון מפתחים</h2>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={bidiAuditOn}
          onChange={(e) => setBidiAuditOn(e.target.checked)}
        />
        הצג באנר audit של כללי Chameleon בעורך ההערה
      </label>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
        מציג הפרות שהמודל הפיק לפני ה-sanitizer. מיועד לכיול prompts. השאר כבוי בשימוש קליני.
      </p>

      {msg && <p style={{ color: 'var(--muted)', marginTop: 24 }}>{msg}</p>}
    </section>
  );
}
