import { describe, it, expect } from 'vitest';
import { computeAcb } from '@/safety/acb';
import type { Med } from '@/safety/types';

const MED = (name: string): Med => ({ name });

describe('ACB — known additive scores', () => {
  it('diphenhydramine = 3', () => {
    expect(computeAcb([MED('diphenhydramine 25mg qhs')]).totalScore).toBe(3);
  });

  it('oxybutynin = 3', () => {
    expect(computeAcb([MED('oxybutynin 5mg bid')]).totalScore).toBe(3);
  });

  it('amitriptyline = 3', () => {
    expect(computeAcb([MED('amitriptyline 25mg qhs')]).totalScore).toBe(3);
  });

  it('ranitidine = 1', () => {
    expect(computeAcb([MED('ranitidine 150mg bid')]).totalScore).toBe(1);
  });

  it('furosemide = 1', () => {
    expect(computeAcb([MED('furosemide 40mg daily')]).totalScore).toBe(1);
  });
});

describe('ACB — combined score', () => {
  it('amitriptyline (3) + furosemide (1) + ranitidine (1) = 5', () => {
    const meds = [MED('amitriptyline'), MED('furosemide 40mg'), MED('ranitidine')];
    expect(computeAcb(meds).totalScore).toBe(5);
  });

  it('quetiapine (2) + olanzapine (2) = 4', () => {
    const meds = [MED('quetiapine 25mg'), MED('olanzapine 5mg')];
    expect(computeAcb(meds).totalScore).toBe(4);
  });

  it('returns drug-by-drug breakdown', () => {
    const r = computeAcb([MED('amitriptyline'), MED('furosemide')]);
    expect(r.detected).toEqual([
      { name: 'Amitriptyline', score: 3 },
      { name: 'Furosemide', score: 1 },
    ]);
  });
});

describe('ACB — Hebrew aliases', () => {
  it('matches אמיטריפטילין as Amitriptyline (3)', () => {
    expect(computeAcb([MED('אמיטריפטילין 25mg')]).totalScore).toBe(3);
  });

  it('matches לאסיקס as Furosemide (1)', () => {
    expect(computeAcb([MED('לאסיקס 40mg')]).totalScore).toBe(1);
  });
});

describe('ACB — empty + non-AC drugs', () => {
  it('returns 0 for empty meds', () => {
    expect(computeAcb([]).totalScore).toBe(0);
  });

  it('returns 0 when no drug in the ACB list', () => {
    const r = computeAcb([MED('atorvastatin'), MED('lisinopril'), MED('apixaban')]);
    expect(r.totalScore).toBe(0);
    expect(r.detected).toEqual([]);
  });
});

describe('ACB — does not double-count same drug listed twice', () => {
  it('ditropan + oxybutynin in two rows still scores 3 once (single match per drug entry)', () => {
    // Implementation walks ACB_DRUGS once; the Oxybutynin entry hits if either
    // mention is present, but the same entry is only counted once.
    const meds = [MED('oxybutynin 5mg morning'), MED('ditropan XL 10mg')];
    expect(computeAcb(meds).totalScore).toBe(3);
  });
});
