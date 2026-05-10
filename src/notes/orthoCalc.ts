// src/notes/orthoCalc.ts
//
// Three pure date calculators for the SZMC ortho-rehab cohort:
//   - calculatePOD(surgeryDateISO, todayISO?)
//   - suggestSutureRemovalDate(surgeryDateISO, site, modifiers?)
//   - suggestDvtProphylaxis(surgeryDateISO, renalState?)
//
// TZ-SAFE: all date math uses LOCAL Date getters (year/month/date), never
// `toISOString().slice(0, 10)`. The latter converts to UTC and silently
// produces off-by-one dates in Asia/Jerusalem (and any non-UTC zone).
// The v1 brief had this bug; v2 (this file) fixes it. The regression test
// in __tests__/orthoCalc.test.ts pins the local-zone behavior — do not
// "simplify" back to toISOString().
//
// Source-of-truth for clinical content: ~/.claude/skills/rehab-quickref/ +
// ~/.claude/skills/ortho-reference/. See src/data/orthoReference.ts.

// ─── Local-zone date helpers (TZ-safe) ─────────────────────────────────

/** Format a Date as YYYY-MM-DD using LOCAL year/month/date (not UTC). */
function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a Date as DD/MM/YY using LOCAL year/month/date (not UTC). */
function toLocalDDMMYY(d: Date): string {
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}/${m}/${y}`;
}

/** Parse 'YYYY-MM-DD' as a local-midnight Date (not UTC midnight). */
function parseLocalISO(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid YYYY-MM-DD: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

const MS_PER_DAY = 86_400_000;

// ─── calculatePOD ──────────────────────────────────────────────────────

/**
 * Post-operative day count (POD).
 * POD 0 = surgery day. POD 1 = day after.
 *
 * Uses local-zone day boundaries — matches what the doctor sees on the wall.
 *
 * @param surgeryDateISO 'YYYY-MM-DD'
 * @param todayISO       'YYYY-MM-DD', defaults to today (local)
 * @returns POD as integer >= 0 (clamped — future surgery date returns 0)
 */
export function calculatePOD(surgeryDateISO: string, todayISO?: string): number {
  const surgery = parseLocalISO(surgeryDateISO);
  const today = todayISO ? parseLocalISO(todayISO) : (() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  })();
  const diffDays = Math.round((today.getTime() - surgery.getTime()) / MS_PER_DAY);
  return Math.max(0, diffDays);
}

// ─── suggestSutureRemovalDate ──────────────────────────────────────────

export type SutureSiteKey =
  | 'face'
  | 'scalp'
  | 'trunk'
  | 'hip'
  | 'spine'
  | 'knee'
  | 'foot';

export interface SutureModifiersInput {
  steroids?: boolean;
  dmUncontrolled?: boolean;
  malnutrition?: boolean;
  smoker?: boolean;
  woundUnderTension?: boolean;
  infectionSigns?: boolean;
}

export interface SutureRemovalSuggestion {
  dateISO: string;
  podStandard: number;
  podAdjusted: number;
  modifiersApplied: string[];
}

const SITE_POD: Record<SutureSiteKey, { min: number; max: number }> = {
  face: { min: 5, max: 7 },
  scalp: { min: 7, max: 10 },
  trunk: { min: 10, max: 14 },
  hip: { min: 10, max: 14 },
  spine: { min: 14, max: 14 },
  knee: { min: 14, max: 14 },
  foot: { min: 14, max: 21 },
};

/**
 * Suggest suture removal date by anatomic site + modifiers.
 * SZMC convention: default to the MAX of the site window (most defensible),
 * then add modifier extensions. Clinician extends further if wound concerns.
 *
 * @returns local-zone date YYYY-MM-DD + POD breakdown.
 */
export function suggestSutureRemovalDate(
  surgeryDateISO: string,
  site: SutureSiteKey,
  modifiers: SutureModifiersInput = {},
): SutureRemovalSuggestion {
  const range = SITE_POD[site];
  if (!range) throw new Error(`Unknown site: ${site}`);

  const podStandard = range.max; // SZMC convention: max of window
  let extraDays = 0;
  const applied: string[] = [];

  if (modifiers.steroids) {
    extraDays += 5;
    applied.push('steroids/immunosuppression +5d');
  }
  if (modifiers.dmUncontrolled) {
    extraDays += 5;
    applied.push('uncontrolled DM +5d');
  }
  if (modifiers.malnutrition) {
    extraDays += 4;
    applied.push('malnutrition (albumin under 3) +4d');
  }
  if (modifiers.smoker) {
    extraDays += 3;
    applied.push('smoking/vascular +3d');
  }
  if (modifiers.woundUnderTension) {
    extraDays += 3;
    applied.push('wound under tension +3d');
  }
  if (modifiers.infectionSigns) {
    extraDays += 7;
    applied.push('infection signs +7d (consult ortho)');
  }

  const podAdjusted = podStandard + extraDays;
  const surgery = parseLocalISO(surgeryDateISO);
  const target = new Date(surgery.getTime() + podAdjusted * MS_PER_DAY);

  return {
    dateISO: toLocalISO(target),
    podStandard,
    podAdjusted,
    modifiersApplied: applied,
  };
}

// ─── suggestDvtProphylaxis ─────────────────────────────────────────────

export type DvtRenalState = 'normal' | 'crclLow' | 'hd' | 'bleedingRisk';

export interface DvtProphylaxisSuggestion {
  drug: string;
  doseSC: string;
  frequency: string;
  durationDays: number;
  endDateISO: string;
  hebrewLine: string;
}

const DVT_DURATION_DAYS = 35;

/**
 * Suggest DVT prophylaxis end date for hip post-op.
 * SZMC default: 35 days post-op for all renal states.
 *
 * Hebrew line uses local-zone DD/MM/YY end date.
 */
export function suggestDvtProphylaxis(
  surgeryDateISO: string,
  renalState: DvtRenalState = 'normal',
): DvtProphylaxisSuggestion {
  const surgery = parseLocalISO(surgeryDateISO);
  const end = new Date(surgery.getTime() + DVT_DURATION_DAYS * MS_PER_DAY);
  const endDateISO = toLocalISO(end);
  const endDateDDMM = toLocalDDMMYY(end);

  const PRESETS: Record<
    DvtRenalState,
    Pick<DvtProphylaxisSuggestion, 'drug' | 'doseSC' | 'frequency' | 'hebrewLine'>
  > = {
    normal: {
      drug: 'Enoxaparin',
      doseSC: '40mg',
      frequency: 'daily',
      hebrewLine: `ENOXAPARIN 40mg SC פעם ביום עד ${endDateDDMM}`,
    },
    crclLow: {
      drug: 'Enoxaparin',
      doseSC: '20mg',
      frequency: 'daily',
      hebrewLine: `ENOXAPARIN 20mg SC פעם ביום (CrCl נמוך מ-30) עד ${endDateDDMM}`,
    },
    hd: {
      drug: 'Enoxaparin',
      doseSC: '20mg',
      frequency: 'daily',
      hebrewLine: `ENOXAPARIN 20mg SC פעם ביום (המודיאליזה) עד ${endDateDDMM}`,
    },
    bleedingRisk: {
      drug: 'UFH',
      doseSC: '5000 units',
      frequency: 'BID-TID',
      hebrewLine: `UFH 5000 יחידות SC פעמיים-שלוש ביום עד ${endDateDDMM}`,
    },
  };

  const preset = PRESETS[renalState];
  if (!preset) throw new Error(`Unknown renalState: ${renalState}`);

  return {
    ...preset,
    durationDays: DVT_DURATION_DAYS,
    endDateISO,
  };
}
