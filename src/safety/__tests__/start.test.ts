import { describe, it, expect } from 'vitest';
import { checkStart } from '@/safety/start';
import type { Med, PatientContext } from '@/safety/types';

const MED = (name: string): Med => ({ name });

describe('START — AF without anticoagulation', () => {
  it('fires when AF in conditions and no anticoag in meds', () => {
    const ctx: PatientContext = { age: 80, conditions: ['atrial fibrillation'] };
    const hits = checkStart([MED('metoprolol')], ctx);
    expect(hits.find((h) => h.code === 'START-AF-NO-AC')).toBeTruthy();
  });

  it('matches Hebrew condition (פרפור עליות)', () => {
    const ctx: PatientContext = { age: 80, conditions: ['פרפור עליות'] };
    const hits = checkStart([], ctx);
    expect(hits.find((h) => h.code === 'START-AF-NO-AC')).toBeTruthy();
  });

  it('does not fire when patient is on apixaban', () => {
    const ctx: PatientContext = { age: 80, conditions: ['AF'] };
    const hits = checkStart([MED('apixaban')], ctx);
    expect(hits.find((h) => h.code === 'START-AF-NO-AC')).toBeUndefined();
  });

  it('suppressed when anticoag explicitly contraindicated', () => {
    const ctx: PatientContext = {
      age: 90,
      conditions: ['AF', 'anticoag contraindicated due to recent fall'],
    };
    const hits = checkStart([], ctx);
    expect(hits.find((h) => h.code === 'START-AF-NO-AC')).toBeUndefined();
  });
});

describe('START — CHF without ACEi/ARB', () => {
  it('fires for CHF in conditions and no ACEi/ARB', () => {
    const ctx: PatientContext = { age: 75, conditions: ['CHF'] };
    const hits = checkStart([MED('furosemide')], ctx);
    expect(hits.find((h) => h.code === 'START-CHF-NO-RAAS')).toBeTruthy();
  });

  it('does not fire when on enalapril', () => {
    const ctx: PatientContext = { age: 75, conditions: ['CHF'] };
    const hits = checkStart([MED('enalapril')], ctx);
    expect(hits.find((h) => h.code === 'START-CHF-NO-RAAS')).toBeUndefined();
  });

  it('matches HFrEF', () => {
    const ctx: PatientContext = { age: 70, conditions: ['HFrEF EF 25%'] };
    const hits = checkStart([], ctx);
    expect(hits.find((h) => h.code === 'START-CHF-NO-RAAS')).toBeTruthy();
  });
});

describe('START — osteoporosis without bisphosphonate', () => {
  it('fires for osteoporosis without alendronate or denosumab', () => {
    const ctx: PatientContext = { age: 78, conditions: ['osteoporosis T score -3.0'] };
    const hits = checkStart([], ctx);
    expect(hits.find((h) => h.code === 'START-OP-NO-BISPHOS')).toBeTruthy();
  });

  it('does not fire when alendronate present', () => {
    const ctx: PatientContext = { age: 78, conditions: ['osteoporosis'] };
    const hits = checkStart([MED('alendronate 70mg weekly')], ctx);
    expect(hits.find((h) => h.code === 'START-OP-NO-BISPHOS')).toBeUndefined();
  });

  it('does not fire when on denosumab', () => {
    const ctx: PatientContext = { age: 78, conditions: ['osteoporosis'] };
    const hits = checkStart([MED('denosumab')], ctx);
    expect(hits.find((h) => h.code === 'START-OP-NO-BISPHOS')).toBeUndefined();
  });
});

describe('START — T2DM without statin (age + risk)', () => {
  it('fires for T2DM age 70 without statin', () => {
    const ctx: PatientContext = { age: 70, conditions: ['T2DM'] };
    const hits = checkStart([MED('metformin')], ctx);
    expect(hits.find((h) => h.code === 'START-T2DM-NO-STATIN')).toBeTruthy();
  });

  it('does not fire when age < 50', () => {
    const ctx: PatientContext = { age: 40, conditions: ['T2DM'] };
    const hits = checkStart([], ctx);
    expect(hits.find((h) => h.code === 'START-T2DM-NO-STATIN')).toBeUndefined();
  });

  it('does not fire when on atorvastatin', () => {
    const ctx: PatientContext = { age: 70, conditions: ['T2DM'] };
    const hits = checkStart([MED('atorvastatin 20mg')], ctx);
    expect(hits.find((h) => h.code === 'START-T2DM-NO-STATIN')).toBeUndefined();
  });
});

describe('START — post-MI without statin', () => {
  it('fires for post-MI history without statin', () => {
    const ctx: PatientContext = { age: 65, conditions: ['s/p MI 2024'] };
    const hits = checkStart([], ctx);
    expect(hits.find((h) => h.code === 'START-POSTMI-NO-STATIN')).toBeTruthy();
  });

  it('does not fire when on rosuvastatin', () => {
    const ctx: PatientContext = { age: 65, conditions: ['post-MI'] };
    const hits = checkStart([MED('rosuvastatin 40mg')], ctx);
    expect(hits.find((h) => h.code === 'START-POSTMI-NO-STATIN')).toBeUndefined();
  });

  it('matches Hebrew (אוטם בעבר)', () => {
    const ctx: PatientContext = { age: 70, conditions: ['אוטם בעבר 2022'] };
    const hits = checkStart([], ctx);
    expect(hits.find((h) => h.code === 'START-POSTMI-NO-STATIN')).toBeTruthy();
  });
});

describe('START — empty + no-condition cases', () => {
  it('returns [] when no qualifying conditions', () => {
    const hits = checkStart([MED('amlodipine')], { conditions: ['hypertension'] });
    expect(hits).toEqual([]);
  });

  it('returns [] for empty patient context', () => {
    expect(checkStart([], {})).toEqual([]);
  });
});
