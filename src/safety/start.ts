/**
 * START v3 — Screening Tool to Alert to Right Treatment.
 *
 * Drugs that SHOULD be on the list when the patient has the matching
 * condition and no explicit reason to omit. Each rule fires when the
 * condition is present AND the drug class is missing.
 *
 * Rules are intentionally cautious: we suppress when the patient has a
 * documented contraindication note (e.g. "anticoag contraindicated"),
 * because START shouldn't bully a doctor who already considered it.
 */

import type { Hit, Med, PatientContext } from './types';

const ANTICOAG_RE =
  /warfarin|apixaban|rivaroxaban|dabigatran|edoxaban|וורפרין|אפיקסבן|ריברוקסבן/i;
const ACEI_OR_ARB_RE =
  /enalapril|ramipril|lisinopril|captopril|losartan|valsartan|candesartan|אנלפריל|רמיפריל|לוסרטן/i;
const BISPHOSPHONATE_RE =
  /alendronate|risedronate|zoledronate|ibandronate|אלנדרונט|fosamax/i;
const STATIN_RE =
  /atorvastatin|simvastatin|rosuvastatin|pravastatin|lovastatin|אטורבסטטין|לפיטור|crestor|lipitor/i;
const BETA_BLOCKER_POSTMI_RE =
  /metoprolol|bisoprolol|atenolol|carvedilol|propranolol|מטופרולול|ביסופרולול|carvedilol/i;

function hasCondition(p: PatientContext, re: RegExp): boolean {
  return (p.conditions ?? []).some((c) => re.test(c));
}

function hasMed(meds: Med[], re: RegExp): boolean {
  return meds.some((m) => re.test(m.name));
}

function isContraindicated(p: PatientContext, drugClass: RegExp): boolean {
  return (p.conditions ?? []).some((c) => {
    const lc = c.toLowerCase();
    if (!drugClass.test(c)) return false;
    return /contraind|הוריות\s*נגד|allergy|אלרגיה|refused|סירוב/i.test(lc);
  });
}

interface Rule {
  fire(meds: Med[], patient: PatientContext): Hit | null;
}

export const START_RULES: Rule[] = [
  // AF without anticoagulation.
  {
    fire(meds, patient) {
      if (!hasCondition(patient, /atrial\s*fibrillation|\bAF\b|פרפור\s*עליות/i)) {
        return null;
      }
      if (hasMed(meds, ANTICOAG_RE)) return null;
      if (isContraindicated(patient, /anticoag|נוגד\s*קרישה/i)) return null;
      return {
        code: 'START-AF-NO-AC',
        drug: '(missing) anticoagulant',
        recommendation: 'AF ללא נוגד קרישה — שקול אפיקסבן או וורפרין לפי CHA2DS2-VASc',
        severity: 'high',
      };
    },
  },
  // CHF (HFrEF) without ACEi/ARB.
  {
    fire(meds, patient) {
      const chf = /CHF|heart\s*failure|HFrEF|אי\s*ספיקת\s*לב|אסל"?ב/i;
      if (!hasCondition(patient, chf)) return null;
      if (hasMed(meds, ACEI_OR_ARB_RE)) return null;
      if (isContraindicated(patient, /ACEi|ARB|נוגד\s*RAAS/i)) return null;
      return {
        code: 'START-CHF-NO-RAAS',
        drug: '(missing) ACEi or ARB',
        recommendation: 'CHF ללא ACEi/ARB — הוסף ACEi (Enalapril) או ARB',
        severity: 'high',
      };
    },
  },
  // Osteoporosis without bisphosphonate (and not on alternative therapy
  // — denosumab is a separate drug class we don't currently match).
  {
    fire(meds, patient) {
      if (!hasCondition(patient, /osteoporosis|אוסטיאופורוזיס/i)) return null;
      if (hasMed(meds, BISPHOSPHONATE_RE)) return null;
      if (hasMed(meds, /denosumab|דנוסומאב|prolia/i)) return null;
      if (isContraindicated(patient, /bisphosphonate|אלנדרונט/i)) return null;
      return {
        code: 'START-OP-NO-BISPHOS',
        drug: '(missing) bisphosphonate',
        recommendation: 'אוסטיאופורוזיס ללא טיפול ספציפי — שקול Alendronate + Vit D + Calcium',
        severity: 'moderate',
      };
    },
  },
  // T2DM age ≥ 50 without statin (primary prevention in diabetes).
  {
    fire(meds, patient) {
      if (!hasCondition(patient, /T2DM|type\s*2\s*diabetes|סוכרת\s*סוג\s*2|DM2/i)) {
        return null;
      }
      if ((patient.age ?? 0) < 50) return null;
      if (hasMed(meds, STATIN_RE)) return null;
      if (isContraindicated(patient, /statin|סטטין/i)) return null;
      return {
        code: 'START-T2DM-NO-STATIN',
        drug: '(missing) statin',
        recommendation: 'T2DM גיל 50+ ללא סטטין — שקול Atorvastatin 20mg',
        severity: 'moderate',
      };
    },
  },
  // Post-MI without statin.
  {
    fire(meds, patient) {
      const postMi = /post.?MI|prior\s*MI|אוטם\s*בעבר|s\/p\s*MI|MI\s*-?\s*old/i;
      if (!hasCondition(patient, postMi)) return null;
      if (hasMed(meds, STATIN_RE)) return null;
      if (isContraindicated(patient, /statin|סטטין/i)) return null;
      return {
        code: 'START-POSTMI-NO-STATIN',
        drug: '(missing) statin',
        recommendation: 'Post-MI ללא סטטין — הוסף Atorvastatin 80mg למניעה משנית',
        severity: 'high',
      };
    },
  },
  // Post-MI without beta-blocker (and not contraindicated).
  {
    fire(meds, patient) {
      const postMi = /post.?MI|prior\s*MI|אוטם\s*בעבר|s\/p\s*MI/i;
      if (!hasCondition(patient, postMi)) return null;
      if (hasMed(meds, BETA_BLOCKER_POSTMI_RE)) return null;
      if (isContraindicated(patient, /beta\s*blocker|חוסם\s*בטא/i)) return null;
      return {
        code: 'START-POSTMI-NO-BB',
        drug: '(missing) beta-blocker',
        recommendation: 'Post-MI ללא חוסם בטא — שקול Bisoprolol או Metoprolol',
        severity: 'moderate',
      };
    },
  },
];

export function checkStart(meds: Med[], patient: PatientContext): Hit[] {
  const hits: Hit[] = [];
  for (const r of START_RULES) {
    const h = r.fire(meds, patient);
    if (h) hits.push(h);
  }
  return hits;
}
