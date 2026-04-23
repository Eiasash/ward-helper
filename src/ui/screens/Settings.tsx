import { useState } from 'react';
import { useApiKey, setPassphrase, getPassphrase, clearPassphrase } from '../hooks/useSettings';
import { load as loadCosts, reset as resetCosts } from '@/agent/costs';

export function Settings() {
  const { present, save, clear } = useApiKey();
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');

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

  return (
    <section>
      <h1>הגדרות</h1>

      <h2>Anthropic API Key</h2>
      <p>{present === null ? '...' : present ? '✓ מפתח מוגדר' : 'עדיין לא מוגדר'}</p>
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

      {msg && <p style={{ color: 'var(--muted)', marginTop: 24 }}>{msg}</p>}
    </section>
  );
}
