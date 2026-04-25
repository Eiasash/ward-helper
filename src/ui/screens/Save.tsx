import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveBoth } from '@/notes/save';
import { getPassphrase, getEmailTarget } from '../hooks/useSettings';
import type { NoteType } from '@/storage/indexed';
import { NOTE_LABEL } from '@/notes/templates';
import { clearShots } from '@/camera/session';
import { sendNoteEmail, defaultEmailSubject } from '@/notes/email';
import { openMailCompose, openShareSheet } from '@/notes/share';
import type { ParseFields } from '@/agent/tools';

type Status = 'idle' | 'saving' | 'done' | 'error';
type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

interface SavedSnapshot {
  noteType: NoteType;
  patientName: string;
  body: string;
}

export function Save() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState('');
  const [cloudPushed, setCloudPushed] = useState(false);
  // null when cloud push succeeded OR was skipped for no-passphrase (expected).
  // A string means a real cloud-push failure that the user needs to know
  // about — silent swallowing was how earlier versions hid broken backups.
  const [cloudError, setCloudError] = useState<string | null>(null);
  // Snapshot of the note at save time — we clear sessionStorage on success,
  // but the email button still needs the body/subject. Keeping a copy here
  // avoids re-reading a now-empty sessionStorage after save.
  const [snapshot, setSnapshot] = useState<SavedSnapshot | null>(null);

  const [sendStatus, setSendStatus] = useState<SendStatus>('idle');
  const [sendErr, setSendErr] = useState('');
  const emailTarget = getEmailTarget();

  async function onSave() {
    setStatus('saving');
    try {
      const noteType = (sessionStorage.getItem('noteType') ?? 'admission') as NoteType;
      const validated: ParseFields = JSON.parse(sessionStorage.getItem('validated') ?? '{}');
      const body = sessionStorage.getItem('body') ?? '';
      // Safety flags computed in Review and persisted to sessionStorage. Absent
      // for older sessions or when no meds were extracted — the saveBoth call
      // omits the field rather than writing an empty placeholder.
      const safetyRaw = sessionStorage.getItem('validatedSafety');
      const safetyFlags = safetyRaw ? JSON.parse(safetyRaw) : undefined;
      const result = await saveBoth(validated, noteType, body, safetyFlags);
      setCloudPushed(result.cloudPushed);
      setCloudError(
        result.cloudSkippedReason && result.cloudSkippedReason !== 'no-passphrase'
          ? result.cloudSkippedReason
          : null,
      );
      setSnapshot({ noteType, patientName: validated.name ?? '', body });
      clearShots();
      sessionStorage.removeItem('body');
      sessionStorage.removeItem('validated');
      sessionStorage.removeItem('validatedSafety');
      setStatus('done');
    } catch (e: unknown) {
      setErr((e as Error).message);
      setStatus('error');
    }
  }

  async function onSendEmail() {
    if (!snapshot || !emailTarget) return;
    setSendStatus('sending');
    setSendErr('');
    try {
      const subject = defaultEmailSubject(NOTE_LABEL[snapshot.noteType], snapshot.patientName);
      await sendNoteEmail(emailTarget, subject, snapshot.body);
      setSendStatus('sent');
    } catch (e: unknown) {
      setSendErr((e as Error).message || 'שגיאה בשליחה');
      setSendStatus('error');
    }
  }

  function onMailto() {
    if (!snapshot || !emailTarget) return;
    const subject = defaultEmailSubject(NOTE_LABEL[snapshot.noteType], snapshot.patientName);
    openMailCompose({ to: emailTarget, subject, body: snapshot.body });
  }

  async function onShare() {
    if (!snapshot) return;
    const subject = defaultEmailSubject(NOTE_LABEL[snapshot.noteType], snapshot.patientName);
    await openShareSheet({ title: subject, text: snapshot.body });
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

        {emailTarget && snapshot && (
          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sendStatus === 'sent' ? (
              <p style={{ margin: 0 }}>
                ✉ נשלח ל-<bdi dir="ltr">{emailTarget}</bdi>
              </p>
            ) : (
              <>
                <button className="ghost" onClick={onMailto}>
                  ✉ מייל מהמכשיר
                </button>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <button className="ghost" onClick={onShare}>
                    ↗ שתף
                  </button>
                )}
                <button
                  onClick={onSendEmail}
                  disabled={sendStatus === 'sending'}
                >
                  {sendStatus === 'sending'
                    ? 'שולח...'
                    : sendStatus === 'error'
                      ? 'נסה שוב — שלח במייל'
                      : '✉ שלח במייל (Gmail)'}
                </button>
                {sendErr && (
                  <p
                    style={{
                      color: 'var(--red)',
                      fontSize: 12,
                      margin: 0,
                      flexBasis: '100%',
                    }}
                  >
                    {sendErr}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => nav('/history')}>ראה היסטוריה</button>
          <button className="ghost" onClick={() => nav('/capture')}>מטופל חדש</button>
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
