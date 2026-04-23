import { useState } from 'react';
import type { Confidence } from '@/agent/tools';
import { ConfidencePill } from './ConfidencePill';

interface Props {
  label: string;
  value: string;
  confidence: Confidence | undefined;
  sourceRegion: string | undefined;
  onChange: (v: string) => void;
  critical?: boolean;
}

export function FieldRow({ label, value, confidence, sourceRegion, onChange, critical }: Props) {
  const needsConfirm = confidence === 'low' || (critical && !confidence);
  const [confirmed, setConfirmed] = useState(!needsConfirm);

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--card)',
        borderRadius: 8,
        marginBottom: 8,
        opacity: confirmed ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong>{label}</strong>
        <ConfidencePill level={confidence} />
      </div>
      {sourceRegion && (
        <small style={{ color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
          מקור: {sourceRegion}
        </small>
      )}
      <input dir="auto" value={value} onChange={(e) => onChange(e.target.value)} />
      {needsConfirm && !confirmed && (
        <button className="ghost" onClick={() => setConfirmed(true)} style={{ marginTop: 6 }}>
          אישור ידני נדרש
        </button>
      )}
    </div>
  );
}

export function isRowConfirmed(confidence: Confidence | undefined, critical: boolean, confirmed: boolean): boolean {
  const needsConfirm = confidence === 'low' || (critical && !confidence);
  return !needsConfirm || confirmed;
}
