import type { Confidence } from '@/agent/tools';

/**
 * Inline pill rendered next to the three critical-identifier rows
 * (name / teudat-zehut / age) on the Review screen.
 *
 * The extract turn emits one of three string levels per critical field:
 * 'high' / 'med' / 'low'. We map those onto the doctor-facing thresholds
 * the spec calls out:
 *   - high  ≡ ≥0.9 (green / "ביטחון גבוה")
 *   - med   ≡ 0.6 – 0.9 (amber / "ביטחון בינוני")
 *   - low   ≡ < 0.6 (red / "ביטחון נמוך")
 *
 * The mapping is documented in `levelToScore` so a future migration to
 * numeric confidence (when the model emits floats) is a one-line change.
 *
 * RTL-aware: the pill sits inline next to the field label and renders
 * Hebrew microcopy. dir="auto" keeps it correct in either direction.
 */

export type ConfidenceTier = 'high' | 'med' | 'low' | 'unknown';

const COLORS: Record<ConfidenceTier, { bg: string; fg: string; border: string }> = {
  high: {
    bg: 'var(--good-soft)',
    fg: 'var(--good)',
    border: 'rgba(78, 194, 126, 0.45)',
  },
  med: {
    bg: 'var(--warn-soft)',
    fg: 'var(--warn)',
    border: 'rgba(230, 181, 92, 0.45)',
  },
  low: {
    bg: 'var(--err-soft)',
    fg: 'var(--err)',
    border: 'rgba(229, 106, 106, 0.45)',
  },
  unknown: {
    bg: 'var(--surface-3)',
    fg: 'var(--muted)',
    border: 'var(--border)',
  },
};

const LABEL: Record<ConfidenceTier, string> = {
  high: 'ביטחון ≥ 0.9',
  med: 'ביטחון 0.6–0.9',
  low: 'ביטחון < 0.6',
  unknown: 'לא דורג',
};

const SHORT: Record<ConfidenceTier, string> = {
  high: '✓ גבוה',
  med: '~ בינוני',
  low: '! נמוך',
  unknown: '? לא דורג',
};

/**
 * Map the categorical level to its numeric threshold range. Centralized so
 * that tests can lock the bucket boundaries without touching component
 * rendering.
 *
 * Returns:
 *   high → ≥ 0.9
 *   med  → 0.6 ≤ x < 0.9
 *   low  → < 0.6
 *
 * `unknown` returns null — the model didn't emit a confidence for this
 * field and we shouldn't manufacture one.
 */
export function levelToScore(level: Confidence | undefined): {
  tier: ConfidenceTier;
  min: number | null;
  max: number | null;
} {
  switch (level) {
    case 'high':
      return { tier: 'high', min: 0.9, max: 1.0 };
    case 'med':
      return { tier: 'med', min: 0.6, max: 0.9 };
    case 'low':
      return { tier: 'low', min: 0, max: 0.6 };
    default:
      return { tier: 'unknown', min: null, max: null };
  }
}

/**
 * Inverse mapping — given a numeric score (e.g. if extract upgrades to
 * floats), return the matching tier. Bucket edges:
 *   ≥ 0.9 → high
 *   ≥ 0.6 → med
 *   < 0.6 → low
 *
 * Out-of-range scores clamp into the nearest tier rather than returning
 * "unknown" — a model that emits 1.2 by mistake should still show green.
 */
export function scoreToTier(score: number): ConfidenceTier {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 0.9) return 'high';
  if (score >= 0.6) return 'med';
  return 'low';
}

export function ConfidencePill({ level }: { level: Confidence | undefined }) {
  const { tier } = levelToScore(level);
  const c = COLORS[tier];
  return (
    <span
      dir="auto"
      title={LABEL[tier]}
      aria-label={LABEL[tier]}
      data-confidence={tier}
      style={{
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {SHORT[tier]}
    </span>
  );
}
