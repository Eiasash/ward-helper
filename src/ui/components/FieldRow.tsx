import { useState, useEffect } from 'react';
import type { Confidence } from '@/agent/tools';
import { ConfidencePill } from './ConfidencePill';

interface Props {
  label: string;
  value: string;
  confidence: Confidence | undefined;
  onChange: (v: string) => void;
  critical?: boolean;
  /**
   * Notify the parent when this row's confirmation state changes. Fires once
   * on mount with the initial state, then on every state change (confidence
   * shift OR user tap on the confirm button). Lets Review.tsx gate the
   * Proceed button on whether all critical rows have been acknowledged.
   *
   * Returns `true` when the row is in an acceptable state to proceed —
   * either because confidence is high/med (no manual confirm needed) or
   * because the doctor explicitly tapped "אישור ידני נדרש".
   *
   * Pre-v1.21.3 this prop didn't exist and FieldRow's confirmation state
   * was purely visual (0.6 opacity). The doctor could ignore the cue and
   * tap Proceed anyway, generating a Chameleon-bound note from unverified
   * extracts. The wire-up was always intended (see exported isRowConfirmed
   * helper) but never finished until v1.21.3.
   */
  onConfirmChange?: (confirmed: boolean) => void;
}

export function FieldRow({ label, value, confidence, onChange, critical, onConfirmChange }: Props) {
  const needsConfirm = confidence === 'low' || (critical && !confidence);
  const [confirmed, setConfirmed] = useState(!needsConfirm);

  // Keep the parent in sync with this row's confirmation state. Effect runs
  // on mount AND on every change to needsConfirm/confirmed, so the parent
  // sees a consistent view across re-renders (e.g., when extract data
  // updates and confidence flips, or when the user taps the confirm button).
  useEffect(() => {
    onConfirmChange?.(!needsConfirm || confirmed);
  }, [needsConfirm, confirmed, onConfirmChange]);

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
