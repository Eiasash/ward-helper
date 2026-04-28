/**
 * Three-bead progress indicator for the capture → review pipeline.
 *
 * Replaces a generic spinner with explicit phase microcopy:
 *   1. Capturing  (camera roll → memory)
 *   2. Compressing (1600px long edge, JPEG q=0.85; see compress.ts)
 *   3. Awaiting AI (extract turn through the proxy)
 *
 * Phase transitions are intentionally not animated automatically — the
 * caller drives them by passing a current `phase` prop. Past beads stay
 * filled, current pulses, future beads are dim. RTL-aware (Hebrew labels,
 * right-to-left bead order matches the natural Hebrew reading flow).
 */
export type CapturePhase = 'capturing' | 'compressing' | 'awaiting-ai';

const ORDER: CapturePhase[] = ['capturing', 'compressing', 'awaiting-ai'];

const LABELS: Record<CapturePhase, string> = {
  capturing: 'מצלם',
  compressing: 'דוחס',
  'awaiting-ai': 'מחכה ל-AI',
};

interface Props {
  phase: CapturePhase;
  /** Optional sub-line — e.g. "(12s)" when the phase is dragging. */
  hint?: string;
}

export function CapturePhaseBeads({ phase, hint }: Props) {
  const idx = ORDER.indexOf(phase);
  return (
    <div
      className="capture-phase-beads"
      role="status"
      aria-live="polite"
      aria-label={`שלב: ${LABELS[phase]}${hint ? ` ${hint}` : ''}`}
      dir="rtl"
    >
      <div className="capture-phase-beads-row">
        {ORDER.map((p, i) => {
          const past = i < idx;
          const current = i === idx;
          return (
            <div key={p} className="capture-phase-bead-wrap">
              <span
                className={
                  current
                    ? 'capture-phase-bead current'
                    : past
                      ? 'capture-phase-bead past'
                      : 'capture-phase-bead future'
                }
                aria-hidden="true"
              />
              <span
                className={
                  current ? 'capture-phase-label current' : 'capture-phase-label'
                }
              >
                {LABELS[p]}
              </span>
            </div>
          );
        })}
      </div>
      {hint && <p className="capture-phase-hint">{hint}</p>}
    </div>
  );
}
