import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listNotesByTeudatZehut, type Note } from '@/storage/indexed';
import { NOTE_LABEL } from '@/notes/templates';

interface Props {
  tz: string | undefined;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function fmtDaysAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  return `לפני ${days} ימים`;
}

export function PriorNotesBanner({ tz }: Props) {
  const nav = useNavigate();
  const [notes, setNotes] = useState<Note[] | null>(null);

  // Re-query only when tz changes — not on every field edit.
  useEffect(() => {
    const t = tz?.trim();
    if (!t) {
      setNotes(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { notes: found } = await listNotesByTeudatZehut(t);
      if (cancelled) return;
      setNotes(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [tz]);

  if (!notes || notes.length === 0) return null;

  const last = notes.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--accent)',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        ✓ מטופל מוכר — <strong>{`${notes.length} רישומים קודמים`}</strong>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 10 }}>
        אחרון: {NOTE_LABEL[last.type]} · {fmtDate(last.updatedAt)} ({fmtDaysAgo(last.updatedAt)})
      </div>
      <button
        className="ghost"
        onClick={() => nav(`/history?q=${encodeURIComponent(tz!.trim())}`)}
      >
        ראה היסטוריה →
      </button>
    </div>
  );
}
