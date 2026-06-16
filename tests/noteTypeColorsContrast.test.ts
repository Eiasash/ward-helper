/**
 * WCAG-AA contrast guard for the per-note-type accent colors.
 *
 * `NOTE_TYPE_COLORS[*].color` doubles as the *active* note-type button
 * background, paired with white text (`color: 'white'` in
 * src/ui/screens/Capture.tsx). Each value must therefore clear WCAG AA for
 * normal text (≥ 4.5:1) against #fff.
 *
 * History: the `soap` token shipped as #14919B with a comment claiming
 * "4.59:1 on white". The real relative-luminance ratio is 3.78:1 — sub-AA.
 * Fixed to #0f766e (teal-700, 5.47:1) and pinned here so a future restyle
 * can't silently regress it.
 *
 * Unlike tests/a11yContrast2026-05-10.test.ts (which string-matches CSS
 * mitigations), this is the *runtime* layer of the invariant triad
 * [[feedback_invariant_triad]]: it imports the actual token object and
 * computes the ratio from first principles, so the assertion tracks the
 * value the UI really renders rather than a literal in a comment.
 *
 * These are plain sRGB hex values, so a straightforward WCAG relative-
 * luminance ratio is sufficient — no oklch()/canvas resolver needed (the
 * Tailwind-4 oklch blind spot in [[feedback_oklch_contrast_detector_blindspot]]
 * does not apply here; if any token ever moves to oklch(), switch to a
 * canvas-based resolver before trusting this math).
 */
import { describe, it, expect } from 'vitest';
import { NOTE_TYPE_COLORS } from '@/notes/noteTypeColors';

/** WCAG 2.x relative luminance of an sRGB hex color (#rrggbb). */
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two sRGB hex colors (1..21). */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';
const AA_NORMAL_TEXT = 4.5;

describe('note-type accent contrast (button background vs white text)', () => {
  it('sanity-checks the luminance helper against a known WCAG value', () => {
    // Pure black on white is exactly 21:1 by definition.
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 5);
  });

  it('every note-type accent clears AA (>= 4.5:1) against white text', () => {
    for (const [type, tone] of Object.entries(NOTE_TYPE_COLORS)) {
      const ratio = contrastRatio(tone.color, WHITE);
      expect(
        ratio,
        `${type} (${tone.color}) is ${ratio.toFixed(2)}:1 on white — below AA ${AA_NORMAL_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it('soap accent is the fixed teal-700 value, not the sub-AA #14919B', () => {
    expect(NOTE_TYPE_COLORS.soap.color.toLowerCase()).toBe('#0f766e');
    // Lock the measured ratio so the comment can't drift from reality again.
    const ratio = contrastRatio(NOTE_TYPE_COLORS.soap.color, WHITE);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(ratio).toBeCloseTo(5.47, 2);
    // The retired value must stay retired (it measured 3.78:1, sub-AA).
    expect(NOTE_TYPE_COLORS.soap.color.toLowerCase()).not.toBe('#14919b');
  });
});
