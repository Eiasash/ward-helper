import { useEffect, useMemo, useRef, useState } from 'react';
import {
  runConsultTurn,
  runConsultEmit,
  type ConsultMsg,
} from '@/notes/consult';
import { sendNoteEmail, defaultEmailSubject } from '@/notes/email';
import { getEmailTarget } from '../hooks/useSettings';
import { NOTE_LABEL } from '@/notes/templates';
import type { NoteType } from '@/storage/indexed';
import { putPatient, putNote } from '@/storage/indexed';

/**
 * Free-form case-discussion chat. The doctor describes a patient in
 * Hebrew, English or mixed; the model plays senior clinician — asks
 * clarifying questions, pushes back on plans. When the doctor asks for
 * a note ("תכין קבלה"), the model returns the <NOTE_READY> sentinel
 * and the UI flips to a note-type picker → emit → inline note card
 * with copy + email buttons.
 *
 * State boundaries:
 * - `messages` — sessionStorage-backed chat thread (cleared on "new
 *   case"). Lives only on this device.
 * - `pendingEmit` — true after sentinel detected, before user picks
 *   a note type. Renders the NoteTypePicker as a chat affordance.
 * - `emittedNotes` — map message-index → note text. Inlined as a
 *   non-chat "note card" with copy/email/save actions.
 *
 * Why sessionStorage and not IndexedDB:
 * Chat thread is ephemeral working memory. Notes that the doctor
 * actually emits get persisted via the existing saveNote() pipeline
 * (same as the capture flow) so the rest of the app (Today,
 * History, NoteViewer) sees them uniformly.
 */

const STORAGE_KEY = 'ward-helper.consult.thread.v1';

const NOTE_TYPES: { type: NoteType; label: string }[] = [
  { type: 'admission', label: 'קבלה' },
  { type: 'discharge', label: 'שחרור' },
  { type: 'consult', label: 'ייעוץ' },
  { type: 'soap', label: 'SOAP' },
  { type: 'case', label: 'מקרה מעניין' },
];

const SUGGESTIONS: string[] = [
  'בן 84, תפקודי בקהילה, התקבל עקב נפילה. SBP 110/70, HR 92, גליקמיה תקינה.',
  'אישה 79 ידועה עם CKD III ופרפור פרוזדורים על אפיקסבן, מתקבלת עקב המטוריה.',
  'אעבור על מטופל עם דליריום, רוצה לחשוב יחד על ה-DDx.',
];

interface EmittedNote {
  noteType: NoteType;
  text: string;
  ts: number;
  /** When set: persistence has happened (Today/History will see this note). */
  noteId?: string;
  /** Stub patient id created when this note is saved — needed by NoteViewer. */
  patientId?: string;
  /** When set: email has been delivered. */
  emailedAt?: number;
}

/** Strict shape of what we persist to sessionStorage so reload doesn't break. */
interface PersistedThread {
  messages: ConsultMsg[];
  /** Map serialized as message-index → emitted note. */
  emitted: Record<number, EmittedNote>;
}

function loadThread(): PersistedThread {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [], emitted: {} };
    const parsed = JSON.parse(raw) as PersistedThread;
    if (!Array.isArray(parsed.messages)) return { messages: [], emitted: {} };
    return parsed;
  } catch {
    return { messages: [], emitted: {} };
  }
}

function saveThread(t: PersistedThread): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* sessionStorage full or disabled — ignore */
  }
}

