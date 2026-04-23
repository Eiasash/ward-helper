import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateNote } from '@/notes/orchestrate';
import type { NoteType } from '@/storage/indexed';
import type { ParseFields } from '@/agent/tools';
import { NOTE_LABEL } from '@/notes/templates';
import { resolveContinuity } from '@/notes/continuity';
import { auditChameleonRules, sanitizeForChameleon } from '@/i18n/bidi';

type Status = 'gen' | 'ready' | 'error';

export function NoteEditor() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>('gen');
  const [err, setErr] = useState('');
  const [body, setBody] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('admission');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nt = (sessionStorage.getItem('noteType') ?? 'admission') as NoteType;
        const validated: ParseFields = JSON.parse(sessionStorage.getItem('validated') ?? '{}');
        setNoteType(nt);
        const continuityTz = sessionStorage.getItem('continuityTeudatZehut');
        const continuity = continuityTz ? await resolveContinuity(continuityTz) : null;
        const text = await generateNote(
          nt,
          { fields: validated, confidence: {}, sourceRegions: {} },
          continuity,
        );
        if (cancelled) return;
        setBody(text);
        sessionStorage.setItem('body', text);
        setStatus('ready');
      } catch (e: unknown) {
        if (cancelled) return;
        setErr((e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (body) sessionStorage.setItem('body', body);
  }, [body]);

  // Live audit: surfaces any Chameleon violations present in the current
  // draft, including ones the user introduces while editing.
  const issues = useMemo(() => auditChameleonRules(body), [body]);

  async function onCopy() {
    // Last-chance sanitize at the clipboard boundary — even if the draft
    // somehow still contains forbidden chars (e.g. user just typed one),
    // the pasted text is clean.
    const clean = sanitizeForChameleon(body);
    await navigator.clipboard.writeText(clean);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function onAutoClean() {
    setBody(sanitizeForChameleon(body));
  }

  if (status === 'gen') {
    return (
      <section>
        <h1>יוצר טיוטת {NOTE_LABEL[noteType]}...</h1>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section>
        <h1>שגיאה</h1>
        <p style={{ color: 'var(--red)' }}>{err}</p>
        <button className="ghost" onClick={() => nav('/')}>חזרה</button>
      </section>
    );
  }

  return (
    <section>
      <h1>טיוטת {NOTE_LABEL[noteType]}</h1>

      {issues.length > 0 && (
        <div
          role="alert"
          style={{
            background: 'var(--warn)',
            color: 'black',
            padding: 10,
            borderRadius: 8,
            marginBottom: 10,
            fontSize: 14,
          }}
        >
          <strong>⚠ {issues.length} בעיית פורמט לצ׳מיליון:</strong>
          <ul style={{ margin: '6px 0 8px 18px', padding: 0 }}>
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost"
            onClick={onAutoClean}
            style={{
              background: 'black',
              color: 'white',
              minHeight: 36,
              padding: '6px 12px',
              fontSize: 13,
            }}
          >
            נקה אוטומטית
          </button>
        </div>
      )}

      <textarea
        dir="auto"
        rows={18}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ minHeight: 400, fontSize: 15, lineHeight: 1.6 }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onCopy}>{copied ? '✓ הועתק' : 'העתק לצ׳מיליון'}</button>
        <button className="ghost" onClick={() => nav('/save')}>המשך לשמירה ←</button>
      </div>
    </section>
  );
}
