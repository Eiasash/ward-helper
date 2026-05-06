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
import { isSoapModeUiEnabled } from '@/notes/soapMode';
import {
  setRoster,
  getRoster,
  type RosterPatient,
} from '@/storage/roster';
import { RosterImportModal } from '../components/RosterImportModal';
import { BatchFlow } from '../components/BatchFlow';

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

  // Phase D: roster state. `roster` is the live snapshot read from IDB on
  // mount + after every modal commit. `rosterModalOpen` is plain UI state.
  // `featuresOn` is read once at mount via the same flag soapMode uses —
  // doesn't react to runtime localStorage changes (consistent with the
  // soapMode dropdown's posture; toggling the flag is dev-only and
  // requires a refresh to take effect).
  const [roster, setRoster_] = useState<RosterPatient[]>([]);
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [featuresOn] = useState<boolean>(() => isSoapModeUiEnabled());

  // Phase E multi-select. `selectedIds` is the per-card checkbox state.
  // `batchPatients` is non-null while the batch flow is active —
  // captures the snapshot of selected RosterPatients at the moment the
  // doctor tapped "צור SOAP לכולם", so subsequent roster mutations
  // don't change which patients are in the active batch.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchPatients, setBatchPatients] = useState<RosterPatient[] | null>(null);

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

  // Phase D: load roster on mount + after each modal commit. ageOutRoster
  // is wired into App.tsx boot, not duplicated here — by the time Today
  // renders, the 24h sweep has already run.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await getRoster();
      if (cancelled) return;
      setRoster_(rows);
    })();
    return () => {
      cancelled = true;
    };
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

  /**
   * Phase D: roster card → SOAP. Mirrors startSoapForPatient but sources
   * tz from RosterPatient (which may be null — roster rows don't always
   * carry a teudatZehut). Without tz, no continuity is seeded; the user
   * still gets the standard SOAP capture flow.
   *
   * Phase D+E follow-up (chore-roster-single-skip-extract, v1.38.x):
   * Stash the full RosterPatient as `rosterSeed` so Review.tsx can merge
   * it with extract output via mergeRosterIdentity. Frees the doctor
   * from photographing the patient card — identity comes from the
   * roster row, extract only fills clinical content.
   */
  function startSoapForRosterPatient(rp: RosterPatient) {
    if (rp.tz) {
      sessionStorage.setItem('continuityTeudatZehut', rp.tz);
    } else {
      sessionStorage.removeItem('continuityTeudatZehut');
    }
    sessionStorage.setItem('continuityNoteType', 'soap');
    sessionStorage.setItem('noteType', 'soap');
    sessionStorage.setItem('rosterSeed', JSON.stringify(rp));
    nav('/capture');
  }

  async function onRosterCommit(rows: RosterPatient[]) {
    await setRoster(rows);
    setRosterModalOpen(false);
    // Tick advances → useEffect re-loads from IDB → roster state refreshes.
    setTick((t) => t + 1);
    // Snap selection back to empty — IDs from the prior roster are
    // stale anyway after setRoster's clear-then-insert.
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function startBatch() {
    const picked = roster.filter((rp) => selectedIds.has(rp.id));
    if (picked.length === 0) return;
    setBatchPatients(picked);
  }

  function onBatchClose() {
    setBatchPatients(null);
    setSelectedIds(new Set());
    // The batch may have saved notes — bump tick so today's-notes
    // section refreshes when we land back on the roster view.
    setTick((t) => t + 1);
  }

  async function markAsSent(noteId: string) {
    await markNoteSent(noteId);
    setTick((t) => t + 1);
  }

  const totalActive =
    (draft ? 1 : 0) + todaysNotes.length + soapsOwed.length + roster.length;

  const formatTime = (t: number) =>
    new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  // Phase E batch flow takes over the whole "היום" surface while active.
  // Conditional render rather than a route — keeps the bottom-nav
  // visible (intentional MVP UX; if user navigates away the async
  // runBatchSoap keeps running in the background and saves notes,
  // they just lose the progress UI).
  if (batchPatients) {
    return <BatchFlow patients={batchPatients} onClose={onBatchClose} />;
  }

  return (
    <section>
      <h1>היום</h1>

      <div className="today-toolbar">
        <button type="button" className="ghost" onClick={() => nav('/census')}>
          📋 רשימת מחלקה
        </button>
        {featuresOn && (
          <button
            type="button"
            className="ghost"
            onClick={() => setRosterModalOpen(true)}
            title="ייבא רשימת מחלקה (צילום / הדבקה / ידני)"
          >
            ⬆ ייבא רשומה
          </button>
        )}
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

      {/*
        Phase D roster section. Rendered last so saved-patient flows
        (drafts, today's notes, SOAPs owed) take precedence visually —
        roster is "today's snapshot, mostly unprocessed", and the soft
        amber left border calls that out without competing with the
        cards above for primary attention.
      */}
      {featuresOn && roster.length > 0 && (
        <div className="today-section">
          <h2>רשימת מחלקה ({roster.length})</h2>
          {roster.map((rp) => {
            const checked = selectedIds.has(rp.id);
            return (
              <div
                key={rp.id}
                className="today-card"
                data-roster-source={rp.sourceMode}
                style={{
                  borderInlineStart: '4px solid var(--warn, #d97706)',
                  paddingInlineStart: 12,
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 10,
                  alignItems: 'start',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelected(rp.id)}
                  aria-label={`בחר את ${rp.name} ל-SOAP קבוצתי`}
                  style={{ width: 20, height: 20, marginTop: 4 }}
                />
                <div>
                  <div className="today-card-head">
                    <strong dir="auto">{rp.name}</strong>
                    <small>
                      חדר {rp.room ?? '—'}
                      {rp.bed ? `-${rp.bed}` : ''}
                      {' · '}
                      גיל {rp.age ?? '—'}
                      {rp.losDays != null ? ` · יום ${rp.losDays}` : ''}
                    </small>
                  </div>
                  {rp.dxShort && (
                    <div
                      className="today-meta"
                      dir="auto"
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={rp.dxShort}
                    >
                      {rp.dxShort}
                    </div>
                  )}
                  <button
                    className="ghost today-soap-action"
                    onClick={() => startSoapForRosterPatient(rp)}
                  >
                    + SOAP
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/*
        Phase E sticky batch bar. Appears only when ≥1 roster patient is
        selected. position:sticky pins to the bottom of the scroll
        viewport; combined with the bottom-nav offset (56px) this sits
        just above the main nav bar without overlapping it.
      */}
      {featuresOn && selectedIds.size > 0 && (
        <div
          role="toolbar"
          aria-label="פעולות בחירת קבוצה"
          style={{
            position: 'sticky',
            bottom: 56,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            background: 'var(--card)',
            borderTop: '1px solid var(--border)',
            padding: '10px 12px',
            display: 'flex',
            gap: 8,
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 10,
            marginTop: 16,
          }}
        >
          <button type="button" onClick={startBatch} style={{ flex: 1 }}>
            צור SOAP לכולם ({selectedIds.size})
          </button>
          <button type="button" className="ghost" onClick={clearSelection}>
            בטל בחירה
          </button>
        </div>
      )}

      {featuresOn && (
        <RosterImportModal
          isOpen={rosterModalOpen}
          onClose={() => setRosterModalOpen(false)}
          onCommit={onRosterCommit}
        />
      )}
    </section>
  );
}
