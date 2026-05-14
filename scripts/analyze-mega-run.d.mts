/**
 * Type declarations for `./analyze-mega-run.mjs`. Exists because tsconfig has
 * `strict: true` (→ noImplicitAny) and `include: [...,"scripts"]`, so
 * `tests/megaPersonaRebound.test.ts`'s import from a `.mjs` file would
 * otherwise implicitly resolve to `any` and fail typecheck.
 *
 * Keep in sync with `analyze-mega-run.mjs` — the `.mjs` is the source of
 * truth for runtime behavior; this file only describes its public shape to TS.
 */

export function evaluateReboundSanityBounds(
  personaName: string,
  tally: {
    actions?: number;
    rebound_attempts?: number;
    rebound_successes?: number;
    layer2_recoveries?: number;
  },
): {
  persona: string;
  breaches: Array<{
    kind: 'rebound-rate-high' | 'rebound-success-degraded' | 'layer2-recoveries-high';
    severity: 'MEDIUM';
    detail: string;
  }>;
};
