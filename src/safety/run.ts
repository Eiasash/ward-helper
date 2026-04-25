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

// Comfort-care / hospice / palliative tokens. START rules ("should add
// this drug") are inappropriate at end of life — the goal is symptom
// control, not preventive medicine. Beers, STOPP, ACB still fire because
// drug-drug harm and anticholinergic burden remain clinically relevant
// even on comfort care (in fact more so — patients are frailer).
//
// Match is case-insensitive but exact-token: a condition string of
// "comfort care" matches, but "atrial fibrillation, transitioning to
// comfort care" does not. The deliberate false-negative bias is safer —
// suppressing START on a non-comfort patient would mask real prescribing
// gaps. The doctor can always tag the patient with the literal token.
const COMFORT_CONDITIONS = new Set([
  'comfort-care',
  'comfort care',
  'hospice',
  'palliative',
  'טיפול תומך',
  'הוספיס',
  'פליאטיבי',
]);

function isComfortCare(patient: PatientContext): boolean {
  return (
    patient.conditions?.some((c) => COMFORT_CONDITIONS.has(c.toLowerCase().trim())) ??
    false
  );
}

export function runSafetyChecks(
  meds: Med[],
  patient: PatientContext = {},
): SafetyFlags {
  const safeMeds = meds ?? [];
  const comfort = isComfortCare(patient);
  return {
    beers: checkBeers(safeMeds, patient),
    stopp: checkStopp(safeMeds, patient),
    start: comfort ? [] : checkStart(safeMeds, patient),
    acbScore: computeAcb(safeMeds).totalScore,
  };
}
