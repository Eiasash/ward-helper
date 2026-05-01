#!/usr/bin/env node
/**
 * Synthetic safety-engine smoke test.
 *
 * Runs runSafetyChecks() against five clinical archetypes and prints
 * predicted-vs-actual hits side by side. Validates the engine without
 * the camera/extract/emit/IDB/Supabase pipeline.
 *
 * Run:    npx tsx scripts/test-scenarios.mjs > scripts/scenarios/latest.txt
 * Diff:   diff scripts/scenarios/baseline.txt scripts/scenarios/latest.txt
 *
 * baseline.txt is the frozen reference — every safety-engine change should
 * rerun this and the diff should be reviewed before deploy. When new
 * behavior is intentional, `cp latest.txt baseline.txt` and commit.
 *
 * Each scenario lists what *should* fire (per Beers 2023, STOPP/START v3).
 * If the actual output diverges, that's a coverage gap or a rule bug.
 */

import { runSafetyChecks } from '../src/safety/run.ts';

const cases = [
  {
    id: 'A1-polypharmacy-postop',
    description: '88F post-ORIF hip, AKI on CKD3b, UTI, delirium, 14-med polypharmacy',
    meds: [
      { name: 'Apixaban', dose: '2.5mg', freq: 'BID' },
      { name: 'Bisoprolol', dose: '5mg', freq: 'QD' },
      { name: 'Furosemide', dose: '40mg', freq: 'QD' },
      { name: 'Atorvastatin', dose: '20mg', freq: 'QHS' },
      { name: 'Omeprazole', dose: '20mg', freq: 'QD', durationMonths: 18 },
      { name: 'Lorazepam', dose: '0.5mg', freq: 'QHS PRN' },
      { name: 'Donepezil', dose: '10mg', freq: 'QHS' },
      { name: 'Oxybutynin', dose: '5mg', freq: 'BID' },
      { name: 'Sertraline', dose: '50mg', freq: 'QD' },
      { name: 'Metformin', dose: '500mg', freq: 'BID' },
      { name: 'Gliclazide', dose: '30mg', freq: 'QD' },
      { name: 'Tramadol', dose: '50mg', freq: 'Q8H' },
      { name: 'Calcium+VitD', dose: '500/800', freq: 'QD' },
      { name: 'Diphenhydramine', dose: '25mg', freq: 'QHS PRN' },
    ],
    patient: {
      age: 88, sex: 'F',
      conditions: ['hip-fracture-postop', 'AKI', 'CKD-3b', 'UTI', 'delirium',
                   'AF', 'CHF-EF40', 'dementia-mixed', 'osteoporosis',
                   'HTN', 'T2DM', 'depression', 'chronic-pain'],
      egfr: 32,
    },
    predicted: {
      beers: ['BENZO-ELDER (lorazepam)', 'ANTICHOLINERGIC (diphenhydramine, oxybutynin)',
              'PPI-LONG (omeprazole >8wk)', 'SU-ELDER (gliclazide hypoglycemia risk)',
              'TRAMADOL-SSRI (sertraline + tramadol = serotonin)'],
      stopp: ['OPIOID-NO-LAX (tramadol no scheduled laxative)',
              'AChEI-ANTICHOL (donepezil + oxybutynin/diphenhydramine = direct antagonism)',
              'PPI-LONG-NO-INDIC'],
      start: ['CHF-NO-ACEI (EF40 no ACEi/ARB documented)',
              'OP-NO-BISPHOS (osteoporosis on Ca+VitD only, no bisphosphonate)'],
      acbMin: 6, // diphenhydramine 3 + oxybutynin 3 = 6 floor
    },
  },
  {
    id: 'A2-comfort-care-suppress',
    description: '89F metastatic pancreatic CA, comfort-care, AF, T2DM',
    meds: [
      { name: 'Lorazepam', dose: '1mg', freq: 'Q8H PRN' },
      { name: 'Oxycodone', dose: '5mg', freq: 'Q4H' },
      { name: 'Diphenhydramine', dose: '25mg', freq: 'QHS' },
      { name: 'Haloperidol', dose: '0.5mg', freq: 'Q6H PRN' },
    ],
    patient: {
      age: 89, sex: 'F',
      conditions: ['metastatic-pancreatic-cancer', 'comfort-care', 'AF', 'T2DM'],
    },
    predicted: {
      beers: ['BENZO-ELDER', 'ANTICHOLINERGIC (diphenhydramine)'],
      stopp: ['OPIOID-NO-LAX (oxycodone scheduled, no laxative)'],
      start: [], // SUPPRESSED by comfort-care
      acbMin: 3,
    },
    notes: 'START must return [] — this is the v1.20.1 fix. If START fires, the comfort-care logic broke.',
  },
  {
    id: 'A3-postMI-undertreated',
    description: '72M 2 weeks post-NSTEMI, on aspirin only, missing statin + BB + ACEi',
    meds: [
      { name: 'Aspirin', dose: '81mg', freq: 'QD' },
    ],
    patient: {
      age: 72, sex: 'M',
      conditions: ['post-MI', 'CAD', 'HTN'],
    },
    predicted: {
      beers: [],
      stopp: [],
      start: ['POST-MI-STATIN', 'POST-MI-BB', 'POST-MI-ACEI (HTN + post-MI)'],
      acbMin: 0,
    },
    notes: 'Pure START coverage test. If only one START hit fires, two rules are missing.',
  },
  {
    id: 'A4-clean-polypharmacy',
    description: '74M T2DM + AF + HLD, on guideline-correct regimen',
    meds: [
      { name: 'Apixaban', dose: '5mg', freq: 'BID' },
      { name: 'Metformin', dose: '1000mg', freq: 'BID' },
      { name: 'Atorvastatin', dose: '40mg', freq: 'QHS' },
      { name: 'Lisinopril', dose: '10mg', freq: 'QD' },
      { name: 'Bisoprolol', dose: '5mg', freq: 'QD' },
    ],
    patient: {
      age: 74, sex: 'M',
      conditions: ['T2DM', 'AF', 'HLD', 'HTN'],
      egfr: 65,
    },
    predicted: {
      beers: [],
      stopp: [],
      start: [],
      acbMin: 0,
    },
    notes: 'Negative control. ALL four engines must return empty. Any hit = false positive.',
  },
  {
    id: 'A5-falls-med-cocktail',
    description: '82F recurrent falls, taking sedating cocktail',
    meds: [
      { name: 'Zopiclone', dose: '7.5mg', freq: 'QHS' },
      { name: 'Amitriptyline', dose: '25mg', freq: 'QHS' },
      { name: 'Tizanidine', dose: '4mg', freq: 'TID' },
      { name: 'Tamsulosin', dose: '0.4mg', freq: 'QD' }, // women: weird, alpha-blocker fall risk
      { name: 'Citalopram', dose: '20mg', freq: 'QD' },
    ],
    patient: {
      age: 82, sex: 'F',
      conditions: ['recurrent-falls', 'osteoporosis', 'depression', 'urge-incontinence'],
    },
    predicted: {
      beers: ['Z-DRUG-ELDER (zopiclone)', 'TCA-ELDER (amitriptyline anticholinergic+orthostatic)',
              'ANTICHOLINERGIC-FALLS', 'ALPHA-BLOCKER-ELDER-FEMALE (tamsulosin off-label, falls)'],
      stopp: ['BENZO-Z-DRUG-FALLS', 'TCA-FALLS', 'TIZANIDINE-FALLS',
              'CITALOPRAM-DOSE (>20mg in elder QT risk — borderline at 20mg)'],
      start: ['OP-NO-BISPHOS'],
      acbMin: 6, // amitriptyline 3 + tizanidine ~2 + tamsulosin 1 = 6
    },
    notes: 'Falls scenario. If <3 Beers hits OR <2 STOPP hits, fall-risk rules are thin.',
  },
  {
    id: 'B1-dementia-bpsd-antipsychotic',
    description: '84F advanced dementia + BPSD agitation, on risperidone + benzo + trazodone',
    meds: [
      { name: 'Risperidone', dose: '0.5mg', freq: 'QHS' },
      { name: 'Lorazepam', dose: '0.5mg', freq: 'QHS PRN' },
      { name: 'Donepezil', dose: '10mg', freq: 'QHS' },
      { name: 'Memantine', dose: '10mg', freq: 'BID' },
      { name: 'Trazodone', dose: '50mg', freq: 'QHS' },
    ],
    patient: {
      age: 84, sex: 'F',
      conditions: ['dementia-advanced', 'BPSD', 'fall-history', 'HTN'],
    },
    predicted: {
      beers: ['ANTIPSYCHOTIC-DEMENTIA-BBW (risperidone in dementia, increased mortality)',
              'BENZO-ELDER (lorazepam)', 'BENZO-DEMENTIA'],
      stopp: ['ANTIPSYCHOTIC-DEMENTIA (non-emergency BPSD)',
              'BENZO-FALLS (lorazepam + fall history)'],
      start: [],
      acbMin: 3, // risperidone + trazodone + lorazepam each ~1
    },
    notes: 'Antipsychotic-in-dementia BBW is the headline. If Beers misses risperidone, the dementia-mortality rule is broken.',
  },
  {
    id: 'B2-parkinsons-dopamine-blockers',
    description: '78M PD + nausea, accidentally on metoclopramide + promethazine (drug-induced parkinsonism risk)',
    meds: [
      { name: 'Carbidopa-Levodopa', dose: '25/100', freq: 'TID' },
      { name: 'Quetiapine', dose: '25mg', freq: 'QHS' },
      { name: 'Sertraline', dose: '50mg', freq: 'QD' },
      { name: 'Metoclopramide', dose: '10mg', freq: 'TID' },
      { name: 'Promethazine', dose: '12.5mg', freq: 'Q6H PRN' },
    ],
    patient: {
      age: 78, sex: 'M',
      conditions: ['Parkinsons', 'depression', 'GERD', 'nausea'],
    },
    predicted: {
      beers: ['METOCLOPRAMIDE-PD (extrapyramidal worsening)',
              'PROMETHAZINE-ELDER-PD (anticholinergic + DRB)',
              'ANTICHOLINERGIC (promethazine ACB 3)'],
      stopp: ['DRBLOCKER-PD (metoclopramide + promethazine in PD = direct antagonism of L-DOPA)'],
      start: [],
      acbMin: 4, // promethazine 3 + quetiapine 1
    },
    notes: 'PD-specific rules. Quetiapine is allowed in PD (along with clozapine/pimavanserin); metoclopramide and promethazine are not. If engine flags quetiapine = false positive.',
  },
  {
    id: 'B3-dialysis-dose-mismatch',
    description: '72F ESRD on HD + T2DM + AF, regimen has 3 dose-mismatched meds',
    meds: [
      { name: 'Metformin', dose: '1000mg', freq: 'BID' },
      { name: 'Apixaban', dose: '5mg', freq: 'BID' },
      { name: 'Gabapentin', dose: '300mg', freq: 'TID' },
      { name: 'Atorvastatin', dose: '40mg', freq: 'QHS' },
      { name: 'Sevelamer', dose: '800mg', freq: 'TID' },
    ],
    patient: {
      age: 72, sex: 'F',
      conditions: ['ESRD-on-dialysis', 'T2DM', 'AF', 'neuropathy'],
      egfr: 8,
    },
    predicted: {
      beers: ['METFORMIN-CKD (contraindicated eGFR <30)',
              'GABAPENTIN-CKD (needs HD-dose adjust to 100mg post-HD)',
              'APIXABAN-DOSE (HD: 2.5mg BID per AHA, not 5mg BID)'],
      stopp: ['METFORMIN-EGFR<30'],
      start: [],
      acbMin: 0,
    },
    notes: 'Renal-dose engine test. If no eGFR-driven hits fire, dose-adjust logic is missing or threshold is wrong.',
  },
  {
    id: 'B4-mci-z-drug-benzo-stack',
    description: '80F MCI + insomnia + anxiety, sedating cocktail (zolpidem + diazepam + anticholinergic antihistamine)',
    meds: [
      { name: 'Zolpidem', dose: '5mg', freq: 'QHS' },
      { name: 'Mirtazapine', dose: '15mg', freq: 'QHS' },
      { name: 'Diazepam', dose: '2mg', freq: 'QHS PRN' },
      { name: 'Cetirizine', dose: '10mg', freq: 'QD' },
    ],
    patient: {
      age: 80, sex: 'F',
      conditions: ['MCI', 'insomnia', 'anxiety', 'allergic-rhinitis'],
    },
    predicted: {
      beers: ['Z-DRUG-ELDER (zolpidem)',
              'BENZO-ELDER-LONG-HALF (diazepam half-life >100h in elders)',
              'ANTIHISTAMINE-ELDER (cetirizine — borderline; 1st-gen worse but Beers 2023 lists 2nd-gen as caution)'],
      stopp: ['Z-DRUG-FALLS', 'LONG-BENZO-ELDER'],
      start: [],
      acbMin: 3, // mirtazapine 1 + diazepam 1 + cetirizine 1
    },
    notes: 'MCI + sedation stack. If Beers misses diazepam (long half-life is the key Beers anchor for this drug class), the BZD half-life rule is thin.',
  },
  {
    id: 'B5-uti-delirium-paradox',
    description: '86F UTI + delirium with reduced eGFR, regimen tests delirium-specific Beers + nitrofurantoin renal threshold',
    meds: [
      { name: 'Nitrofurantoin', dose: '100mg', freq: 'BID' },
      { name: 'Lorazepam', dose: '0.25mg', freq: 'Q6H PRN' },
      { name: 'Haloperidol', dose: '0.5mg', freq: 'PRN' },
      { name: 'Acetaminophen', dose: '500mg', freq: 'Q6H PRN' },
    ],
    patient: {
      age: 86, sex: 'F',
      conditions: ['UTI', 'delirium', 'CKD-3b'],
      egfr: 28,
    },
    predicted: {
      beers: ['NITROFURANTOIN-CKD (eGFR <30 contraindicated; <60 caution)',
              'BENZO-DELIRIUM (lorazepam paradoxically worsens delirium except in alcohol-withdrawal/seizure)',
              'ANTIPSYCHOTIC-DELIRIUM-NEW (Beers 2023: avoid for non-emergency delirium)'],
      stopp: ['BENZO-DELIRIUM', 'NITROFURANTOIN-RENAL'],
      start: [],
      acbMin: 1, // haloperidol low ACB
    },
    notes: 'Delirium-context test. Beers 2023 specifically calls out benzo-in-delirium AND new-onset antipsychotic-in-delirium. If neither fires, delirium-context recognition is missing.',
  },
];

