import { useEffect, useState } from 'react';
import { getPatient } from '@/storage/indexed';
import { dismissTomorrowNote, promoteToHandover } from '@/storage/rounds';

const bannerStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--accent)',
  padding: 12,
  margin: '8px 0',
  borderRadius: 8,
};

interface Props { patientId: string; }

export function TomorrowBanner({ patientId }: Props) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const p = await getPatient(patientId);
      if (cancelled) return;
      setLines(p?.tomorrowNotes ?? []);
    }
    void refresh();
    const handler = () => void refresh();
    window.addEventListener('ward-helper:patients-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('ward-helper:patients-changed', handler);
    };
  }, [patientId]);

  if (lines.length === 0) return null;

  return (
    <div style={bannerStyle} dir="auto">
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>הערות למחר</h3>
      <ul style={{ margin: 0, paddingInlineStart: 20 }}>
        {lines.map((line, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <span>{line}</span>
            <button
              style={{ marginInlineStart: 8 }}
              onClick={() => void dismissTomorrowNote(patientId, i)}
            >
              דחה
            </button>
            <button
              style={{ marginInlineStart: 4 }}
              onClick={() => void promoteToHandover(patientId, i)}
            >
              הפוך לקבועה
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
