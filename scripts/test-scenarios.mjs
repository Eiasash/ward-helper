#!/usr/bin/env node
/**
 * Synthetic safety-engine smoke test.
 *
 * Runs runSafetyChecks() against five clinical archetypes and prints
 * predicted-vs-actual hits side by side. Validates the engine without
 * the camera/extract/emit/IDB/Supabase pipeline.
 *
 * Run: node scripts/test-scenarios.mjs
 *
 * Each scenario lists what *should* fire (per Beers 2023, STOPP/START v3).
 * If the actual output diverges, that's a coverage gap or a rule bug.
 * Log divergences for Sprint 3.
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
      gfr: 32,
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
      lvef: 45,
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
      gfr: 65,
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
