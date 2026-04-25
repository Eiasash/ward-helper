import type { Note } from '@/storage/indexed';

/**
 * Render the saved safety flags from a patient's most recent note as
 * a small row of pills. Used on History and Today patient cards.
 *
 * Pill colors mirror clinical urgency:
 *   - Beers ×N    → red (any age-inappropriate prescribing)
 *   - STOPP ×N    → amber (interaction / wrong combo)
 *   - ACB=N       → amber if ≥3, red if ≥6 (delirium/falls risk)
 *
 * START hits are NOT shown — they're "missing" prescriptions, useful for
 * the doctor to see at extract time but noisy at the card level.
 */
export function SafetyPills({ notes }: { notes: Note[] }) {
  // Walk newest-first looking for a note that carries safetyFlags. Most
  // patients have only one or two notes; the linear scan is cheap.
  const flagged = notes.find((n) => n.safetyFlags);
  if (!flagged?.safetyFlags) return null;
  const f = flagged.safetyFlags;
  const beersN = f.beers.length;
  const stoppN = f.stopp.length;
  const acb = f.acbScore;
  if (beersN === 0 && stoppN === 0 && acb < 3) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        marginTop: 4,
        flexWrap: 'wrap',
        fontSize: 11,
      }}
      role="status"
      aria-label="דגלי בטיחות תרופתית"
    >
      {beersN > 0 && (
        <span
          dir="ltr"
          style={{
            background: 'var(--red, #c53030)',
            color: 'white',
            padding: '1px 6px',
            borderRadius: 10,
          }}
        >
          Beers ×{beersN}
        </span>
      )}
      {stoppN > 0 && (
        <span
          dir="ltr"
          style={{
            background: 'var(--warn, #d69e2e)',
            color: 'black',
            padding: '1px 6px',
            borderRadius: 10,
          }}
        >
          STOPP ×{stoppN}
        </span>
      )}
      {acb >= 3 && (
        <span
          dir="ltr"
          style={{
            background: acb >= 6 ? 'var(--red, #c53030)' : 'var(--warn, #d69e2e)',
            color: acb >= 6 ? 'white' : 'black',
            padding: '1px 6px',
            borderRadius: 10,
          }}
        >
          ACB={acb}
        </span>
      )}
    </div>
  );
}
