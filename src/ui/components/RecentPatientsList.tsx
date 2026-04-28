/**
 * Recent-patients quick-pick — shows the last-24h patients above the
 * camera button on the Capture screen.
 *
 * PHI scope: ONLY teudat-zehut + name in this list view. No DOB, no room,
 * no diagnoses. Tap → re-uses the patient's most recent note's structured
 * data as the extract result, seeds sessionStorage, and navigates to
 * /edit (skipping AZMA capture + the extract turn entirely — saving 5-15s
 * and one Anthropic call when the doctor is doing a same-day follow-up).
 *
 * Dedupe rule (per spec): one row per patient (latest note wins). Sorted
 * newest-first by latest-note-updatedAt.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listPatients,
  listAllNotes,
  type Patient,
  type Note,
  type NoteType,
} from '@/storage/indexed';
import { notifyPatientChanged } from '../hooks/useGlanceable';

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RecentPatient {
  patient: Patient;
  latestNote: Note;
}

/**
 * Pure dedupe + sort. One row per patientId (the latest note in the
 * 24h window wins). Newest-first. Exported for unit tests so the
 * dedup rule is locked.
 */
export function buildRecentPatients(
  patients: Patient[],
  notes: Note[],
  now: number = Date.now(),
  windowMs: number = RECENT_WINDOW_MS,
): RecentPatient[] {
  const cutoff = now - windowMs;
  const byPatient = new Map<string, Note>();
  for (const n of notes) {
    if (n.updatedAt < cutoff) continue;
    const prev = byPatient.get(n.patientId);
    if (!prev || n.updatedAt > prev.updatedAt) {
      byPatient.set(n.patientId, n);
    }
  }
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const out: RecentPatient[] = [];
  for (const [pid, latestNote] of byPatient) {
    const patient = patientById.get(pid);
    if (!patient) continue;
    out.push({ patient, latestNote });
  }
  out.sort((a, b) => b.latestNote.updatedAt - a.latestNote.updatedAt);
  return out;
}

/**
 * Re-seeds the session with a previously-extracted patient and jumps
 * straight to the editor. Skips AZMA capture + extract turn.
 *
 * - validated      : the prior note's structuredData (= ParseFields)
 * - validatedConf  : confidence is unknown for a re-pick — empty map.
 * - noteType       : carries through.
 * - body / bodyKey : cleared so NoteEditor regenerates with the new note
 *                    type if the user changed it (otherwise the old draft
 *                    would re-display).
 */
export function pickRecentPatient(rp: RecentPatient, noteType: NoteType): void {
  sessionStorage.setItem('validated', JSON.stringify(rp.latestNote.structuredData));
  sessionStorage.setItem('validatedConfidence', '{}');
  sessionStorage.setItem('noteType', noteType);
  sessionStorage.removeItem('body');
  sessionStorage.removeItem('bodyKey');
  notifyPatientChanged();
}

export function RecentPatientsList({
  noteType,
}: {
  noteType: NoteType;
}) {
  const nav = useNavigate();
  const [recents, setRecents] = useState<RecentPatient[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ps, ns] = await Promise.all([listPatients(), listAllNotes()]);
      if (cancelled) return;
      setRecents(buildRecentPatients(ps, ns));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => recents.slice(0, 8), [recents]);
  if (items.length === 0) return null;

  return (
    <div className="recent-patients" aria-label="מטופלים אחרונים (24 שעות)">
      <div className="recent-patients-header">
        <span>מטופלים אחרונים (24ש)</span>
        <small>הקש לדלג על צילום</small>
      </div>
      <ul className="recent-patients-list">
        {items.map((rp) => (
          <li key={rp.patient.id}>
            <button
              type="button"
              className="recent-patient-row"
              onClick={() => {
                pickRecentPatient(rp, noteType);
                nav('/edit');
              }}
              aria-label={`בחר מטופל ${rp.patient.name}`}
            >
              <span dir="ltr" className="recent-patient-tz">
                {rp.patient.teudatZehut || '—'}
              </span>
              <span dir="auto" className="recent-patient-name">
                {rp.patient.name || '(ללא שם)'}
              </span>
              <span className="recent-patient-time" dir="ltr">
                {new Date(rp.latestNote.updatedAt).toLocaleTimeString('he-IL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
