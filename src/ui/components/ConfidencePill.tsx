import type { Confidence } from '@/agent/tools';

const COLORS: Record<Confidence, string> = {
  low: 'var(--red)',
  med: 'var(--amber)',
  high: 'var(--good)',
};

export function ConfidencePill({ level }: { level: Confidence | undefined }) {
  const l = level ?? 'low';
  return (
    <span
      style={{
        background: COLORS[l],
        color: '#000',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {l}
    </span>
  );
}
