// src/notes/__tests__/orthoCalc.test.ts
//
// Tests for the ortho POD / suture / DVT calculators.
// Tests run with TZ=Asia/Jerusalem pinned via cross-env in package.json.
// The "local TZ, not UTC" regression block guards against re-introducing
// the v1-brief bug (toISOString().slice(0,10) shifts dates one day west
// for any UTC-positive zone like Asia/Jerusalem).

import { describe, it, expect } from 'vitest';
import {
  calculatePOD,
  suggestSutureRemovalDate,
  suggestDvtProphylaxis,
} from '@/notes/orthoCalc';

describe('calculatePOD', () => {
  it('returns 0 for same day', () => {
    expect(calculatePOD('2026-05-10', '2026-05-10')).toBe(0);
  });

  it('returns 12 for surgery 2026-04-23, today 2026-05-05', () => {
    expect(calculatePOD('2026-04-23', '2026-05-05')).toBe(12);
  });

  it('returns 17 for surgery 2026-04-23, today 2026-05-10 (POD-17 test patient)', () => {
    expect(calculatePOD('2026-04-23', '2026-05-10')).toBe(17);
  });

  it('clamps negatives to 0 (future surgery date — error case)', () => {
    expect(calculatePOD('2026-12-01', '2026-05-10')).toBe(0);
  });

  it('uses today (local) when todayISO is omitted', () => {
    // Surgery far in the past — POD should be a positive int regardless
    // of which day the test runs. Just assert "is a non-negative integer".
    const pod = calculatePOD('2020-01-01');
    expect(Number.isInteger(pod)).toBe(true);
    expect(pod).toBeGreaterThanOrEqual(0);
  });
});

describe('suggestSutureRemovalDate', () => {
  it('hip POD 14 default', () => {
    const r = suggestSutureRemovalDate('2026-05-01', 'hip');
    expect(r.podStandard).toBe(14);
    expect(r.dateISO).toBe('2026-05-15');
    expect(r.modifiersApplied).toEqual([]);
  });

  it('hip + steroids extends 5 days', () => {
    const r = suggestSutureRemovalDate('2026-05-01', 'hip', { steroids: true });
    expect(r.podAdjusted).toBe(19);
    expect(r.modifiersApplied).toContain('steroids/immunosuppression +5d');
  });

  it('spine fixed at POD 14', () => {
    const r = suggestSutureRemovalDate('2026-04-03', 'spine');
    expect(r.podStandard).toBe(14);
    expect(r.dateISO).toBe('2026-04-17');
  });

  it('foot fixed at POD 21 (max of 14-21 window)', () => {
    const r = suggestSutureRemovalDate('2026-04-01', 'foot');
    expect(r.podStandard).toBe(21);
    expect(r.dateISO).toBe('2026-04-22');
  });

  it('stacks multiple modifiers additively', () => {
    const r = suggestSutureRemovalDate('2026-05-01', 'hip', {
      steroids: true,
      dmUncontrolled: true,
      smoker: true,
    });
    // 14 + 5 + 5 + 3 = 27
    expect(r.podAdjusted).toBe(27);
    expect(r.modifiersApplied).toHaveLength(3);
  });

  it('throws on unknown site', () => {
    expect(() =>
      // @ts-expect-error — testing runtime guard
      suggestSutureRemovalDate('2026-05-01', 'elbow'),
    ).toThrow(/Unknown site/);
  });
});

describe('suggestDvtProphylaxis', () => {
  it('default 35-day Enoxaparin 40', () => {
    const r = suggestDvtProphylaxis('2026-04-23', 'normal');
    expect(r.drug).toBe('Enoxaparin');
    expect(r.doseSC).toBe('40mg');
    expect(r.endDateISO).toBe('2026-05-28');
    expect(r.durationDays).toBe(35);
  });

  it('HD reduces to 20mg and notes המודיאליזה', () => {
    const r = suggestDvtProphylaxis('2026-04-28', 'hd');
    expect(r.doseSC).toBe('20mg');
    expect(r.hebrewLine).toContain('המודיאליזה');
  });

  it('crclLow reduces to 20mg and notes CrCl', () => {
    const r = suggestDvtProphylaxis('2026-04-28', 'crclLow');
    expect(r.doseSC).toBe('20mg');
    expect(r.hebrewLine).toContain('CrCl');
  });

  it('bleedingRisk switches to UFH', () => {
    const r = suggestDvtProphylaxis('2026-04-28', 'bleedingRisk');
    expect(r.drug).toBe('UFH');
    expect(r.doseSC).toBe('5000 units');
    expect(r.frequency).toBe('BID-TID');
  });

  it('throws on unknown renalState', () => {
    expect(() =>
      // @ts-expect-error — testing runtime guard
      suggestDvtProphylaxis('2026-04-28', 'mild'),
    ).toThrow(/Unknown renalState/);
  });
});

describe('regression: dates are computed in local TZ, not UTC', () => {
  // The v1 brief used toISOString().slice(0,10) which always reports the
  // UTC calendar day. In Asia/Jerusalem (UTC+2 winter, UTC+3 summer), a
  // local-midnight Date's UTC representation is 21:00 or 22:00 the previous
  // day, so toISOString().slice(0,10) returns a date one day earlier.
  //
  // All these expectations assume tests run with TZ=Asia/Jerusalem
  // (pinned via cross-env in package.json `test` / `test:watch`).

  it('suture date is the local calendar day, not UTC', () => {
    // Surgery on 2026-05-01 + POD 14 (hip) = local 2026-05-15.
    // If the bug returned, this would be 2026-05-14 in Jerusalem.
    const r = suggestSutureRemovalDate('2026-05-01', 'hip');
    expect(r.dateISO).toBe('2026-05-15');
  });

  it('DVT end date is the local calendar day, not UTC', () => {
    // Surgery on 2026-04-23 + 35 days = local 2026-05-28.
    // Bug variant would return 2026-05-27 in Jerusalem.
    const r = suggestDvtProphylaxis('2026-04-23', 'normal');
    expect(r.endDateISO).toBe('2026-05-28');
  });

  it('DVT Hebrew line uses local DD/MM/YY, not UTC', () => {
    const r = suggestDvtProphylaxis('2026-04-23', 'normal');
    // 2026-05-28 local = '28/05/26'
    expect(r.hebrewLine).toContain('28/05/26');
  });

  it('POD math is consistent with local calendar', () => {
    // Same-day with explicit todayISO → 0, regardless of zone.
    expect(calculatePOD('2026-05-10', '2026-05-10')).toBe(0);
    // 1 calendar day apart → 1
    expect(calculatePOD('2026-05-10', '2026-05-11')).toBe(1);
  });
});
