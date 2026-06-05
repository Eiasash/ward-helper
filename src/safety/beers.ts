/**
 * Beers Criteria 2023 — AGS Beers Update.
 *
 * Selected high-yield rules for the geriatric ward. NOT comprehensive —
 * this is the subset that fires on real polypharmacy admissions and that
 * the on-call team needs to see at the bedside. The full Beers list runs
 * 100+ rules; we ship the ones that change immediate management.
 *
 * Each rule is a pure function over (meds, patient) → Hit | null. No
 * cross-cutting state, no side effects, no async. Add a new rule by
 * appending to BEERS_RULES — order matters only for stable display.
 */

import type { Hit, Med, PatientContext } from './types';
import { NSAID_RE, PPI_RE } from './drugPatterns';

const BENZO_RE = /lorazepam|diazepam|clonazepam|midazolam|oxazepam|alprazolam|לוראזפם|דיאזפם|קלונזפם/i;
// Documented-CKD detection over the free-text condition list. Production never
// supplies a numeric eGFR (Review.tsx builds PatientContext from {age, sex,
// conditions} only), so this dx-string match is the rule's only live trigger.
// Deliberately broad — over-warning on any renal-impairment string is safe for
// an NSAID nephrotoxicity flag (NSAIDs are contraindicated in AKI as well as
// CKD). Excludes bare "renal"/"כליה" to avoid firing on renal cyst / RCC /
// kidney stone, which carry no NSAID-specific risk.
const CKD_RE =
  /CKD|chronic\s+(kidney|renal)|renal\s+(failure|insufficiency)|nephropathy|CRF\b|ESRD|end[-\s]?stage\s+renal|dialysis|אי\s*ספיקת\s*כלי(ה|ות)|מחלת\s*כליות|כליה\s*כרונית|דיאליז|המודיאליז/i;
const ANTICHOLINERGIC_HIGH_RE =
  /amitriptyline|oxybutynin|tolterodine|solifenacin|hydroxyzine|diphenhydramine|chlorphenamine|promethazine|scopolamine|imipramine|אמיטריפטילין|אוקסיבוטינין|דיפנהידרמין/i;
const SLIDING_SCALE_RE = /sliding\s*scale|insulin\s+regular|reg\.?\s*insulin/i;
const LONG_INSULIN_RE = /glargine|detemir|degludec|lantus|levemir|tresiba|toujeo/i;
const RAPID_INSULIN_RE =
  /aspart|lispro|glulisine|novorapid|humalog|apidra|insulin\s+(novo|hum)/i;

function hasCondition(p: PatientContext, re: RegExp): boolean {
  if (!p.conditions || p.conditions.length === 0) return false;
  return p.conditions.some((c) => re.test(c));
}

function findMed(meds: Med[], re: RegExp): Med | undefined {
  return meds.find((m) => re.test(m.name));
}

interface Rule {
  fire(meds: Med[], patient: PatientContext): Hit | null;
}

export const BEERS_RULES: Rule[] = [
  // PPI > 8 weeks at full dose without ongoing indication.
  {
    fire(meds) {
      const ppi = findMed(meds, PPI_RE);
      if (!ppi) return null;
      if (ppi.durationMonths === undefined) {
        // Honest non-assessment. Production never supplies durationMonths (a
        // meds snapshot at admission carries no start date), so silently
        // returning null would falsely imply "assessed, no long-term-PPI
        // concern". Emit an 'info' notice instead — excluded from the pill
        // counts, so it surfaces in the panel without a false card alarm.
        return {
          code: 'BEERS-PPI-LONG',
          drug: ppi.name,
          recommendation: 'PPI פעיל — משך הטיפול לא תועד, לא הוערך מול סף 8 השבועות. בדוק אינדיקציה ומשך ידנית',
          severity: 'info',
        };
      }
      if (ppi.durationMonths < 2) return null;
      return {
        code: 'BEERS-PPI-LONG',
        drug: ppi.name,
        recommendation: 'PPI מעל 8 שבועות — שקול הפחתה הדרגתית ובדוק אינדיקציה',
        severity: 'moderate',
      };
    },
  },
  // Benzodiazepines in age ≥ 65 — falls, fractures, delirium.
  {
    fire(meds, patient) {
      if ((patient.age ?? 0) < 65) return null;
      const benzo = findMed(meds, BENZO_RE);
      if (!benzo) return null;
      return {
        code: 'BEERS-BENZO-ELDER',
        drug: benzo.name,
        recommendation: 'בנזודיאזפין בקשיש — סיכון נפילות ובלבול. שקול גמילה הדרגתית',
        severity: 'high',
      };
    },
  },
  // Strong anticholinergic in dementia — accelerates cognitive decline.
  {
    fire(meds, patient) {
      const dementiaRe = /dementia|alzheimer|דמנציה|אלצהיימר|cognitive\s+impairment/i;
      if (!hasCondition(patient, dementiaRe)) return null;
      const ac = findMed(meds, ANTICHOLINERGIC_HIGH_RE);
      if (!ac) return null;
      return {
        code: 'BEERS-AC-DEMENTIA',
        drug: ac.name,
        recommendation: 'אנטיכולינרגי חזק במטופל עם דמנציה — החלף לחלופה לא-אנטיכולינרגית',
        severity: 'high',
      };
    },
  },
  // NSAID in CKD (eGFR < 60) or CrCl-low elderly — AKI risk.
  {
    fire(meds, patient) {
      const ckdByEgfr = patient.egfr !== undefined && patient.egfr < 60;
      const ckdByDx = hasCondition(patient, CKD_RE);
      if (!ckdByEgfr && !ckdByDx) return null;
      const nsaid = findMed(meds, NSAID_RE);
      if (!nsaid) return null;
      // Label the trigger basis so the doctor knows whether the flag came from
      // a measured eGFR or from a documented CKD diagnosis in the problem list.
      const basis = ckdByEgfr ? `eGFR ${patient.egfr}` : 'CKD מתועד';
      return {
        code: 'BEERS-NSAID-CKD',
        drug: nsaid.name,
        recommendation: `NSAID במטופל עם CKD (${basis}) — סיכון AKI גבוה. הפסק והחלף לפרצטמול`,
        severity: 'critical',
      };
    },
  },
  // Sliding-scale insulin alone — Beers strongly recommends against as
  // sole therapy because of hypoglycemia risk and no proven benefit.
  // "Alone" = sliding-scale present, no long-acting basal, no rapid
  // analog scheduled — only the sliding scale.
  {
    fire(meds) {
      const ss = findMed(meds, SLIDING_SCALE_RE);
      if (!ss) return null;
      const hasBasal = !!findMed(meds, LONG_INSULIN_RE);
      const hasRapid = !!findMed(meds, RAPID_INSULIN_RE);
      if (hasBasal || hasRapid) return null;
      return {
        code: 'BEERS-SS-INSULIN-ALONE',
        drug: ss.name,
        recommendation: 'Sliding scale בלבד — סיכון היפוגליקמיה. הוסף בזאלית ארוכה',
        severity: 'high',
      };
    },
  },
];

export function checkBeers(meds: Med[], patient: PatientContext): Hit[] {
  if (!meds || meds.length === 0) return [];
  const hits: Hit[] = [];
  for (const r of BEERS_RULES) {
    const h = r.fire(meds, patient);
    if (h) hits.push(h);
  }
  return hits;
}
