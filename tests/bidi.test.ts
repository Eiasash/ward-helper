import { describe, it, expect } from 'vitest';
import { wrapForChameleon, detectDir, lintBidi } from '@/i18n/bidi';

describe('bidi', () => {
  it('detects Hebrew vs English direction', () => {
    expect(detectDir('שלום')).toBe('rtl');
    expect(detectDir('Apixaban')).toBe('ltr');
    expect(detectDir('מטופל קיבל Apixaban')).toBe('rtl');
    expect(detectDir('12345')).toBe('neutral');
  });

  it('wraps Hebrew note with RLM after English run + ending punctuation', () => {
    const input = 'המטופל קיבל Apixaban.';
    const out = wrapForChameleon(input);
    expect(out).toContain('Apixaban\u200F.');
  });

  it('wraps parenthesized Latin-only content with LRM', () => {
    const input = 'הוחל טיפול (5 mg BID) בבית.';
    const out = wrapForChameleon(input);
    expect(out).toContain('\u200E5 mg BID\u200E');
  });

  it('does not wrap parens containing Hebrew', () => {
    const input = 'הערה (זו הערה) חשובה.';
    const out = wrapForChameleon(input);
    expect(out).not.toContain('\u200Eזו');
  });

  it('linter flags unbalanced isolates', () => {
    const bad = '\u2066some text without closing';
    const errors = lintBidi(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('linter passes on a clean wrapped note', () => {
    const good = wrapForChameleon('המטופל קיבל Apixaban.');
    const errors = lintBidi(good);
    expect(errors).toEqual([]);
  });
});

describe('bidi with SOAP-style content', () => {
  it('preserves trend arrows unchanged', () => {
    const input = 'Cr: 2.1 → 1.8, BNP 1200 → 800 ↓';
    const out = wrapForChameleon(input);
    expect(out).toContain('→');
    expect(out).toContain('↓');
  });

  it('does not wrap Hebrew hashtag labels with LRM', () => {
    const input = '#הימודינמי: יציב, #כלייתי: AKI';
    const out = wrapForChameleon(input);
    expect(out).toBe(input);
  });
});

describe('bidi edge cases', () => {
  it('detectDir returns neutral for an empty string', () => {
    expect(detectDir('')).toBe('neutral');
  });

  it('detectDir returns neutral for digits-only input', () => {
    expect(detectDir('123.456')).toBe('neutral');
  });

  it('wrapForChameleon returns empty string unchanged', () => {
    expect(wrapForChameleon('')).toBe('');
  });

  it('wrapForChameleon leaves pure Hebrew prose unchanged when no Latin embedded', () => {
    const input = 'המטופל ללא תלונות';
    expect(wrapForChameleon(input)).toBe(input);
  });

  it('lintBidi reports error for unbalanced PDI close (more closes than opens)', () => {
    const bad = 'text\u2069 without matching open';
    const errors = lintBidi(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('lintBidi reports error for unbalanced LRI open (more opens than closes)', () => {
    const bad = '\u2066text without closing PDI';
    const errors = lintBidi(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('lintBidi passes when isolate pairs are balanced', () => {
    const good = '\u2066English run\u2069';
    expect(lintBidi(good)).toEqual([]);
  });
});
