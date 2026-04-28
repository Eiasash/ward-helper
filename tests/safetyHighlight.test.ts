/**
 * Drug-safety inline highlights — pure range computation. UI rendering is
 * exercised transitively by Review's smoke tests; this file locks the
 * find/coalesce algorithm.
 */
import { describe, it, expect } from 'vitest';
import { findHighlightRanges } from '@/ui/components/SafetyHighlightedText';
import type { SafetyFlags, Hit } from '@/safety/types';

function mkHit(over: Partial<Hit>): Hit {
  return {
    code: 'TEST-1',
    drug: 'Apixaban',
    recommendation: 'הימנע מ-Apixaban במצב כליה ירוד',
    severity: 'high',
    ...over,
  };
}

function mkFlags(over: Partial<SafetyFlags> = {}): SafetyFlags {
  return {
    beers: [],
    stopp: [],
    start: [],
    acbScore: 0,
    ...over,
  };
}

describe('findHighlightRanges', () => {
  it('returns empty when no flags', () => {
    expect(findHighlightRanges('Apixaban 5 mg', null)).toEqual([]);
    expect(findHighlightRanges('Apixaban 5 mg', mkFlags())).toEqual([]);
  });

  it('returns empty when text is empty', () => {
    expect(findHighlightRanges('', mkFlags({ beers: [mkHit({})] }))).toEqual([]);
  });

  it('matches a single drug name (case-insensitive)', () => {
    const flags = mkFlags({ beers: [mkHit({ drug: 'Apixaban' })] });
    const r = findHighlightRanges('Patient on apixaban 5 mg', flags);
    expect(r).toHaveLength(1);
    expect(r[0]?.start).toBe(11);
    expect(r[0]?.end).toBe(19);
  });

  it('matches multiple drug names', () => {
    const flags = mkFlags({
      beers: [mkHit({ drug: 'Apixaban' }), mkHit({ drug: 'Furosemide', code: 'TEST-2' })],
    });
    const r = findHighlightRanges('Apixaban 5 mg, Furosemide 40 mg', flags);
    expect(r).toHaveLength(2);
    expect(r[0]?.hit.drug).toBe('Apixaban');
    expect(r[1]?.hit.drug).toBe('Furosemide');
  });

  it('respects word boundaries — "Apix" inside "Apixaban" matches just once', () => {
    const flags = mkFlags({ beers: [mkHit({ drug: 'Apixaban' })] });
    const r = findHighlightRanges('Apixaban Apixaban', flags);
    expect(r).toHaveLength(2);
    expect(r[0]?.start).toBe(0);
    expect(r[1]?.start).toBe(9);
  });

  it('does NOT match a substring ("aspirin" against "spirin")', () => {
    const flags = mkFlags({ beers: [mkHit({ drug: 'aspirin' })] });
    expect(findHighlightRanges('myaspirinx', flags)).toHaveLength(0);
  });

  it('coalesces overlapping ranges — red severity wins over amber', () => {
    const flags = mkFlags({
      beers: [mkHit({ drug: 'Apixaban', severity: 'moderate', code: 'AMBER' })],
      stopp: [mkHit({ drug: 'Apixaban', severity: 'high', code: 'RED' })],
    });
    const r = findHighlightRanges('Apixaban 5 mg', flags);
    expect(r).toHaveLength(1);
    // Either rule order can fire first, but the coalesced winner should be red.
    // The current impl iterates beers→stopp→start in order, so the AMBER hit
    // lands first and the RED stopp hit overrides via the coalesce step.
    expect(r[0]?.hit.severity).toBe('high');
    expect(r[0]?.hit.code).toBe('RED');
  });

  it('keeps non-overlapping ranges sorted left-to-right', () => {
    const flags = mkFlags({
      beers: [
        mkHit({ drug: 'Furosemide', code: 'F1' }),
        mkHit({ drug: 'Apixaban', code: 'A1' }),
      ],
    });
    const r = findHighlightRanges('Apixaban 5 mg, Furosemide 40 mg', flags);
    expect(r).toHaveLength(2);
    expect(r[0]?.hit.drug).toBe('Apixaban');
    expect(r[1]?.hit.drug).toBe('Furosemide');
  });

  it('handles regex-special characters in drug names safely', () => {
    const flags = mkFlags({
      beers: [mkHit({ drug: 'Drug+Plus' })],
    });
    expect(() =>
      findHighlightRanges('Drug+Plus 1 mg', flags),
    ).not.toThrow();
    const r = findHighlightRanges('Drug+Plus 1 mg', flags);
    expect(r).toHaveLength(1);
  });

  it('matches Hebrew drug names (single token)', () => {
    const flags = mkFlags({
      beers: [mkHit({ drug: 'אומפרזול' })],
    });
    const r = findHighlightRanges('המטופל מקבל אומפרזול', flags);
    expect(r).toHaveLength(1);
    expect(r[0]?.start).toBe('המטופל מקבל '.length);
  });
});
