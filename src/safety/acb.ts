/**
 * Anticholinergic Burden — Boustani 2008 / AGS Beers 2023 update.
 *
 * Each drug carries a 1/2/3 score; total ≥ 3 is a delirium/falls signal.
 * Independent from Beers/STOPP — the same drug (e.g. amitriptyline) can
 * fire BOTH a Beers hit AND contribute to ACB. That double-surfacing is
 * intentional: Beers is "should this be on the list?", ACB is "what's
 * the additive load?".
 */

import type { Med } from './types';

export interface AcbDrug {
  name: string;
  pattern: RegExp;
  score: 1 | 2 | 3;
}

export const ACB_DRUGS: AcbDrug[] = [
  // ── Score 3: definite high anticholinergic ──
  { name: 'Amitriptyline', pattern: /amitriptyline|אמיטריפטילין|elatrol/i, score: 3 },
  { name: 'Oxybutynin', pattern: /oxybutynin|אוקסיבוטינין|ditropan/i, score: 3 },
  { name: 'Tolterodine', pattern: /tolterodine|טולטרודין|detrol/i, score: 3 },
  { name: 'Solifenacin', pattern: /solifenacin|סוליפנצין|vesicare/i, score: 3 },
  { name: 'Hydroxyzine', pattern: /hydroxyzine|הידרוקסיזין|atarax/i, score: 3 },
  { name: 'Diphenhydramine', pattern: /diphenhydramine|בנדריל|benadryl|nytol/i, score: 3 },
  { name: 'Chlorphenamine', pattern: /chlorphenamine|chlorphenir|כלורפנאמין|piriton/i, score: 3 },
  { name: 'Promethazine', pattern: /promethazine|פרומתזין|phenergan/i, score: 3 },
  { name: 'Clomipramine', pattern: /clomipramine|קלומיפרמין|anafranil/i, score: 3 },
  { name: 'Imipramine', pattern: /imipramine|אימיפרמין|tofranil/i, score: 3 },
  { name: 'Doxepin', pattern: /doxepin|דוקסאפין|sinequan/i, score: 3 },
  { name: 'Trihexyphenidyl', pattern: /trihexyphenidyl|טריהקסיפנידיל|artane/i, score: 3 },
  { name: 'Benztropine', pattern: /benztropine|בנזטרופין|cogentin/i, score: 3 },
  { name: 'Scopolamine', pattern: /scopolamine|סקופולמין|buscopan/i, score: 3 },
  // ── Score 2: clinically relevant ──
  { name: 'Olanzapine', pattern: /olanzapine|אולנזפין|zyprexa/i, score: 2 },
  { name: 'Quetiapine', pattern: /quetiapine|קווטיאפין|seroquel/i, score: 2 },
  { name: 'Clozapine', pattern: /clozapine|קלוזפין|clozaril/i, score: 2 },
  { name: 'Nortriptyline', pattern: /nortriptyline|נורטריפטילין/i, score: 2 },
  { name: 'Loperamide', pattern: /loperamide|לופרמיד|imodium/i, score: 2 },
  { name: 'Cetirizine', pattern: /cetirizine|צטיריזין|zyrtec/i, score: 2 },
  // ── Score 1: possible (mild but additive) ──
  { name: 'Ranitidine', pattern: /ranitidine|רניטידין/i, score: 1 },
  { name: 'Furosemide', pattern: /furosemide|פורוסמיד|lasix|לאסיקס/i, score: 1 },
  { name: 'Digoxin', pattern: /digoxin|דיגוקסין|lanoxin/i, score: 1 },
  { name: 'Metoprolol', pattern: /metoprolol|מטופרולול/i, score: 1 },
  { name: 'Risperidone', pattern: /risperidone|ריספרידון|risperdal/i, score: 1 },
  { name: 'Mirtazapine', pattern: /mirtazapine|מירטזפין|remeron/i, score: 1 },
  { name: 'Trazodone', pattern: /trazodone|טרזודון|desyrel/i, score: 1 },
  { name: 'Prednisone', pattern: /prednisone|prednisolone|פרדניזון|פרדניזולון/i, score: 1 },
  { name: 'Warfarin', pattern: /warfarin|וורפרין|coumadin/i, score: 1 },
  { name: 'Codeine', pattern: /codeine|קודאין/i, score: 1 },
  { name: 'Fentanyl', pattern: /fentanyl|פנטניל/i, score: 1 },
  // Lookbehind excludes apomorphine (a dopamine agonist for Parkinson's, NOT
  // anticholinergic) which contains the substring "morphine" / "מורפין".
  { name: 'Morphine', pattern: /(?<!apo)morphine|(?<!אפו)מורפין/i, score: 1 },
  { name: 'Tramadol', pattern: /tramadol|טרמדול/i, score: 1 },
  { name: 'Paroxetine', pattern: /paroxetine|פרוקסטין/i, score: 1 },
];

export interface AcbResult {
  totalScore: number;
  detected: Array<{ name: string; score: 1 | 2 | 3 }>;
}

export function computeAcb(meds: Med[]): AcbResult {
  if (!meds || meds.length === 0) return { totalScore: 0, detected: [] };
  const corpus = meds.map((m) => m.name).join(' ');
  const detected: AcbResult['detected'] = [];
  for (const d of ACB_DRUGS) {
    if (d.pattern.test(corpus)) {
      detected.push({ name: d.name, score: d.score });
    }
  }
  const totalScore = detected.reduce((s, d) => s + d.score, 0);
  return { totalScore, detected };
}
