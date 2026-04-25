import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPatients, listAllNotes, type Patient, type Note } from '@/storage/indexed';
import { NOTE_LABEL } from '@/notes/templates';
import { loadPerPatient, type Totals } from '@/agent/costs';

/**
 * History screen. Each patient card shows:
 *   - name / ID / room
 *   - running cost (tokens + USD) if any notes have been generated
 *   - one row per saved note — TAP to open the viewer, long-press not needed
 *   - "+ SOAP היום" starts a new SOAP tied to this patient's teudat zehut,
 *     so NoteEditor's continuity path pulls in the admission + prior SOAPs
 *
 * Note rows are buttons (tappable areas) — the previous version used plain
 * divs which meant you could see your notes but not read them.
 */
export function History() {
  const nav = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [notesByPid, setNotesByPid] = useState<Record<string, Note[]>>({});
  const [costsByPid, setCostsByPid] = useState<Record<string, Totals>>({});
  const [q, setQ] = useState('');

  function startSoapForPatient(p: Patient) {
    sessionStorage.setItem('continuityTeudatZehut', p.teudatZehut);
    sessionStorage.setItem('continuityNoteType', 'soap');
    sessionStorage.setItem('noteType', 'soap');
    nav('/capture');
  }

  function openNote(n: Note) {
    nav(`/note/${encodeURIComponent(n.id)}`);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // One round-trip each for patients and notes; group locally. Previously
      // this was listNotes(id) per patient = N round-trips on every mount.
      const [ps, allNotes] = await Promise.all([listPatients(), listAllNotes()]);
      if (cancelled) return;
      ps.sort((a, b) => b.updatedAt - a.updatedAt);
      setPatients(ps);
      const m: Record<string, Note[]> = {};
      for (const n of allNotes) {
        (m[n.patientId] ??= []).push(n);
      }
      for (const id in m) {
        m[id]!.sort((a, b) => b.updatedAt - a.updatedAt);
      }
      setNotesByPid(m);
      setCostsByPid(loadPerPatient());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!q) return patients;
    const qLower = q.toLowerCase();
    return patients.filter((p) => {
      if (p.name.toLowerCase().includes(qLower)) return true;
      if (p.teudatZehut.includes(q)) return true;
      if ((p.room ?? '').toLowerCase().includes(qLower)) return true;
      const notes = notesByPid[p.id] ?? [];
      return notes.some((n) => n.bodyHebrew.toLowerCase().includes(qLower));
    });
  }, [patients, notesByPid, q]);

  return (
    <section>
      <h1>היסטוריה</h1>
      <input
        dir="auto"
        placeholder="חיפוש לפי שם / ת.ז. / חדר"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {filtered.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <p className="empty-title">
            {patients.length === 0 ? 'אין רשומות עדיין' : 'אין התאמות לחיפוש'}
          </p>
          <p className="empty-sub">
            {patients.length === 0 ? 'צלם AZMA כדי להתחיל' : 'נסה חיפוש אחר'}
          </p>
          {patients.length === 0 && <button onClick={() => nav('/capture')}>↤ צלם</button>}
        </div>
      )}

      {filtered.map((p) => {
        const notes = notesByPid[p.id] ?? [];
        const cost = costsByPid[p.id];
        return (
          <div
            key={p.id}
            style={{
              background: 'var(--card)',
              padding: 12,
              borderRadius: 8,
              marginTop: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
              <strong>{p.name || '(ללא שם)'}</strong>
              <small style={{ color: 'var(--muted)' }}>
                {p.teudatZehut} · חדר {p.room ?? '—'}
              </small>
            </div>

            {cost && cost.usd > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                עלות: ${cost.usd.toFixed(3)} · {cost.inputTokens + cost.outputTokens} tokens
              </div>
            )}

            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNote(n)}
                  className="note-row"
                  aria-label={`פתח ${NOTE_LABEL[n.type]}`}
                >
                  <span style={{ fontSize: 13 }}>
                    {n.sentToEmrAt ? '✓ ' : ''}{NOTE_LABEL[n.type]}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(n.updatedAt).toLocaleDateString('he-IL')}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginInlineStart: 'auto' }}>
                    {previewOneLine(n.bodyHebrew)}
                  </span>
                </button>
              ))}
              {notes.length === 0 && (
                <small style={{ color: 'var(--muted)' }}>אין רשומות עדיין</small>
              )}
            </div>

            <button
              className="ghost"
              style={{ marginTop: 8, fontSize: 13, padding: '6px 10px', minHeight: 32 }}
              onClick={() => startSoapForPatient(p)}
            >
              + SOAP היום
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** One-line preview of the note body — strips line breaks and trims to ~60 chars. */
function previewOneLine(body: string, n = 60): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= n) return flat;
  return flat.slice(0, n).trimEnd() + '…';
}
