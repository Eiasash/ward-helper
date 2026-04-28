import { describe, it, expect } from 'vitest';
import {
  wrapForChameleon,
  detectDir,
  lintBidi,
  sanitizeForChameleon,
  auditChameleonRules,
  sanitizeLabSection,
  auditLabSection,
  correctedCalcium,
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

  it('returns clean for sanitized output containing only med-taper trends', () => {
    // Med-taper "Lantus 22 > 10-12" is still allowed; what's flagged is
    // numeric>numeric lab patterns. Use a med-taper string here.
    const dirty = 'Lantus 22 → 10-12, **חשוב** q8h';
    const clean = sanitizeForChameleon(dirty);
    // After sanitize the arrow becomes "22 > 10-12" which IS numeric-arrow
    // pattern — so this DOES trigger the new lab-trend warning. That's the
    // correct behavior: even med tapers in arrow-shape should be reviewed,
    // and the model is now instructed to use prose. So we accept a single
    // non-empty audit here.
    const issues = auditChameleonRules(clean);
    // Allow the lab-trend warning to fire — the other violations should
    // all be gone.
    expect(issues.every(i => i.includes('Numeric arrow trend') || i.includes('"N L" or "N H"'))).toBe(true);
  });

  it('passes on a clean SZMC prose-trend lab format', () => {
    const clean = 'סידן בקבלה 12.3, בשחרור 9.8 (מתחת לנורמה)\nApixaban 5 מ"ג פעמיים ביום';
    expect(auditChameleonRules(clean)).toEqual([]);
  });

  it('flags numeric arrow trends as style warning (lab section should be prose)', () => {
    const arrowStyle = 'CRP: 7.72 > 0.87 > 1.35';
    const issues = auditChameleonRules(arrowStyle);
    expect(issues.some(i => i.includes('Numeric arrow trend'))).toBe(true);
  });

  it('flags L/H suffix on lab numbers', () => {
    const lhSuffix = 'Ca 11.3 H, Hb 10.8 L';
    const issues = auditChameleonRules(lhSuffix);
    expect(issues.some(i => i.includes('"N L" or "N H"'))).toBe(true);
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

describe('sanitizeLabSection — stricter than general sanitizer', () => {
  it('strips space-padded > arrows in lab trends and joins with comma', () => {
    const input = 'CRP בקבלה 7.72 > 0.87 > 1.35 בשחרור';
    const out = sanitizeLabSection(input);
    expect(out).not.toContain(' > ');
    expect(out).toContain(', ');
  });

  it('converts H suffix on lab number to Hebrew parens', () => {
    expect(sanitizeLabSection('סידן 11.3 H')).toContain('(מעל הנורמה)');
    expect(sanitizeLabSection('סידן 11.3 H')).not.toMatch(/\sH\b/);
  });

  it('converts L suffix on lab number to Hebrew parens', () => {
    expect(sanitizeLabSection('אלבומין 3.0 L')).toContain('(מתחת לנורמה)');
    expect(sanitizeLabSection('אלבומין 3.0 L')).not.toMatch(/\sL\b/);
  });

  it('converts no-space H suffix (printout style "11.3H")', () => {
    expect(sanitizeLabSection('Ca 11.3H')).toContain('(מעל הנורמה)');
  });

  it('also runs the general sanitizer (Unicode arrows still caught)', () => {
    const out = sanitizeLabSection('Cr 0.72 → 0.78');
    expect(out).not.toContain('→');
  });

  it('preserves Hebrew prose lab descriptions unchanged', () => {
    const input = 'קראטינין בקבלה היה 0.72, יציב במהלך האשפוז.';
    expect(sanitizeLabSection(input)).toBe(input);
  });
});

describe('correctedCalcium — albumin-corrected total calcium', () => {
  it('returns measured value when albumin is null/undefined', () => {
    expect(correctedCalcium(11.2, null)).toBe(11.2);
    expect(correctedCalcium(11.2, undefined)).toBe(11.2);
  });

  it('returns measured value when albumin is normal (>=4.0)', () => {
    expect(correctedCalcium(11.2, 4.0)).toBe(11.2);
    expect(correctedCalcium(11.2, 4.5)).toBe(11.2);
  });

  it('Bloch case: Ca 11.2 + Albumin 3.0 → corrected 12.0', () => {
    expect(correctedCalcium(11.2, 3.0)).toBe(12.0);
  });

  it('mild hypoalbuminemia: Ca 11.0 + Albumin 3.4 → corrected 11.5', () => {
    expect(correctedCalcium(11.0, 3.4)).toBe(11.5);
  });

  it('apparent hypocalcemia normalizes: Ca 8.0 + Albumin 2.5 → corrected 9.2', () => {
    expect(correctedCalcium(8.0, 2.5)).toBe(9.2);
  });

  it('rounds to 1 decimal', () => {
    const out = correctedCalcium(10.0, 2.7);
    expect(Number.isInteger(out * 10)).toBe(true);
  });
});

describe('auditLabSection — lab-section-specific violations', () => {
  it('clean prose lab section produces no issues', () => {
    const text = 'CRP בקבלה היה 7.72, חלף במהלך האשפוז ועמד על 1.35 בשחרור.';
    expect(auditLabSection(text)).toEqual([]);
  });

  it('flags > arrow in lab trend', () => {
    const issues = auditLabSection('CRP 7.72 > 1.35');
    expect(issues.some((s) => /arrow found in lab section/.test(s))).toBe(true);
  });

  it('flags H suffix on lab value', () => {
    const issues = auditLabSection('Ca 11.3 H');
    expect(issues.some((s) => /H\/L suffix/.test(s))).toBe(true);
  });

  it('inherits general Chameleon rule violations', () => {
    const issues = auditLabSection('Cr 0.72 → 0.78');
    expect(issues.some((s) => /Unicode arrow/.test(s))).toBe(true);
  });
});
