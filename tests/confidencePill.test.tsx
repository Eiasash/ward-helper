/**
 * ConfidencePill threshold mapping — locks the bucket boundaries the spec
 * calls out (≥0.9 high/green, 0.6–0.9 med/amber, <0.6 low/red) so a future
 * refactor can't silently shift them and visually mislabel a low-confidence
 * extract.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ConfidencePill,
  levelToScore,
  scoreToTier,
} from '@/ui/components/ConfidencePill';

describe('levelToScore', () => {
  it('maps high to the [0.9, 1.0] bucket', () => {
    const r = levelToScore('high');
    expect(r.tier).toBe('high');
    expect(r.min).toBe(0.9);
    expect(r.max).toBe(1.0);
  });
  it('maps med to the [0.6, 0.9) bucket', () => {
    const r = levelToScore('med');
    expect(r.tier).toBe('med');
    expect(r.min).toBe(0.6);
    expect(r.max).toBe(0.9);
  });
  it('maps low to the [0, 0.6) bucket', () => {
    const r = levelToScore('low');
    expect(r.tier).toBe('low');
    expect(r.min).toBe(0);
    expect(r.max).toBe(0.6);
  });
  it('returns unknown when no level was emitted', () => {
    const r = levelToScore(undefined);
    expect(r.tier).toBe('unknown');
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
  });
});

describe('scoreToTier (numeric input — future-proof)', () => {
  it('1.0 → high', () => expect(scoreToTier(1.0)).toBe('high'));
  it('0.95 → high', () => expect(scoreToTier(0.95)).toBe('high'));
  it('0.9 → high (boundary inclusive)', () => expect(scoreToTier(0.9)).toBe('high'));
  it('0.89 → med', () => expect(scoreToTier(0.89)).toBe('med'));
  it('0.6 → med (boundary inclusive)', () => expect(scoreToTier(0.6)).toBe('med'));
  it('0.59 → low', () => expect(scoreToTier(0.59)).toBe('low'));
  it('0.0 → low', () => expect(scoreToTier(0.0)).toBe('low'));
  it('clamps out-of-range high → high', () =>
    expect(scoreToTier(1.5)).toBe('high'));
  it('NaN / Infinity → unknown', () => {
    expect(scoreToTier(NaN)).toBe('unknown');
    expect(scoreToTier(Infinity)).toBe('unknown');
  });
});

describe('ConfidencePill render', () => {
  it('uses data-confidence="high" + Hebrew label for high level', () => {
    render(<ConfidencePill level="high" />);
    const pill = screen.getByText(/גבוה/);
    expect(pill).toHaveAttribute('data-confidence', 'high');
  });
  it('uses data-confidence="med" + Hebrew label for med level', () => {
    render(<ConfidencePill level="med" />);
    const pill = screen.getByText(/בינוני/);
    expect(pill).toHaveAttribute('data-confidence', 'med');
  });
  it('uses data-confidence="low" + Hebrew label for low level', () => {
    render(<ConfidencePill level="low" />);
    const pill = screen.getByText(/נמוך/);
    expect(pill).toHaveAttribute('data-confidence', 'low');
  });
  it('uses data-confidence="unknown" when no level was emitted', () => {
    render(<ConfidencePill level={undefined} />);
    const pill = screen.getByText(/לא דורג/);
    expect(pill).toHaveAttribute('data-confidence', 'unknown');
  });
});
