import { describe, it, expect } from 'vitest';
import { checkStopp } from '@/safety/stopp';
import type { Med, PatientContext } from '@/safety/types';

const MED = (name: string, extra: Partial<Med> = {}): Med => ({ name, ...extra });

describe('STOPP — NSAID + warfarin', () => {
  it('fires for ibuprofen + warfarin', () => {
    const hits = checkStopp([MED('ibuprofen'), MED('warfarin')], {});
    const h = hits.find((x) => x.code === 'STOPP-NSAID-WARFARIN');
    expect(h).toBeTruthy();
    expect(h?.severity).toBe('critical');
  });

  it('matches Hebrew warfarin (וורפרין)', () => {
    const hits = checkStopp([MED('voltaren'), MED('וורפרין')], {});
    expect(hits.find((h) => h.code === 'STOPP-NSAID-WARFARIN')).toBeTruthy();
  });

  it('does not fire without warfarin', () => {
    const hits = checkStopp([MED('ibuprofen')], {});
    expect(hits.find((h) => h.code === 'STOPP-NSAID-WARFARIN')).toBeUndefined();
  });
});

describe('STOPP — NSAID + DOAC', () => {
  it('fires for naproxen + apixaban', () => {
    const hits = checkStopp([MED('naproxen'), MED('apixaban')], {});
    expect(hits.find((h) => h.code === 'STOPP-NSAID-DOAC')).toBeTruthy();
  });

  it('fires for ibuprofen + rivaroxaban', () => {
    const hits = checkStopp([MED('ibuprofen'), MED('rivaroxaban')], {});
    expect(hits.find((h) => h.code === 'STOPP-NSAID-DOAC')).toBeTruthy();
  });
});

describe('STOPP — beta-blocker + verapamil/diltiazem', () => {
  it('fires for metoprolol + verapamil', () => {
    const hits = checkStopp([MED('metoprolol'), MED('verapamil')], {});
    const h = hits.find((x) => x.code === 'STOPP-BB-VERAPAMIL');
    expect(h).toBeTruthy();
    expect(h?.severity).toBe('high');
  });

  it('fires for bisoprolol + diltiazem', () => {
    const hits = checkStopp([MED('bisoprolol'), MED('diltiazem')], {});
    expect(hits.find((h) => h.code === 'STOPP-BB-VERAPAMIL')).toBeTruthy();
  });

  it('does not fire for beta-blocker alone', () => {
    const hits = checkStopp([MED('metoprolol')], {});
    expect(hits.find((h) => h.code === 'STOPP-BB-VERAPAMIL')).toBeUndefined();
  });
});

describe('STOPP — opioid no laxative', () => {
  it('fires for oxycodone alone', () => {
    const hits = checkStopp([MED('oxycodone 5mg q4h')], {});
    expect(hits.find((h) => h.code === 'STOPP-OPIOID-NO-LAX')).toBeTruthy();
  });

  it('does not fire when laxative present', () => {
    const meds = [MED('oxycodone'), MED('movicol 1 sachet daily')];
    const hits = checkStopp(meds, {});
    expect(hits.find((h) => h.code === 'STOPP-OPIOID-NO-LAX')).toBeUndefined();
  });

  it('matches Hebrew opioid + accepts polyethylene glycol', () => {
    const meds = [MED('מורפין'), MED('polyethylene glycol')];
    const hits = checkStopp(meds, {});
    expect(hits.find((h) => h.code === 'STOPP-OPIOID-NO-LAX')).toBeUndefined();
  });
});

describe('STOPP — duplicate ACEi/ARB', () => {
  it('fires for enalapril + losartan', () => {
    const hits = checkStopp([MED('enalapril'), MED('losartan')], {});
    expect(hits.find((h) => h.code === 'STOPP-ACEI-ARB-DUP')).toBeTruthy();
  });

  it('does not fire for ACEi alone', () => {
    const hits = checkStopp([MED('lisinopril')], {});
    expect(hits.find((h) => h.code === 'STOPP-ACEI-ARB-DUP')).toBeUndefined();
  });
});

describe('STOPP — dual antiplatelet without indication', () => {
  it('fires for aspirin + clopidogrel without stent indication', () => {
    const hits = checkStopp([MED('aspirin'), MED('clopidogrel')], {});
    expect(hits.find((h) => h.code === 'STOPP-DAPT-NO-IND')).toBeTruthy();
  });

  it('suppressed when recent stent in conditions', () => {
    const hits = checkStopp([MED('aspirin'), MED('plavix')], {
      conditions: ['recent PCI with stent'],
    });
    expect(hits.find((h) => h.code === 'STOPP-DAPT-NO-IND')).toBeUndefined();
  });

  it('does not fire for single antiplatelet', () => {
    const hits = checkStopp([MED('aspirin 100mg')], {});
    expect(hits.find((h) => h.code === 'STOPP-DAPT-NO-IND')).toBeUndefined();
  });
});

describe('STOPP — empty', () => {
  it('returns [] for empty list', () => {
    expect(checkStopp([], {})).toEqual([]);
  });
});
