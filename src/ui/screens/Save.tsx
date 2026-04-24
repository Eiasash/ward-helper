import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveBoth } from '@/notes/save';
import { getPassphrase } from '../hooks/useSettings';
import type { NoteType } from '@/storage/indexed';
import { clearShots } from '@/camera/session';

type Status = 'idle' | 'saving' | 'done' | 'error';

export function Save() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState('');
  const [cloudPushed, setCloudPushed] = useState(false);
  // null when cloud push succeeded OR was skipped for no-passphrase (expected).
  // A string means a real cloud-push failure that the user needs to know
  // about — silent swallowing was how earlier versions hid broken backups.
  const [cloudError, setCloudError] = useState<string | null>(null);

  async function onSave() {
    setStatus('saving');
    try {
      const noteType = (sessionStorage.getItem('noteType') ?? 'admission') as NoteType;
      const validated = JSON.parse(sessionStorage.getItem('validated') ?? '{}');
      const body = sessionStorage.getItem('body') ?? '';
      const result = await saveBoth(validated, noteType, body);
      setCloudPushed(result.cloudPushed);
      setCloudError(
        result.cloudSkippedReason && result.cloudSkippedReason !== 'no-passphrase'
          ? result.cloudSkippedReason
          : null,
      );
      clearShots();
      sessionStorage.removeItem('body');
      sessionStorage.removeItem('validated');
      setStatus('done');
    } catch (e: unknown) {
      setErr((e as Error).message);
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <section>
        <h1>נשמר ✓</h1>
        <p>{cloudPushed ? '☁ גובה ל-Supabase (מוצפן)' : '💾 נשמר מקומית בלבד'}</p>
        {cloudError && (
          <div
            role="alert"
            style={{
              background: 'var(--warn)',
              color: 'black',
              padding: '10px 12px',
              borderRadius: 8,
              margin: '12px 0',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            <strong>הגיבוי לענן נכשל.</strong> הרשומה נשמרה מקומית בלבד.
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                opacity: 0.85,
                fontFamily: 'ui-monospace, Menlo, monospace',
                wordBreak: 'break-word',
              }}
            >
              {cloudError}
            </div>
            <div style={{ marginTop: 6 }}>
              בדיקה: שהטבלה <code>ward_helper_backup</code> קיימת ב-Supabase
              ושכללי ה-RLS מאפשרים <code>INSERT</code> למשתמש anon.
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => nav('/history')}>ראה היסטוריה</button>
          <button className="ghost" onClick={() => nav('/')}>מטופל חדש</button>
        </div>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section>
        <h1>שגיאה</h1>
        <p style={{ color: 'var(--red)' }}>{err}</p>
        <button className="ghost" onClick={() => nav('/edit')}>חזרה לטיוטה</button>
      </section>
    );
  }

  return (
    <section>
      <h1>שמירה</h1>
      <p>
        {getPassphrase()
          ? '✓ גיבוי מוצפן יישלח ל-Supabase (ציפרטקסט בלבד)'
          : '⚠ סיסמה לא פעילה — שמירה מקומית בלבד'}
      </p>
      <button onClick={onSave} disabled={status === 'saving'}>
        {status === 'saving' ? 'שומר...' : 'שמור'}
      </button>
    </section>
  );
}