// ---- Runner ----

function fmt(arr) {
  return arr.length === 0 ? '(none)' : arr.map(h => `  - ${h.code ?? h}: ${h.message ?? h.recommendation ?? ''}`).join('\n');
}

function fmtPred(arr) {
  return arr.length === 0 ? '(none)' : arr.map(s => `  - ${s}`).join('\n');
}

console.log('===========================================');
console.log('ward-helper safety engine — synthetic test');
console.log('Date:', new Date().toISOString());
console.log('===========================================\n');

let totalIssues = 0;

for (const c of cases) {
  console.log(`\n━━━ ${c.id} ━━━`);
  console.log(c.description);
  if (c.notes) console.log(`NOTE: ${c.notes}`);

  let result;
  try {
    result = runSafetyChecks(c.meds, c.patient);
  } catch (e) {
    console.log(`❌ THREW: ${e.message}`);
    totalIssues++;
    continue;
  }

  console.log('\nPREDICTED:');
  console.log('  Beers:');  console.log(fmtPred(c.predicted.beers));
  console.log('  STOPP:');  console.log(fmtPred(c.predicted.stopp));
  console.log('  START:');  console.log(fmtPred(c.predicted.start));
  console.log(`  ACB ≥ ${c.predicted.acbMin}`);

  console.log('\nACTUAL:');
  console.log('  Beers:');  console.log(fmt(result.beers));
  console.log('  STOPP:');  console.log(fmt(result.stopp));
  console.log('  START:');  console.log(fmt(result.start));
  console.log(`  ACB = ${result.acbScore}`);

  // Quick automated divergence flags. Coarse — not a substitute for Eias's eyes.
  const flags = [];
  if (c.predicted.beers.length > 0 && result.beers.length === 0) flags.push('Beers: predicted hits, got none');
  if (c.predicted.stopp.length > 0 && result.stopp.length === 0) flags.push('STOPP: predicted hits, got none');
  if (c.predicted.start.length > 0 && result.start.length === 0) flags.push('START: predicted hits, got none');
  if (c.predicted.start.length === 0 && result.start.length > 0) flags.push('START: predicted empty, got hits (comfort-care suppression check)');
  if (result.acbScore < c.predicted.acbMin) flags.push(`ACB: ${result.acbScore} < expected ${c.predicted.acbMin}`);
  // Negative control: ANY hit on A4 is a false positive
  if (c.id === 'A4-clean-polypharmacy' && (result.beers.length || result.stopp.length || result.start.length)) {
    flags.push('NEGATIVE CONTROL FAILED — any hit on this case is a false positive');
  }

  if (flags.length > 0) {
    console.log('\n⚠️  AUTO-FLAGS:');
    flags.forEach(f => console.log(`    ${f}`));
    totalIssues += flags.length;
  } else {
    console.log('\n✓ No auto-flags (manual review still required).');
  }
}

console.log('\n===========================================');
console.log(`Total auto-flagged divergences: ${totalIssues}`);
console.log('Manual review of every ACTUAL block is still required —');
console.log('the auto-flags only catch coarse coverage gaps.');
console.log('===========================================');
