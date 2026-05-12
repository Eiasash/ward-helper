import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs bot script doesn't ship d.ts; vitest resolves at runtime.
import { detectUnmarkedBidiMix } from '../scripts/lib/megaPersona.mjs';

// 2026-05-12 — workstream (c) detector coverage expansion. Verifies the
// pure-function detection logic that the page-context clipboard
// interceptor (installed via ctx.addInitScript in runPersona) implements
// verbatim.
//
// 2026-05-12 update: workstream (b) shipped in PR #152 — the detector
// now imports BIDI_MARKS_RE from src/i18n/bidiMarks.mjs (single SoT)
// and recognizes all 7 UAX-9 directional marks (LRM/RLM/ALM + LRI/RLI/
// FSI/PDI). The "FSI/PDI not recognized" pin from the (c)→(a)+(b)
// sequencing era is now inverted.
//
// The page-side interceptor draws its regex sources from the SAME
// BIDI_MARKS_RE constant via regex.source serialization. Drift between
// the in-page interceptor and the exported helper is impossible by
// construction — both compile from the same string.

describe('detectUnmarkedBidiMix (workstream c — all 7 UAX-9 marks recognized after b shipped)', () => {
  it('matches Hebrew+Latin text without bidi markers (the defect class)', () => {
    expect(detectUnmarkedBidiMix('ENOXAPARIN 20mg SC פעם ביום (המודיאליזה) עד 09/06/26')).toBe(true);
    expect(detectUnmarkedBidiMix('Lasix 80mg IV פעם ביום')).toBe(true);
    expect(detectUnmarkedBidiMix('כתב יד SC')).toBe(true);
  });

  it('returns false for Latin-only text (no bidi ambiguity)', () => {
    expect(detectUnmarkedBidiMix('ENOXAPARIN 20mg SC')).toBe(false);
    expect(detectUnmarkedBidiMix('hello world')).toBe(false);
  });

  it('returns false for Hebrew-only text (no bidi ambiguity)', () => {
    expect(detectUnmarkedBidiMix('פעם ביום בערב')).toBe(false);
    expect(detectUnmarkedBidiMix('המודיאליזה')).toBe(false);
  });

  it('returns false when text has RLM (U+200F)', () => {
    expect(detectUnmarkedBidiMix('ENOXAPARIN‏ פעם ביום')).toBe(false);
    expect(detectUnmarkedBidiMix('Lasix‏ SC')).toBe(false);
  });

  it('returns false when text has LRM (U+200E)', () => {
    expect(detectUnmarkedBidiMix('פעם ‎SC')).toBe(false);
    expect(detectUnmarkedBidiMix('(‎ENOXAPARIN‎) פעם')).toBe(false);
  });

  it('returns false when text has FSI/PDI isolates (workstream b: pattern recognizes all 7 UAX-9 marks)', () => {
    // After (b) shipped, the detector recognizes all 7 UAX-9 directional
    // marks. FSI (U+2068) + PDI (U+2069) and LRI (U+2066) + RLI (U+2067)
    // count as valid bidi marking, even though wrapForChameleon doesn't
    // currently emit them. This forward-compatibility means a future
    // marker-policy flip won't silently false-positive this auditor.
    expect(detectUnmarkedBidiMix('⁨ENOXAPARIN⁩ פעם ביום')).toBe(false); // FSI…PDI
    expect(detectUnmarkedBidiMix('⁦SC⁩ פעם')).toBe(false); // LRI…PDI
    expect(detectUnmarkedBidiMix('⁧פעם⁩ SC')).toBe(false); // RLI…PDI
  });

  it('returns false when text has ALM (U+061C) — also recognized', () => {
    expect(detectUnmarkedBidiMix('ENOXAPARIN؜ פעם')).toBe(false);
  });

  it('returns false for empty / null / non-string inputs', () => {
    expect(detectUnmarkedBidiMix('')).toBe(false);
    expect(detectUnmarkedBidiMix(null)).toBe(false);
    expect(detectUnmarkedBidiMix(undefined)).toBe(false);
    expect(detectUnmarkedBidiMix(42)).toBe(false);
    expect(detectUnmarkedBidiMix({})).toBe(false);
    expect(detectUnmarkedBidiMix(['ENOXAPARIN', 'פעם'])).toBe(false);
  });

  it('handles text just at character class boundaries', () => {
    // U+0590 = HEBREW POINT SHEVA (first in Hebrew block per detector regex)
    // U+05FF = end of Hebrew block per detector regex
    expect(detectUnmarkedBidiMix('Aא')).toBe(true); // Latin + Hebrew Aleph
    expect(detectUnmarkedBidiMix('zת')).toBe(true); // Latin + Hebrew Tav
    // Non-Hebrew Unicode + Latin (should NOT match Hebrew)
    expect(detectUnmarkedBidiMix('A日本')).toBe(false);
  });
});
