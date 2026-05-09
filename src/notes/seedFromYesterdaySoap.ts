import type { Patient } from '@/storage/indexed';
import { resolveContinuity } from '@/notes/continuity';
import { DISCHARGE_STALE_GAP_MS } from '@/engine/dayContinuity';

export type SeedDecision =
  | { kind: 'no-prefill'; reason: 'no-history' | 'discharge-gap' | 'episode-stale' }
  | {
      kind: 'prefill';
      bodyContext: string;
      patientFields: {
        handoverNote: string;
        planLongTerm: string;
        clinicalMeta: Record<string, string>;
      };
    };

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
    return {
      kind: 'no-prefill',
      reason: ctx.episodeStart === null ? 'no-history' : 'episode-stale',
    };
  }
  return {
    kind: 'prefill',
    bodyContext: ctx.mostRecentSoap.bodyHebrew,
    patientFields: {
      handoverNote: patient.handoverNote ?? '',
      planLongTerm: patient.planLongTerm ?? '',
      clinicalMeta: patient.clinicalMeta ?? {},
    },
  };
}

export interface ReadmitResult {
  isReadmit: boolean;
  gapDays?: number;
}

/**
 * Read-only check for whether a patient appears to be a readmit (was previously
 * discharged). Does NOT mutate state — the UI dispatches `unDischargePatient`
 * separately after doctor confirmation in PR 3.
 */
export function detectReadmit(patient: Patient): ReadmitResult {
  if (!patient.discharged || typeof patient.dischargedAt !== 'number') {
    return { isReadmit: false };
  }
  const gapMs = Date.now() - patient.dischargedAt;
  return { isReadmit: true, gapDays: Math.floor(gapMs / (24 * 60 * 60 * 1000)) };
}
