import { describe, it, expect } from 'vitest';
import {
  wrapForChameleon,
  detectDir,
  lintBidi,
  sanitizeForChameleon,
  auditChameleonRules,
} from '@/i18n/bidi';

describe('bidi direction detection', () => {
  it('detects Hebrew vs English direction', () => {
    expect(detectDir('שלום')).toBe('rtl');
    expect(detectDir('Apixaban')).toBe('ltr');
    expect(detectDir('מטופל קיבל Apixaban')).toBe('rtl');
    expect(detectDir('12345')).toBe('neutral');
  });

  it('returns neutral for empty and digits-only input', () => {
    expect(detectDir('')).toBe('neutral');
    expect(detectDir('123.456')).toBe('neutral');
  });
});

describe('bidi directional marks', () => {
  it('wraps Hebrew note with RLM after English run + ending punctuation', () => {
    const input = 'המטופל קיבל Apixaban.';
    const out = wrapForChameleon(input);
    expect(out).toContain('Apixaban\u200F.');
  });

  it('wraps parenthesized Latin-only content with LRM', () => {
    const input = 'הוחל טיפול (5 mg BID) בבית.';
    const out = wrapForChameleon(input);
    // BID is replaced by "פעמיים ביום" by the sanitizer, so the paren now contains Hebrew
    // and LRM wrap does not apply. Test a pure-Latin paren instead:
    const pureLatin = wrapForChameleon('הוחל טיפול (5 mg daily) בבית.');
    expect(pureLatin).toContain('\u200E5 mg daily\u200E');
    // And the BID version should still be Hebrew, without an LRM wrap:
    expect(out).not.toContain('\u200EBID');
    expect(out).toContain('פעמיים ביום');
  });

  it('does not wrap parens containing Hebrew', () => {
    const input = 'הערה (זו הערה) חשובה.';
    const out = wrapForChameleon(input);
    expect(out).not.toContain('\u200Eזו');
  });

  it('leaves pure Hebrew prose unchanged when no Latin embedded', () => {
    const input = 'המטופל ללא תלונות';
    expect(wrapForChameleon(input)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(wrapForChameleon('')).toBe('');
  });
});

describe('bidi linter', () => {
  it('flags unbalanced opening isolates', () => {
    const errors = lintBidi('\u2066some text without closing');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('flags unbalanced PDI (close without open)', () => {
    const errors = lintBidi('text\u2069 without matching open');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes on a clean wrapped note', () => {
    const errors = lintBidi(wrapForChameleon('המטופל קיבל Apixaban.'));
    expect(errors).toEqual([]);
  });

  it('passes when isolate pairs are balanced', () => {
    expect(lintBidi('\u2066English run\u2069')).toEqual([]);
  });
});

// =========================================================================
// Chameleon sanitizer — enforces the rules from szmc-clinical-notes skill.
// Arrows, bold, >N, <N, BID/qNh all corrupt or confuse when pasted into
// Chameleon EMR. The sanitizer strips them before the clipboard boundary.
// =========================================================================

describe('Chameleon sanitizer — arrows', () => {
  it('replaces → with " > " for trends', () => {
    const out = sanitizeForChameleon('Cr: 2.1 → 1.8');
    expect(out).toContain('Cr: 2.1 > 1.8');
    expect(out).not.toContain('→');
  });

  it('replaces ← with ">" (equivalent progression meaning in Hebrew prose)', () => {
    const out = sanitizeForChameleon('חום 39.2 ← afebrile');
    expect(out).not.toContain('←');
    expect(out).toContain('>');
  });

  it('replaces ↑ with Hebrew "עלייה ל-"', () => {
    const out = sanitizeForChameleon('Cr ↑ 2.5');
    expect(out).not.toContain('↑');
    expect(out).toContain('עלייה ל-');
  });

  it('replaces ↓ with Hebrew "ירידה ל-"', () => {
    const out = sanitizeForChameleon('BNP 1200 ↓ 800');
    expect(out).not.toContain('↓');
    expect(out).toContain('ירידה ל-');
  });

  it('replaces => with " > "', () => {
    expect(sanitizeForChameleon('Cr 2.1 => 1.8')).toContain('Cr 2.1 > 1.8');
  });

  it('wrapForChameleon — end-to-end — strips all arrow variants', () => {
    const input = 'Cr: 2.1 → 1.8, BNP 1200 → 800 ↓';
    const out = wrapForChameleon(input);
    expect(out).not.toContain('→');
    expect(out).not.toContain('↑');
    expect(out).not.toContain('↓');
    expect(out).not.toContain('←');
  });
});

describe('Chameleon sanitizer — markdown artifacts', () => {
  it('strips ** bold markers', () => {
    expect(sanitizeForChameleon('**חשוב** מאוד')).toBe('חשוב מאוד');
  });

  it('strips single * emphasis markers', () => {
    expect(sanitizeForChameleon('*המלצה* חמה')).toBe('המלצה חמה');
  });

  it('collapses -- to single dash', () => {
    expect(sanitizeForChameleon('מטופל -- יציב')).toBe('מטופל - יציב');
  });

  it('drops triple-dash horizontal rules', () => {
    const out = sanitizeForChameleon('חלק א\n---\nחלק ב');
    expect(out).not.toMatch(/^-{3,}$/m);
  });

  it('collapses >>>> into single >', () => {
    expect(sanitizeForChameleon('Cr: 2.1 >>>> 1.8')).toBe('Cr: 2.1 > 1.8');
  });
});

describe('Chameleon sanitizer — comparison operators flip in RTL', () => {
  it('replaces >200 with מעל 200', () => {
    expect(sanitizeForChameleon('גלוקוז >200')).toContain('מעל 200');
  });

  it('replaces <50 with מתחת 50', () => {
    expect(sanitizeForChameleon('DBP <50')).toContain('מתחת 50');
  });

  it('preserves " > " transition syntax (spaces around > mean transition, not comparison)', () => {
    const out = sanitizeForChameleon('Cr: 1.55 > 1.03');
    expect(out).toContain('1.55 > 1.03');
    expect(out).not.toContain('מעל');
  });
});

describe('Chameleon sanitizer — English drug frequency abbreviations', () => {
  it('q8h -> כל 8 שעות', () => {
    expect(sanitizeForChameleon('Paracetamol 1g q8h')).toContain('כל 8 שעות');
  });

  it('qd -> פעם ביום', () => {
    expect(sanitizeForChameleon('Apixaban 5mg qd')).toContain('פעם ביום');
  });

  it('BID -> פעמיים ביום (case-insensitive)', () => {
    expect(sanitizeForChameleon('Apixaban 5mg BID')).toContain('פעמיים ביום');
    expect(sanitizeForChameleon('Apixaban 5mg bid')).toContain('פעמיים ביום');
  });

  it('TID -> 3 פעמים ביום', () => {
    expect(sanitizeForChameleon('drug tid')).toContain('3 פעמים ביום');
  });

  it('QID -> 4 פעמים ביום', () => {
    expect(sanitizeForChameleon('drug QID')).toContain('4 פעמים ביום');
  });

  it('qhs -> לפני שינה', () => {
    expect(sanitizeForChameleon('Melatonin 3mg qhs')).toContain('לפני שינה');
  });

  it('does not mangle words that happen to contain "bid" (word-boundary safe)', () => {
    expect(sanitizeForChameleon('bidirectional')).toBe('bidirectional');
  });
});

describe('Chameleon sanitizer — miscellaneous', () => {
  it('drops trailing "?" after a Hebrew word on a line', () => {
    const out = sanitizeForChameleon('מטופל יציב?\nשורה נוספת');
    expect(out).toContain('מטופל יציב\n');
  });

  it('collapses triple+ blank lines to a single blank line', () => {
    const out = sanitizeForChameleon('שורה א\n\n\n\nשורה ב');
    expect(out).toBe('שורה א\n\nשורה ב');
  });

  it('trims trailing whitespace on each line', () => {
    expect(sanitizeForChameleon('שורה א   \nשורה ב\t')).toBe('שורה א\nשורה ב');
  });

  it('is idempotent — running twice yields the same result', () => {
    const input = 'Cr: 2.1 → 1.8, **חשוב** >200, q8h';
    const once = sanitizeForChameleon(input);
    const twice = sanitizeForChameleon(once);
    expect(twice).toBe(once);
  });
});

describe('auditChameleonRules — reports violations found', () => {
  it('reports all violation types on dirty input', () => {
    const dirty = 'Cr: 2.1 → 1.8, **bold**, q8h -- >200 <50 >>>>';
    const issues = auditChameleonRules(dirty);
    expect(issues.length).toBeGreaterThan(4);
  });

  it('returns empty array for sanitized output (self-consistency)', () => {
    const dirty = 'Cr: 2.1 → 1.8, **חשוב** q8h';
    const clean = sanitizeForChameleon(dirty);
    expect(auditChameleonRules(clean)).toEqual([]);
  });

  it('passes on a clean SZMC-format note', () => {
    const clean = 'סידן: 12.3 > 9.8 (20/04)\nApixaban 5 מ"ג פעמיים ביום';
    expect(auditChameleonRules(clean)).toEqual([]);
  });
});

describe('bidi with Hebrew hashtag labels (SOAP categories)', () => {
  it('does not wrap Hebrew hashtag labels with LRM', () => {
    const input = '# הימודינמי: יציב, # כלייתי: AKI';
    const out = wrapForChameleon(input);
    expect(out).toContain('# הימודינמי');
    expect(out).toContain('# כלייתי');
  });
});

describe('Chameleon sanitizer — compound operators (>= <= ≥ ≤)', () => {
  it('spells out >= as Hebrew גדול-שווה', () => {
    const out = sanitizeForChameleon('WBC >=10000');
    expect(out).toContain('גדול-שווה');
    expect(out).not.toContain('>=');
    expect(out).not.toContain('מעל 1'); // ensure rule 5 didn't fire after
  });

  it('spells out <= as Hebrew קטן-שווה', () => {
    const out = sanitizeForChameleon('BP <=90');
    expect(out).toContain('קטן-שווה');
    expect(out).not.toContain('<=');
  });

  it('handles unicode ≥ the same as >=', () => {
    const out = sanitizeForChameleon('eGFR ≥60');
    expect(out).toContain('גדול-שווה');
    expect(out).not.toContain('≥');
  });

  it('handles unicode ≤ the same as <=', () => {
    const out = sanitizeForChameleon('Na ≤130');
    expect(out).toContain('קטן-שווה');
    expect(out).not.toContain('≤');
  });

  it('does not leak מעל/מתחת when input used only compound operators', () => {
    const out = sanitizeForChameleon('WBC >=10000, Na <=130');
    expect(out).not.toContain('מעל');
    expect(out).not.toContain('מתחת');
  });
});

describe('Chameleon sanitizer — transition vs comparison (> with adjacent digits)', () => {
  it('preserves digit>digit transitions (no comparison spell-out)', () => {
    // A doctor who writes "Cr 2.1>1.8" without spaces still means a trend.
    const out = sanitizeForChameleon('Cr 2.1>1.8');
    expect(out).toContain('2.1>1.8');
    expect(out).not.toContain('מעל 1.8');
  });

  it('still spells out true >N comparisons (non-digit prefix)', () => {
    expect(sanitizeForChameleon('glucose >200')).toContain('מעל 200');
    expect(sanitizeForChameleon('Hb >12 g/dL')).toContain('מעל 12');
  });

  it('still spells out true <N comparisons', () => {
    expect(sanitizeForChameleon('Na <130')).toContain('מתחת 130');
  });

  it('preserves multi-step trend chain with no spaces', () => {
    const out = sanitizeForChameleon('Cr 2.5>2.1>1.8');
    expect(out).toContain('2.5>2.1>1.8');
    expect(out).not.toContain('מעל');
  });
});

describe('auditChameleonRules — new compound detectors', () => {
  it('flags >= in text', () => {
    expect(auditChameleonRules('WBC >=10000').join(' ')).toMatch(/>=|גדול-שווה/);
  });

  it('flags ≥ in text', () => {
    expect(auditChameleonRules('eGFR ≥60').join(' ')).toMatch(/≥|>=|גדול-שווה/);
  });

  it('does NOT flag digit>digit transition as a violation', () => {
    const issues = auditChameleonRules('Cr 2.1>1.8');
    expect(issues.filter((s) => /">N"/.test(s))).toEqual([]);
  });
});
