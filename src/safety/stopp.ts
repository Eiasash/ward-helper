/**
 * STOPP v3 — Screening Tool of Older Persons' Prescriptions.
 *
 * Drug-drug and drug-context combinations that should be stopped or
 * reviewed in patients ≥ 65y. We carry the rules that are common in
 * Israeli geriatric wards and that change immediate orders. Pure
 * function rules following the same shape as beers.ts.
 */

import type { Hit, Med, PatientContext } from './types';
import { NSAID_RE, PPI_RE } from './drugPatterns';

const WARFARIN_RE = /warfarin|וורפרין|coumadin/i;
// DOAC class for the critical NSAID-DOAC bleed rule (trigger → over-broad is
// safe). edoxaban/Lixiana was missing here while START's ANTICOAG_RE carried it
// — that asymmetry meant a Lixiana + NSAID patient got NO critical-bleed flag.
// doacCoverage.test.ts now locks all four DOACs across both engines so the drift
// cannot recur (full hoist to drugPatterns.ts deferred — START's set adds
// warfarin and must not be collapsed into a DOAC-only pattern).
const APIXABAN_RE =
  /apixaban|אפיקסבן|eliquis|rivaroxaban|ריברוקסבן|xarelto|dabigatran|דביגטרן|pradaxa|edoxaban|אדוקסבן|lixiana/i;
const BETA_BLOCKER_RE = /metoprolol|bisoprolol|atenolol|carvedilol|propranolol|מטופרולול|ביסופרולול/i;
const VERAPAMIL_RE = /verapamil|וראפמיל|diltiazem|דילטיאזם/i;
// (?<!apo) / (?<!אפו) exclude apomorphine (Parkinson's dopamine agonist, not an
// opioid) which contains the "morphine" substring.
const OPIOID_RE = /(?<!apo)morphine|oxycodone|fentanyl|tramadol|codeine|hydromorphone|(?<!אפו)מורפין|אוקסיקודון|טרמדול/i;
const LAXATIVE_RE = /lactulose|polyethylene\s*glycol|peg\b|senna|bisacodyl|לקטולוז|מקוגול|movicol/i;
const ACEI_RE =
  /enalapril|ramipril|lisinopril|captopril|perindopril|fosinopril|quinapril|benazepril|trandolapril|אנלפריל|רמיפריל|קפטופריל/i;
const ARB_RE =
  /losartan|valsartan|candesartan|telmisartan|olmesartan|irbesartan|azilsartan|eprosartan|לוסרטן|ולסרטן/i;
// Antiplatelets for the dual-antiplatelet rule (trigger). Israeli low-dose
// aspirin is dispensed as Micropirin far more often than recorded literally as
// "aspirin". Cartia is deliberately omitted — it is aspirin in IL but diltiazem
// in the US/AU, an ambiguity not worth the false match.
const ANTIPLATELET_RE =
  /aspirin|clopidogrel|prasugrel|ticagrelor|אספירין|פלאביקס|plavix|micropirin|מיקרופירין|brilinta|effient/i;

function find(meds: Med[], re: RegExp): Med | undefined {
  return meds.find((m) => re.test(m.name));
}

function findAll(meds: Med[], re: RegExp): Med[] {
  return meds.filter((m) => re.test(m.name));
}

function hasCondition(p: PatientContext, re: RegExp): boolean {
  return (p.conditions ?? []).some((c) => re.test(c));
}

interface Rule {
  fire(meds: Med[], patient: PatientContext): Hit | null;
}

