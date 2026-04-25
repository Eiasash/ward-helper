/**
 * Shared types for the drug-safety engine. All four sub-engines (Beers,
 * STOPP, START, ACB) emit `Hit` records into a single SafetyResult so the
 * UI can render them uniformly.
 *
 * Med shape mirrors the extracted ParseFields.meds[] from agent/loop —
 * `name` is the only required field. `dose` and `freq` come along when
 * the model can read them, but the rule engines must work without.
 */

export interface Med {
  name: string;
  dose?: string;
  freq?: string;
  /**
   * Duration of therapy in months, when known. Drives Beers PPI > 8 weeks
   * and STOPP "PPI > 8 weeks at full dose" — neither rule fires when
   * unknown (we can't infer from a snapshot of meds at admission).
   */
  durationMonths?: number;
  /** Free-text indication, when the EMR provides one. */
  indication?: string;
}

export interface PatientContext {
  age?: number;
  sex?: 'M' | 'F';
  /**
   * Free-text condition list. Rules match case-insensitively against the
   * concatenation of these strings; English terms (CKD, AF, CHF, T2DM,
   * dementia, osteoporosis, falls, post-MI) and Hebrew equivalents both
   * work where the rule's regex is bilingual.
   */
  conditions?: string[];
  /** eGFR in mL/min/1.73m², if known — drives the CKD/NSAID rule. */
  egfr?: number;
}

export type Severity = 'critical' | 'high' | 'moderate' | 'low';

export interface Hit {
  /** Rule code — e.g. "BEERS-PPI-LONG", "STOPP-NSAID-WARFARIN". */
  code: string;
  /** Drug or pair the rule fired on, in display form. */
  drug: string;
  /** Hebrew, terse, imperative — one line, fits on a wide phone row. */
  recommendation: string;
  severity: Severity;
}

export interface SafetyFlags {
  beers: Hit[];
  stopp: Hit[];
  start: Hit[];
  acbScore: number;
}
