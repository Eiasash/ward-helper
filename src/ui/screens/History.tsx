import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPatients, listNotes, type Patient, type Note } from '@/storage/indexed';
import { NOTE_LABEL } from '@/notes/templates';
import { loadPerPatient, type Totals } from '@/agent/costs';

export function History() {
  const nav = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [notesByPid, setNotesByPid] = useState<Record<string, Note[]>>({});
  const [costsByPid, setCostsByPid] = useState<Record<string, Totals>>({});
  const [q, setQ] = useState('');

  function startSoapForPatient() {
    sessionStorage.setItem('continuityNoteType', 'soap');
    sessionStorage.setItem('noteType', 'soap');
    nav('/');
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ps = await listPatients();
      ps.sort((a, b) => b.updatedAt - a.updatedAt);
      if (cancelled) return;
      setPatients(ps);
      const m: Record<string, Note[]> = {};
      for (const p of ps) m[p.id] = await listNotes(p.id);
      if (cancelled) return;
      setNotesByPid(m);
      setCostsByPid(loadPerPatient());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = patients.filter((p) =>
    !q ||
    p.name.includes(q) ||
    p.teudatZehut.includes(q) ||
    (p.room ?? '').includes(q),
  );

  return (
    <section>
      <h1>היסטוריה</h1>
      <input
        dir="auto"
        placeholder="חיפוש לפי שם / ת.ז. / חדר"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {filtered.length === 0 && patients.length === 0 && (
        <p style={{ color: 'var(--muted)', marginTop: 16 }}>עדיין אין רשומות מקומיות.</p>
      )}
      {filtered.map((p) => (
        <div
          key={p.id}
          style={{ background: 'var(--card)', padding: 12, borderRadius: 8, marginTop: 8 }}
        >
          <strong>{p.name || '(ללא שם)'}</strong>{' '}
          <small style={{ color: 'var(--muted)' }}>
            {p.teudatZehut} · חדר {p.room ?? '—'}
          </small>
          {costsByPid[p.id] && costsByPid[p.id]!.usd > 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              עלות: ${costsByPid[p.id]!.usd.toFixed(3)} ·{' '}
              {costsByPid[p.id]!.inputTokens + costsByPid[p.id]!.outputTokens} tokens
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            {(notesByPid[p.id] ?? []).map((n) => (
              <div key={n.id} style={{ fontSize: 13, color: 'var(--muted)' }}>
                {NOTE_LABEL[n.type]} · {new Date(n.updatedAt).toLocaleDateString('he-IL')}
              </div>
            ))}
          </div>
          <button
            className="ghost"
            style={{ marginTop: 8, fontSize: 13, padding: '6px 10px', minHeight: 32 }}
            onClick={() => startSoapForPatient()}
          >
            + SOAP היום
          </button>
        </div>
      ))}
    </section>
  );
}
