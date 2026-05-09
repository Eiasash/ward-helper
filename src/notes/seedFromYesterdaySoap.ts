import type { Patient } from '@/storage/indexed';
import { resolveContinuity } from '@/notes/continuity';
import { DISCHARGE_STALE_GAP_MS } from '@/engine/dayContinuity';

export type SeedDecision =
  | { kind: 'no-prefill'; reason: 'no-history' | 'discharge-gap' }
  | {
      kind: 'prefill';
      bodyContext: string;
      patientFields: {
        handoverNote: string;
        planLongTerm: string;
        clinicalMeta: Record<string, string>;
      };
    };

/**
 * Decides whether today's SOAP draft should seed from yesterday's note.
 * Async because it touches IDB via resolveContinuity. Two-gate logic:
 *   1. discharge-gap (24h): a stale-discharged patient skips prefill regardless of SOAP age
 *   2. no-history: patient with no qualifying SOAP within the 30-day episode window
 */
export async function decideSeed(patient: Patient): Promise<SeedDecision> {
  // Gate 1: discharge gap (advisor concern 3 — fires before episode window).
  // An old discharge (>24h) takes precedence over a recent SOAP from before
  // the discharge — the patient is not "in" anymore; do not seed.
  if (
    patient.discharged === true &&
    typeof patient.dischargedAt === 'number' &&
    Date.now() - patient.dischargedAt > DISCHARGE_STALE_GAP_MS
  ) {
    return { kind: 'no-prefill', reason: 'discharge-gap' };
  }
  // Gate 2: existing 30-day episode window via resolveContinuity.
  const ctx = await resolveContinuity(patient.teudatZehut);
  if (!ctx.mostRecentSoap) {
    return { kind: 'no-prefill', reason: 'no-history' };
  }
  return {
    kind: 'prefill',
    bodyContext: ctx.mostRecentSoap.bodyHebrew,
    patientFields: {
      handoverNote: patient.handoverNote ?? '',
      planLongTerm: patient.planLongTerm ?? '',
      // Shallow copy: callers may mutate the returned map without corrupting
      // the in-memory patient record. Values are strings so deep copy is unnecessary.
      clinicalMeta: { ...(patient.clinicalMeta ?? {}) },
    },
  };
}

export interface ReadmitResult {
  isReadmit: boolean;
  gapDays?: number;
}

/**
 * Read-only predicate — safe to call in render. Returns whether a discharged
 * patient is being re-admitted, plus how many days since the prior discharge.
 * Mutation (un-discharge) is the caller's responsibility — the UI dispatches
 * `unDischargePatient` separately after doctor confirmation in PR 3.
 */
export function detectReadmit(patient: Patient): ReadmitResult {
  if (!patient.discharged || typeof patient.dischargedAt !== 'number') {
    return { isReadmit: false };
  }
  const gapMs = Date.now() - patient.dischargedAt;
  return { isReadmit: true, gapDays: Math.floor(gapMs / (24 * 60 * 60 * 1000)) };
}