export const STOPP_RULES: Rule[] = [
  // NSAID + warfarin → catastrophic GI bleed risk.
  {
    fire(meds) {
      const n = find(meds, NSAID_RE);
      const w = find(meds, WARFARIN_RE);
      if (!n || !w) return null;
      return {
        code: 'STOPP-NSAID-WARFARIN',
        drug: `${n.name} + ${w.name}`,
        recommendation: 'NSAID + Warfarin — סיכון דימום קריטי. הפסק NSAID מיד',
        severity: 'critical',
      };
    },
  },
  // NSAID + DOAC — same logic, DOAC instead of warfarin.
  {
    fire(meds) {
      const n = find(meds, NSAID_RE);
      const d = find(meds, APIXABAN_RE);
      if (!n || !d) return null;
      return {
        code: 'STOPP-NSAID-DOAC',
        drug: `${n.name} + ${d.name}`,
        recommendation: 'NSAID + DOAC — סיכון דימום מוגבר. הפסק NSAID',
        severity: 'critical',
      };
    },
  },
  // Beta-blocker + verapamil/diltiazem → bradycardia, AV block.
  {
    fire(meds) {
      const bb = find(meds, BETA_BLOCKER_RE);
      const ccb = find(meds, VERAPAMIL_RE);
      if (!bb || !ccb) return null;
      return {
        code: 'STOPP-BB-VERAPAMIL',
        drug: `${bb.name} + ${ccb.name}`,
        recommendation: 'Beta-blocker + Verapamil/Diltiazem — סיכון ברדיקרדיה ו-AV block. הפסק אחד מהם',
        severity: 'high',
      };
    },
  },
  // Opioid without scheduled laxative — predictable constipation.
  {
    fire(meds) {
      const op = find(meds, OPIOID_RE);
      if (!op) return null;
      const lax = find(meds, LAXATIVE_RE);
      if (lax) return null;
      return {
        code: 'STOPP-OPIOID-NO-LAX',
        drug: op.name,
        recommendation: 'אופיואיד ללא לקסטיב — הוסף Movicol או Lactulose קבוע',
        severity: 'moderate',
      };
    },
  },
  // Duplicate ACEi + ARB — RAAS blockade, hyperkalemia, AKI.
  {
    fire(meds) {
      const a = find(meds, ACEI_RE);
      const b = find(meds, ARB_RE);
      if (!a || !b) return null;
      return {
        code: 'STOPP-ACEI-ARB-DUP',
        drug: `${a.name} + ${b.name}`,
        recommendation: 'ACEi + ARB ביחד — סיכון היפרקלמיה ו-AKI. השאר רק אחד',
        severity: 'high',
      };
    },
  },
  // Two antiplatelets without explicit indication (e.g. recent stent, ACS).
  // We can't see the indication; flag the combo and let the doctor judge.
  {
    fire(meds, patient) {
      const ap = findAll(meds, ANTIPLATELET_RE);
      if (ap.length < 2) return null;
      const stentRe = /stent|PCI|ACS|MI\s*-\s*recent|מיוקרד\s*טרי|stent/i;
      if (hasCondition(patient, stentRe)) return null;
      return {
        code: 'STOPP-DAPT-NO-IND',
        drug: ap.map((m) => m.name).join(' + '),
        recommendation: 'שתי תרופות אנטי-טסיתיות ללא אינדיקציה — שקול הפסקת אחת',
        severity: 'moderate',
      };
    },
  },
  // PPI > 8 weeks at maintenance dose — same threshold as Beers; STOPP
  // phrases it as "without indication", we keep the rule fired so the
  // doctor can review the indication in the chart.
  {
    fire(meds) {
      const p = find(meds, PPI_RE);
      if (!p) return null;
      if (p.durationMonths === undefined) {
        // Honest non-assessment (mirrors BEERS-PPI-LONG): duration is never
        // captured at admission, so report it as not-assessed rather than
        // silently passing. 'info' severity keeps it out of the STOPP count.
        return {
          code: 'STOPP-PPI-LONG',
          drug: p.name,
          recommendation: 'PPI פעיל — משך לא תועד, לא הוערך. תעד אינדיקציה ומשך',
          severity: 'info',
        };
      }
      if (p.durationMonths < 2) return null;
      return {
        code: 'STOPP-PPI-LONG',
        drug: p.name,
        recommendation: 'PPI מעל 8 שבועות — תעד אינדיקציה או הפחת',
        severity: 'low',
      };
    },
  },
];

export function checkStopp(meds: Med[], patient: PatientContext): Hit[] {
  if (!meds || meds.length === 0) return [];
  const hits: Hit[] = [];
  for (const r of STOPP_RULES) {
    const h = r.fire(meds, patient);
    if (h) hits.push(h);
  }
  return hits;
}
