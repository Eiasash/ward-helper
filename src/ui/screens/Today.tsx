import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listPatients,
  listAllNotes,
  markNoteSent,
  type Patient,
  type Note,
  type NoteType,
} from '@/storage/indexed';
import { NOTE_LABEL } from '@/notes/templates';
import { EPISODE_WINDOW_MS } from '@/notes/continuity';
import { SafetyPills } from '../components/SafetyPills';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOAP_INTERVAL_MS = 18 * 60 * 60 * 1000;

interface DraftEntry {
  noteType: NoteType;
}

interface PatientNotes {
  patient: Patient;
  notes: Note[];
  unsentCount: number;
  latestAt: number;
}

interface SoapOwed {
  patient: Patient;
  lastNoteAt: number;
}

/**
 * "Today" — single-screen rounding dashboard. Three lanes:
 *
 *   1. Drafts in progress: anything in sessionStorage with a `body` key + a
 *      `noteType`. Tapping "המשך" returns the user to NoteEditor at /edit.
 *   2. Notes generated in the last 24h, grouped by patient. Surfaces "not
 *      yet sent to AZMA" so a forgotten copy-paste step gets caught the
 *      same day. The mark-as-sent button lives per-patient row to flip the
 *      latest unsent note in one tap.
 *   3. SOAPs owed: patients with an admission within the EPISODE_WINDOW
 *      (30d) but no SOAP-or-admission in the last 18h. Tap "+ SOAP" to
 *      seed continuity and jump to /capture (same pattern as History).
 *
 * Empty state: tap-through to /capture.
 *
 * Visual: post-v1.28 — class-driven via the today-* class family in
 * styles.css. Zero inline styles. Mirrors the consult-* pattern.
 */
