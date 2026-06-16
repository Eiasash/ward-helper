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
import { deleteNoteFromCloud } from '@/notes/cloudDelete';
import { wrapForChameleon, auditChameleonRules } from '@/i18n/bidi';
import { useBidiAudit } from '../hooks/useSettings';
import { InlineConfirm } from '../components/InlineConfirm';

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
  // Inline confirm for the delete action — replaces window.confirm() which
  // silently fails in Android PWA standalone mode (see InlineConfirm.tsx).
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (!id) {
      setErr('הערה לא נמצאה');
      return;
    }
    let cancelled = false;
    (async () => {
      const n = await getNote(id);
      if (cancelled) return;
      if (!n) {
        setErr('הערה לא נמצאה');
        return;
      }
      setNote(n);
      const p = await getPatient(n.patientId);
      if (cancelled) return;
      setPatient(p ?? null);
    })();
    return () => {
      cancelled = true;
    };
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
    // Trigger the inline confirm modal instead of calling window.confirm()
    // synchronously — confirm() silently fails on Android PWA standalone.
    setConfirmDeleteOpen(true);
  }

  async function performDelete() {
    if (!note) return;
    setConfirmDeleteOpen(false);
    // Local IndexedDB delete is authoritative and must succeed first.
    await deleteNote(note.id);
    // Then best-effort remove the note's encrypted backup row so the
    // "deleted" note does NOT resurrect on a fresh-device restore. This is
    // non-fatal by contract (deleteNoteFromCloud returns a status, never
    // throws) — and we still wrap it so navigation is guaranteed even if a
    // future change makes the cloud path throw. A cloud-delete failure must
    // not block navigation or the already-completed local delete.
    try {
      await deleteNoteFromCloud(note.id);
    } catch {
      // swallow — local delete already done; orphan cleanup is best-effort.
    }
    nav('/history');
  }

  function onNewSoap() {
    if (!patient) return;
    // Continuity: prior notes for this teudat zehut will be pulled in
    // automatically by NoteEditor via resolveContinuity().
    sessionStorage.setItem('continuityTeudatZehut', patient.teudatZehut);
    sessionStorage.setItem('continuityNoteType', 'soap');
    sessionStorage.setItem('noteType', 'soap');
    nav('/capture');
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
          {copied ? '✓ הועתק ל-AZMA' : '📋 העתק ל-AZMA'}
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
          ✓ הועתק ל-AZMA · {fmtDateTime(note.sentToEmrAt)}
        </p>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          ⚠ עדיין לא נשלח לאזמה — אחרי ההעתקה, בדוק שהפסטה הצליחה
        </p>
      )}
      <InlineConfirm
        open={confirmDeleteOpen}
        message="למחוק את the femur exemplarומה הזאת? הפעולה לא ניתנת לשחזור."
        confirmLabel="מחק"
        cancelLabel="ביטול"
        variant="danger"
        onConfirm={performDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </section>
  );
}
