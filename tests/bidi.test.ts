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
