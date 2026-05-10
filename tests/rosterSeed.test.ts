import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyRosterSeedFromStorage,
  applyRosterSeedFromStorageWithConfidence,
} from '@/notes/rosterSeed';
import type { ParseFields, Confidence } from '@/agent/tools';
import type { RosterPatient } from '@/storage/roster';

function makeRoster(opts: Partial<RosterPatient> & { name: string }): RosterPatient {
  return {
    id: opts.id ?? crypto.randomUUID(),
    tz: opts.tz ?? null,
    name: opts.name,
    age: opts.age ?? null,
    sex: opts.sex ?? null,
    room: opts.room ?? null,
    bed: opts.bed ?? null,
    losDays: opts.losDays ?? null,
    dxShort: opts.dxShort ?? null,
    sourceMode: opts.sourceMode ?? 'manual',
    importedAt: opts.importedAt ?? Date.now(),
  };
}

describe('applyRosterSeedFromStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns extract unchanged when no seed in storage', () => {
    const extract: ParseFields = { meds: [{ name: 'Apixaban' }] };
    const out = applyRosterSeedFromStorage(extract);
    expect(out).toEqual(extract);
    expect(sessionStorage.getItem('rosterSeed')).toBeNull();
  });

  it('merges roster identity over extract identity, clears seed after read', () => {
    const seed = makeRoster({
      name: 'רוזנברג מרים',
      tz: '123456789',
      age: 87,
      sex: 'F',
      room: '12',
    });
    sessionStorage.setItem('rosterSeed', JSON.stringify(seed));

    const extract: ParseFields = {
      // Sparse extract — clinical only, no identity
      meds: [{ name: 'Furosemide', dose: '40 mg' }],
      labs: [{ name: 'BNP', value: '1200', unit: 'pg/mL' }],
    };
    const out = applyRosterSeedFromStorage(extract);

    expect(out.name).toBe('רוזנברג מרים');
    expect(out.teudatZehut).toBe('123456789');
    expect(out.age).toBe(87);
    expect(out.sex).toBe('F');
    expect(out.room).toBe('12');
    expect(out.meds).toEqual([{ name: 'Furosemide', dose: '40 mg' }]);
    expect(out.labs).toEqual([{ name: 'BNP', value: '1200', unit: 'pg/mL' }]);

    // Seed cleared after read — one-shot semantics
    expect(sessionStorage.getItem('rosterSeed')).toBeNull();
  });

  it('roster identity wins over extract identity (collision case)', () => {
    const seed = makeRoster({
      name: 'רוזנברג מרים',
      tz: '123456789',
      age: 87,
    });
    sessionStorage.setItem('rosterSeed', JSON.stringify(seed));

    const extract: ParseFields = {
      // Conflicting identity — extract picked up wrong name (e.g.,
      // OCR'd a doctor name from the AZMA UI strip)
      name: 'WRONG DOCTOR NAME',
      teudatZehut: '999999998',
      age: 50,
    };
    const out = applyRosterSeedFromStorage(extract);

    expect(out.name).toBe('רוזנברג מרים');
    expect(out.teudatZehut).toBe('123456789');
    expect(out.age).toBe(87);
  });

  it('extract fills identity where roster is null', () => {
    const seed = makeRoster({ name: 'מטופל', tz: null, age: null });
    sessionStorage.setItem('rosterSeed', JSON.stringify(seed));

    const extract: ParseFields = {
      teudatZehut: '123456789',
      age: 80,
      sex: 'M',
    };
    const out = applyRosterSeedFromStorage(extract);

    expect(out.name).toBe('מטופל');
    expect(out.teudatZehut).toBe('123456789');
    expect(out.age).toBe(80);
    expect(out.sex).toBe('M');
  });

  it('clears bad JSON from storage and returns extract unchanged', () => {
    sessionStorage.setItem('rosterSeed', '{not valid json');

    const extract: ParseFields = { meds: [{ name: 'Apixaban' }] };
    const out = applyRosterSeedFromStorage(extract);

    expect(out).toEqual(extract);
    // Storage cleaned even on bad JSON — defensive against stale
    // schema versions or manual tampering blocking future merges.
    expect(sessionStorage.getItem('rosterSeed')).toBeNull();
  });

  it('WithConfidence variant: marks roster-sourced identity as high confidence', () => {
    // Regression for the SOAP "re-prompt for ID" bug. When user clicks
    // +SOAP on a roster card, identity flows from the (curator-confirmed)
    // roster — Review.tsx must NOT show "אישור ידני נדרש" on those fields.
    const seed = makeRoster({
      name: 'אסתר כהן-לוי',
      tz: '111111111',
      age: 84,
      sex: 'F',
      room: '12',
    });
    sessionStorage.setItem('rosterSeed', JSON.stringify(seed));
    const extract: ParseFields = { meds: [{ name: 'Ceftriaxone', dose: '1g' }] };
    const baseConfidence: Record<string, Confidence> = {
      // Extract observed nothing for identity — would be undefined for these keys
      // in real flow. Here we set 'low' to verify the override truly upgrades.
      name: 'low', teudatZehut: 'low', age: 'low',
    };
    const out = applyRosterSeedFromStorageWithConfidence(extract, baseConfidence);
    expect(out.fields.name).toBe('אסתר כהן-לוי');
    expect(out.fields.teudatZehut).toBe('111111111');
    expect(out.confidence.name).toBe('high');
    expect(out.confidence.teudatZehut).toBe('high');
    expect(out.confidence.age).toBe('high');
    expect(out.confidence.sex).toBe('high');
    expect(out.confidence.room).toBe('high');
  });

  it('WithConfidence variant: skips override for fields the roster lacks', () => {
    // If roster row had no tz (sourceMode=paste often does), extract's
    // own confidence for tz must NOT be clobbered to 'high'.
    const seed = makeRoster({ name: 'מטופל', tz: null, age: null });
    sessionStorage.setItem('rosterSeed', JSON.stringify(seed));
    const extract: ParseFields = { teudatZehut: '999999998', age: 80 };
    const baseConfidence: Record<string, Confidence> = {
      name: 'low', teudatZehut: 'low', age: 'low',
    };
    const out = applyRosterSeedFromStorageWithConfidence(extract, baseConfidence);
    expect(out.confidence.name).toBe('high'); // roster supplied name
    expect(out.confidence.teudatZehut).toBe('low'); // roster lacked tz, extract's confidence stands
    expect(out.confidence.age).toBe('low'); // roster lacked age
  });

  it('WithConfidence variant: passes through when no seed', () => {
    const extract: ParseFields = { meds: [] };
    const baseConfidence: Record<string, Confidence> = { name: 'med' };
    const out = applyRosterSeedFromStorageWithConfidence(extract, baseConfidence);
    expect(out.fields).toEqual(extract);
    expect(out.confidence).toEqual(baseConfidence);
  });

  it('is one-shot: a second call returns extract unchanged', () => {
    const seed = makeRoster({ name: 'מטופל', tz: '123456789' });
    sessionStorage.setItem('rosterSeed', JSON.stringify(seed));

    const extract: ParseFields = { meds: [] };
    const first = applyRosterSeedFromStorage(extract);
    expect(first.name).toBe('מטופל');

    const extract2: ParseFields = { meds: [{ name: 'X' }] };
    const second = applyRosterSeedFromStorage(extract2);
    expect(second).toEqual(extract2);
    expect(second.name).toBeUndefined();
  });
});
