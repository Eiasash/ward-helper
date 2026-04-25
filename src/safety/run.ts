/**
 * Safety orchestrator — single entry point for the four sub-engines.
 *
 * Lazy-loaded from Review.tsx via dynamic import(). Keeping run.ts as
 * the only public face means the entry chunk doesn't pull in any of
 * the rule data.
 */

import type { Med, PatientContext, SafetyFlags } from './types';
import { checkBeers } from './beers';
import { checkStopp } from './stopp';
import { checkStart } from './start';
import { computeAcb } from './acb';

export type { Med, PatientContext, SafetyFlags, Hit, Severity } from './types';

export function runSafetyChecks(
  meds: Med[],
  patient: PatientContext = {},
): SafetyFlags {
  const safeMeds = meds ?? [];
  return {
    beers: checkBeers(safeMeds, patient),
    stopp: checkStopp(safeMeds, patient),
    start: checkStart(safeMeds, patient),
    acbScore: computeAcb(safeMeds).totalScore,
  };
}
