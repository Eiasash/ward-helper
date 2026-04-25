import { describe, it, expect } from 'vitest';
import { checkBeers } from '@/safety/beers';
import type { Med, PatientContext } from '@/safety/types';

const MED = (name: string, extra: Partial<Med> = {}): Med => ({ name, ...extra });

describe('Beers — PPI > 8 weeks', () => {
  it('fires when PPI durationMonths >= 2', () => {
    const hits = checkBeers([MED('omeprazole', { durationMonths: 6 })], {});
    expect(hits.find((h) => h.code === 'BEERS-PPI-LONG')).toBeTruthy();
  });

  it('does not fire when duration is unknown', () => {
    const hits = checkBeers([MED('omeprazole')], {});
    expect(hits.find((h) => h.code === 'BEERS-PPI-LONG')).toBeUndefined();
  });

  it('does not fire when duration < 2 months', () => {
    const hits = checkBeers([MED('omeprazole', { durationMonths: 1 })], {});
    expect(hits.find((h) => h.code === 'BEERS-PPI-LONG')).toBeUndefined();
  });

  it('matches Hebrew aliases', () => {
    const hits = checkBeers([MED('לוסק', { durationMonths: 12 })], {});
    expect(hits.find((h) => h.code === 'BEERS-PPI-LONG')).toBeTruthy();
  });
});

describe('Beers — benzodiazepines in elderly', () => {
  it('fires for lorazepam in age 80', () => {
    const hits = checkBeers([MED('lorazepam')], { age: 80 });
    expect(hits.find((h) => h.code === 'BEERS-BENZO-ELDER')).toBeTruthy();
  });

  it('does not fire when age < 65', () => {
    const hits = checkBeers([MED('lorazepam')], { age: 50 });
    expect(hits.find((h) => h.code === 'BEERS-BENZO-ELDER')).toBeUndefined();
  });

  it('does not fire when age unknown', () => {
    const hits = checkBeers([MED('lorazepam')], {});
    expect(hits.find((h) => h.code === 'BEERS-BENZO-ELDER')).toBeUndefined();
  });

  it('matches Hebrew name', () => {
    const hits = checkBeers([MED('דיאזפם')], { age: 75 });
    expect(hits.find((h) => h.code === 'BEERS-BENZO-ELDER')).toBeTruthy();
  });
});

describe('Beers — anticholinergic in dementia', () => {
  it('fires for amitriptyline in dementia patient', () => {
    const ctx: PatientContext = { age: 82, conditions: ['dementia'] };
    const hits = checkBeers([MED('amitriptyline')], ctx);
    expect(hits.find((h) => h.code === 'BEERS-AC-DEMENTIA')).toBeTruthy();
  });

  it('matches Hebrew condition (דמנציה)', () => {
    const ctx: PatientContext = { age: 82, conditions: ['דמנציה קלה'] };
    const hits = checkBeers([MED('oxybutynin')], ctx);
    expect(hits.find((h) => h.code === 'BEERS-AC-DEMENTIA')).toBeTruthy();
  });

  it('does not fire without dementia in conditions', () => {
    const hits = checkBeers([MED('amitriptyline')], { age: 82 });
    expect(hits.find((h) => h.code === 'BEERS-AC-DEMENTIA')).toBeUndefined();
  });
});

describe('Beers — NSAID + CKD', () => {
  it('fires when egfr < 60', () => {
    const hits = checkBeers([MED('ibuprofen')], { egfr: 45 });
    expect(hits.find((h) => h.code === 'BEERS-NSAID-CKD')).toBeTruthy();
  });

  it('fires when CKD listed in conditions even without eGFR value', () => {
    const hits = checkBeers([MED('voltaren')], { conditions: ['CKD stage 3'] });
    expect(hits.find((h) => h.code === 'BEERS-NSAID-CKD')).toBeTruthy();
  });

  it('does not fire when egfr >= 60 and no CKD condition', () => {
    const hits = checkBeers([MED('ibuprofen')], { egfr: 90 });
    expect(hits.find((h) => h.code === 'BEERS-NSAID-CKD')).toBeUndefined();
  });

  it('flagged severity is critical', () => {
    const hits = checkBeers([MED('naproxen')], { egfr: 30 });
    const hit = hits.find((h) => h.code === 'BEERS-NSAID-CKD');
    expect(hit?.severity).toBe('critical');
  });
});

describe('Beers — sliding-scale insulin alone', () => {
  it('fires when only sliding scale present', () => {
    const hits = checkBeers([MED('insulin regular sliding scale')], {});
    expect(hits.find((h) => h.code === 'BEERS-SS-INSULIN-ALONE')).toBeTruthy();
  });

  it('does not fire when basal insulin also present', () => {
    const meds = [MED('insulin sliding scale'), MED('lantus 20u qhs')];
    const hits = checkBeers(meds, {});
    expect(hits.find((h) => h.code === 'BEERS-SS-INSULIN-ALONE')).toBeUndefined();
  });

  it('does not fire when rapid analog scheduled', () => {
    const meds = [MED('regular insulin sliding scale'), MED('novorapid 8u tid')];
    const hits = checkBeers(meds, {});
    expect(hits.find((h) => h.code === 'BEERS-SS-INSULIN-ALONE')).toBeUndefined();
  });
});

describe('Beers — empty + edge cases', () => {
  it('returns [] for empty meds', () => {
    expect(checkBeers([], { age: 80 })).toEqual([]);
  });

  it('returns [] when no rules match', () => {
    const hits = checkBeers([MED('atorvastatin'), MED('lisinopril')], { age: 70 });
    expect(hits).toEqual([]);
  });
});
