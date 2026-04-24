import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getNote,
  getPatient,
  deleteNote,
  markNoteSent,
  type Note,
  type Patient,
} from '@/storage/indexed';
import { NOTE_LABEL } from '@/notes/templates';
import { wrapForChameleon, auditChameleonRules } from '@/i18n/bidi';
import { useBidiAudit } from '../hooks/useSettings';

/**
 * Read-only viewer for a saved note. Reached by tapping a note row in
 * History. Body is rendered from Note.bodyHebrew exactly as it was saved
 * — no regeneration, no cost.
 *
 * Copy action goes through wrapForChameleon again (idempotent) so the
 * clipboard is always clean, even if an older note was saved before a
 * sanitizer rule was added.
 */
export function NoteViewer() {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const [bidiAuditOn] = useBidiAudit();

  useEffect(() => {
    if (!id) {
      setErr('הערה לא נמצאה');
      return;
    }
    (async () => {
      const n = await getNote(id);
      if (!n) {
        setErr('הערה לא נמצאה');
        return;
      }
      setNote(n);
      const p = await getPatient(n.patientId);
      setPatient(p ?? null);
    })();
  }, [id]);

  const cleanBody = useMemo(
    () => (note ? wrapForChameleon(note.bodyHebrew) : ''),
    [note],
  );

  const issues = useMemo(
    () => (bidiAuditOn && note ? auditChameleonRules(note.bodyHebrew) : []),
    [note, bidiAuditOn],
  );

  async function onCopy() {
    if (!note) return;
    try {
      await navigator.clipboard.writeText(cleanBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      // Optimistic mark — update local state first so the status line flips
      // immediately, then persist in the background. If the IDB write fails,
      // revert and surface the error; clipboard itself already succeeded.
      const ts = Date.now();
      const prev = note.sentToEmrAt;
      setNote({ ...note, sentToEmrAt: ts, updatedAt: ts });
      try {
        await markNoteSent(note.id, ts);
      } catch (e) {
        setNote({ ...note, sentToEmrAt: prev });
        setErr('סימון כנשלח נכשל: ' + (e as Error).message);
      }
    } catch (e) {
      setErr('העתקה נכשלה: ' + (e as Error).message);
    }
  }

  function fmtDateTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function onDelete() {
    if (!note) return;
    if (!confirm('למחוק את הרשומה הזאת?')) return;
    await deleteNote(note.id);
    nav('/history');
  }

  function onNewSoap() {
    if (!patient) return;
    // Continuity: prior notes for this teudat zehut will be pulled in
    // automatically by NoteEditor via resolveContinuity().
    sessionStorage.setItem('continuityTeudatZehut', patient.teudatZehut);
    sessionStorage.setItem('continuityNoteType', 'soap');
    sessionStorage.setItem('noteType', 'soap');
    nav('/');
  }

  if (err) {
    return (
      <section>
        <h1>שגיאה</h1>
        <p style={{ color: 'var(--warn)' }}>{err}</p>
        <button className="ghost" onClick={() => nav('/history')}>חזור להיסטוריה</button>
      </section>
    );
  }

  if (!note) {
    return (
      <section>
        <h1>טוען…</h1>
      </section>
    );
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{NOTE_LABEL[note.type]}</h1>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {new Date(note.updatedAt).toLocaleDateString('he-IL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })}
        </span>
      </div>

      {patient && (
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
          {patient.name || '(ללא שם)'} · ת.ז. {patient.teudatZehut} · חדר {patient.room ?? '—'}
        </p>
      )}

      {issues.length > 0 && (
        <div
          style={{
            background: 'var(--warn)',
            color: 'black',
            padding: 8,
            borderRadius: 6,
            marginTop: 8,
            fontSize: 12,
          }}
        >
          <strong>Chameleon audit:</strong>
          <ul style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>
            {issues.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      <textarea
        dir="auto"
        readOnly
        value={cleanBody}
        rows={20}
        style={{
          width: '100%',
          marginTop: 12,
          fontFamily: 'inherit',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={onCopy}>
          {copied ? '✓ הועתק לצ׳מיליון' : '📋 העתק לצ׳מיליון'}
        </button>
        {note.type !== 'soap' && (
          <button className="ghost" onClick={onNewSoap}>+ SOAP היום</button>
        )}
        <button className="ghost" onClick={() => nav('/history')}>חזור</button>
        <button
          className="ghost"
          style={{ marginInlineStart: 'auto', color: 'var(--warn)' }}
          onClick={onDelete}
        >
          🗑 מחק
        </button>
      </div>

      {note.sentToEmrAt ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          ✓ הועתק לצ׳מיליון · {fmtDateTime(note.sentToEmrAt)}
        </p>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          ⚠ עדיין לא נשלח — אחרי ההעתקה, בדוק שהפסטה הצליחה
        </p>
      )}
    </section>
  );
}