export function Consult() {
  const initial = useMemo(() => loadThread(), []);
  const [messages, setMessages] = useState<ConsultMsg[]>(initial.messages);
  const [emitted, setEmitted] = useState<Record<number, EmittedNote>>(
    initial.emitted,
  );
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmit, setPendingEmit] = useState(false);
  const [emitInFlight, setEmitInFlight] = useState<NoteType | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Autoscroll to bottom whenever the thread grows or a note lands.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, emitted, busy, pendingEmit]);

  // Persist on every state change. Cheap enough — chat threads are tiny.
  useEffect(() => {
    saveThread({ messages, emitted });
  }, [messages, emitted]);

  const emailTarget = getEmailTarget();

  function clearError() {
    if (error) setError(null);
  }

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    clearError();
    const userMsg: ConsultMsg = {
      role: 'user',
      content: trimmed,
      ts: Date.now(),
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const res = await runConsultTurn(next);
      if (res.emitReady) {
        setPendingEmit(true);
      } else {
        const reply: ConsultMsg = {
          role: 'assistant',
          content: res.reply,
          ts: Date.now(),
        };
        setMessages([...next, reply]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'שגיאת תקשורת';
      setError(msg);
    } finally {
      setBusy(false);
      // Refocus the input so the doctor can keep typing without tapping.
      inputRef.current?.focus();
    }
  }

  function newCase() {
    if (messages.length > 0 && !confirm('להתחיל מקרה חדש? ההיסטוריה הנוכחית תימחק.')) {
      return;
    }
    setMessages([]);
    setEmitted({});
    setPendingEmit(false);
    setError(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  async function emitNote(noteType: NoteType) {
    if (busy || emitInFlight) return;
    clearError();
    setEmitInFlight(noteType);
    try {
      const text = await runConsultEmit(noteType, messages);
      const idx = messages.length; // anchor the note to a position past the last message
      const note: EmittedNote = {
        noteType,
        text,
        ts: Date.now(),
      };
      setEmitted((prev) => ({ ...prev, [idx]: note }));
      // Append a minimal "✓ note ready" assistant message so the chat reads naturally.
      const sysMsg: ConsultMsg = {
        role: 'assistant',
        content: `✓ הכנתי ${NOTE_LABEL[noteType]}. הטקסט בכרטיס למטה — העתק או שלח במייל.`,
        ts: Date.now(),
      };
      setMessages((m) => [...m, sysMsg]);
      setPendingEmit(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'נכשל להפיק הערה';
      setError(msg);
    } finally {
      setEmitInFlight(null);
    }
  }

  async function copyNote(idx: number) {
    const n = emitted[idx];
    if (!n) return;
    try {
      await navigator.clipboard.writeText(n.text);
      setEmitted((prev) => ({
        ...prev,
        [idx]: { ...n, ts: n.ts }, // touch object so React re-renders the toast
      }));
      // Show a transient confirmation via setError(null) message — keep it
      // simple, the button label flips for a moment via component state below.
      const el = document.querySelector(
        `[data-copy-idx="${idx}"]`,
      ) as HTMLButtonElement | null;
      if (el) {
        const orig = el.textContent;
        el.textContent = 'הועתק ✓';
        setTimeout(() => {
          if (el) el.textContent = orig;
        }, 1400);
      }
    } catch {
      setError('העתקה נכשלה — בחר ידנית והעתק');
    }
  }

  async function emailNote(idx: number) {
    const n = emitted[idx];
    if (!n) return;
    if (!emailTarget) {
      setError('כתובת מייל לא הוגדרה — בהגדרות → שליחה במייל');
      return;
    }
    clearError();
    try {
      const subject = defaultEmailSubject(NOTE_LABEL[n.noteType], undefined);
      await sendNoteEmail(emailTarget, subject, n.text);
      setEmitted((prev) => ({
        ...prev,
        [idx]: { ...n, emailedAt: Date.now() },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'שליחת מייל נכשלה';
      setError(msg);
    }
  }

  /**
   * Persist this note to IndexedDB so it shows up in Today/History/NoteViewer.
   * Creates a stub Patient record (chat-mode notes don't have an extracted
   * patient; we use a synthetic id keyed off the note timestamp) and a Note
   * record. Idempotent — second click is a no-op once noteId is set.
   */
  async function saveToHistory(idx: number) {
    const n = emitted[idx];
    if (!n || n.noteId) return;
    try {
      const patientId = `consult-${n.ts}`;
      await putPatient({
        id: patientId,
        name: 'מקרה ללא שם',
        teudatZehut: '',
        dob: '',
        room: null,
        tags: ['consult-mode'],
        createdAt: n.ts,
        updatedAt: n.ts,
      });
      const noteId = `consult-note-${n.ts}`;
      await putNote({
        id: noteId,
        patientId,
        type: n.noteType,
        bodyHebrew: n.text,
        structuredData: {},
        createdAt: n.ts,
        updatedAt: n.ts,
        sentToEmrAt: null,
      });
      setEmitted((prev) => ({
        ...prev,
        [idx]: { ...n, noteId, patientId },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'שמירה בארכיון נכשלה';
      setError(msg);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <section className="consult-screen">
      <header className="consult-head">
        <h1 className="consult-title">ייעוץ — מקרה בצ׳אט</h1>
        <div className="consult-head-actions">
          {messages.length > 0 && (
            <button className="ghost small" onClick={newCase}>
              מקרה חדש
            </button>
          )}
        </div>
      </header>

      <div className="consult-thread" ref={threadRef} aria-live="polite">
        {isEmpty && (
          <div className="consult-empty">
            <p className="consult-empty-lead">
              ספר לי על המטופל בעברית או באנגלית.
              <br />
              אני אשאל הבהרות, אחזיר תהיות, ואכין הערה ל-Chameleon כשתבקש.
            </p>
            <div className="consult-suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  className="consult-suggestion"
                  onClick={() => {
                    setDraft(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            <div className="bubble-content">{m.content}</div>
          </div>
        ))}

        {/* Inline emitted-note cards — keyed by their anchor index so they
            sit right after the message that triggered them. */}
        {Object.entries(emitted).map(([idxStr, note]) => {
          const idx = Number(idxStr);
          if (idx > messages.length) return null;
          return (
            <article key={`note-${idx}`} className="note-card">
              <header className="note-card-head">
                <span className="note-card-label">
                  {NOTE_LABEL[note.noteType]} מוכנה ל-Chameleon
                </span>
                <time className="note-card-time">
                  {new Date(note.ts).toLocaleTimeString('he-IL', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </header>
              <pre className="note-card-body" dir="auto">
                {note.text}
              </pre>
              <footer className="note-card-actions">
                <button
                  data-copy-idx={idx}
                  className="primary"
                  onClick={() => copyNote(idx)}
                >
                  📋 העתק
                </button>
                {emailTarget ? (
                  <button onClick={() => emailNote(idx)}>
                    {note.emailedAt
                      ? `✉ נשלח ל-${emailTarget}`
                      : `✉ שלח ל-${emailTarget}`}
                  </button>
                ) : (
                  <button
                    className="ghost"
                    onClick={() =>
                      setError(
                        'הגדר כתובת מייל קודם בהגדרות → שליחה במייל',
                      )
                    }
                  >
                    ✉ אין כתובת מייל
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={() => saveToHistory(idx)}
                  disabled={!!note.noteId}
                >
                  {note.noteId ? '✓ נשמר בארכיון' : '💾 שמור בארכיון'}
                </button>
              </footer>
            </article>
          );
        })}

        {pendingEmit && (
          <div className="emit-picker" role="group" aria-label="בחר סוג הערה">
            <p className="emit-picker-lead">איזו הערה להכין?</p>
            <div className="emit-picker-buttons">
              {NOTE_TYPES.map((t) => (
                <button
                  key={t.type}
                  className="primary"
                  disabled={!!emitInFlight}
                  onClick={() => emitNote(t.type)}
                >
                  {emitInFlight === t.type ? `מכין ${t.label}…` : t.label}
                </button>
              ))}
              <button
                className="ghost"
                disabled={!!emitInFlight}
                onClick={() => setPendingEmit(false)}
              >
                לא עכשיו
              </button>
            </div>
          </div>
        )}

        {busy && (
          <div className="bubble bubble-assistant bubble-typing" aria-label="חושב">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}

        {error && (
          <div className="consult-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <form
        className="consult-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          className="consult-input"
          rows={2}
          placeholder="תאר את המטופל…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts newline. Standard chat-app behaviour.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          disabled={busy || !!emitInFlight}
        />
        <div className="consult-composer-actions">
          <button
            type="button"
            className="ghost small"
            disabled={busy || messages.length === 0 || !!emitInFlight}
            onClick={() => setPendingEmit(true)}
            title="הכן הערה מהשיחה"
          >
            📝 הכן הערה
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !draft.trim() || !!emitInFlight}
          >
            שלח
          </button>
        </div>
      </form>
    </section>
  );
}