export function Today() {
  const nav = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [notesByPid, setNotesByPid] = useState<Record<string, Note[]>>({});
  const [tick, setTick] = useState(0); // forces re-render after markNoteSent
  const [draft, setDraft] = useState<DraftEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ps, allNotes] = await Promise.all([listPatients(), listAllNotes()]);
      if (cancelled) return;
      setPatients(ps);
      const m: Record<string, Note[]> = {};
      for (const n of allNotes) {
        (m[n.patientId] ??= []).push(n);
      }
      for (const id in m) {
        m[id]!.sort((a, b) => b.updatedAt - a.updatedAt);
      }
      setNotesByPid(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // Drafts live in sessionStorage as a side effect of the editor flow.
  // Re-read on mount and whenever tick advances (mark-sent doesn't change
  // drafts, but Continue-then-back might).
  useEffect(() => {
    const body = sessionStorage.getItem('body');
    const noteType = sessionStorage.getItem('noteType') as NoteType | null;
    if (body && noteType) setDraft({ noteType });
    else setDraft(null);
  }, [tick]);

  const now = Date.now();

  const todaysNotes = useMemo<PatientNotes[]>(() => {
    const cutoff = now - DAY_MS;
    const grouped: PatientNotes[] = [];
    for (const p of patients) {
      const notes = (notesByPid[p.id] ?? []).filter((n) => n.createdAt >= cutoff);
      if (notes.length === 0) continue;
      const unsentCount = notes.filter((n) => !n.sentToEmrAt).length;
      const latestAt = notes[0]?.updatedAt ?? 0;
      grouped.push({ patient: p, notes, unsentCount, latestAt });
    }
    grouped.sort((a, b) => b.latestAt - a.latestAt);
    return grouped;
  }, [patients, notesByPid, now]);

  const soapsOwed = useMemo<SoapOwed[]>(() => {
    const owed: SoapOwed[] = [];
    for (const p of patients) {
      const notes = notesByPid[p.id] ?? [];
      const admissions = notes.filter((n) => n.type === 'admission');
      if (admissions.length === 0) continue;
      const latestAdmission = admissions[0]!;
      if (now - latestAdmission.createdAt > EPISODE_WINDOW_MS) continue;
      const recentSoap = notes.find(
        (n) => n.type === 'soap' && now - n.createdAt < SOAP_INTERVAL_MS,
      );
      if (recentSoap) continue;
      const recentAdmission = now - latestAdmission.createdAt < SOAP_INTERVAL_MS;
      if (recentAdmission) continue;
      const lastNoteAt = notes[0]?.createdAt ?? latestAdmission.createdAt;
      owed.push({ patient: p, lastNoteAt });
    }
    owed.sort((a, b) => a.lastNoteAt - b.lastNoteAt);
    return owed;
  }, [patients, notesByPid, now]);

  function startSoapForPatient(p: Patient) {
    sessionStorage.setItem('continuityTeudatZehut', p.teudatZehut);
    sessionStorage.setItem('continuityNoteType', 'soap');
    sessionStorage.setItem('noteType', 'soap');
    nav('/capture');
  }

  async function markAsSent(noteId: string) {
    await markNoteSent(noteId);
    setTick((t) => t + 1);
  }

  const totalActive = (draft ? 1 : 0) + todaysNotes.length + soapsOwed.length;

  const formatTime = (t: number) =>
    new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  return (
    <section>
      <h1>היום</h1>

      <div className="today-toolbar">
        <button type="button" className="ghost" onClick={() => nav('/census')}>
          📋 רשימת מחלקה
        </button>
      </div>

      {totalActive === 0 && (
        <div className="empty">
          <div className="empty-icon">✓</div>
          <p className="empty-title">אין משימות פתוחות</p>
          <p className="empty-sub">צלם מטופל חדש →</p>
          <button onClick={() => nav('/capture')}>📷 צלם</button>
        </div>
      )}

      {draft && (
        <div className="today-section">
          <h2>טיוטה פתוחה</h2>
          <div className="today-draft">
            <span>טיוטה ב-{NOTE_LABEL[draft.noteType]}</span>
            <button className="today-draft-resume" onClick={() => nav('/edit')}>
              המשך
            </button>
          </div>
        </div>
      )}

      {todaysNotes.length > 0 && (
        <div className="today-section">
          <h2>הערות שנוצרו היום</h2>
          {todaysNotes.map(({ patient, notes, unsentCount, latestAt }) => (
            <div key={patient.id} className="today-card">
              <div className="today-card-head">
                <strong>{patient.name || '(ללא שם)'}</strong>
                <small>
                  {notes.length} הערות · {formatTime(latestAt)}
                </small>
                {unsentCount > 0 && (
                  <span className="today-badge-warn">
                    לא נשלח לצ׳מיליון ({unsentCount})
                  </span>
                )}
              </div>
              <SafetyPills notes={notes} />
              <div className="today-note-list">
                {notes.map((n) => (
                  <div key={n.id} className="today-note-row">
                    <button
                      type="button"
                      className="note-row"
                      onClick={() => nav(`/note/${encodeURIComponent(n.id)}`)}
                    >
                      <span>
                        {n.sentToEmrAt ? '✓ ' : ''}
                        {NOTE_LABEL[n.type]}
                      </span>
                      <span className="note-time">{formatTime(n.updatedAt)}</span>
                    </button>
                    {!n.sentToEmrAt && (
                      <button
                        type="button"
                        className="ghost today-mark-sent"
                        onClick={() => markAsSent(n.id)}
                      >
                        סומן כנשלח
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {soapsOwed.length > 0 && (
        <div className="today-section">
          <h2>חייב SOAP היום</h2>
          {soapsOwed.map(({ patient, lastNoteAt }) => (
            <div key={patient.id} className="today-card">
              <div className="today-card-head">
                <strong>{patient.name || '(ללא שם)'}</strong>
                <small>
                  {patient.teudatZehut} · חדר {patient.room ?? '—'}
                </small>
              </div>
              <div className="today-meta">
                הערה אחרונה: {new Date(lastNoteAt).toLocaleString('he-IL')}
              </div>
              <button
                className="ghost today-soap-action"
                onClick={() => startSoapForPatient(patient)}
              >
                + SOAP
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
