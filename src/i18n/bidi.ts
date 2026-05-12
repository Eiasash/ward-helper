/**
 * Bidi + Chameleon sanitization layer.
 *
 * The agent is told (via the skill) not to emit forbidden chars, but models
 * slip up. This module is the LAST line of defense before the clipboard:
 * every string that gets copy-pasted into Chameleon flows through
 * `wrapForChameleon`, which first `sanitizeForChameleon`s then applies
 * bidi marks. Keep these rules in sync with
 * public/skills/szmc-clinical-notes/SKILL.md §"CHAMELEON EMR PASTE RULES".
 *
 * 2026-04-28 update: lab-section trends should now use PROSE
 * ("בקבלה X, במהלך Y, בשחרור Z") not ">" arrows. The ">" character is still
 * allowed for medication dose tapers (e.g. "Lantus 22 > 10-12"). The sanitizer
 * cannot reliably distinguish lab-trend ">" from med-taper ">" without
 * full-document parsing, so it leaves ">" alone — but `auditChameleonRules`
 * flags suspicious "N > N" numeric patterns as a dev warning.
 */

import { HEBREW_RE, LATIN_RE, BIDI_MARKS_RE, RLM, LRM } from './bidiMarks.mjs';

export { BIDI_MARKS_RE };

export function detectDir(s: string): 'rtl' | 'ltr' | 'neutral' {
  if (HEBREW_RE.test(s)) return 'rtl';
  if (LATIN_RE.test(s)) return 'ltr';
  return 'neutral';
}

/**
 * Strip / replace characters and patterns that Chameleon renders incorrectly.
 * Safe to call on any string. Deterministic; idempotent.
 */
export function sanitizeForChameleon(text: string): string {
  let s = text;

  // 1. Unicode arrows corrupt to "?" in Chameleon. Replace with " > "
  //    (right-pointing semantic) or Hebrew verbiage.
  s = s.replace(/\s*→\s*/g, ' > ');
  s = s.replace(/\s*←\s*/g, ' > '); // in a Hebrew trend string "→" and "←" both mean "progressed to"
  s = s.replace(/\s*↑\s*/g, ' עלייה ל-');
  s = s.replace(/\s*↓\s*/g, ' ירידה ל-');
  // `=>` is a common asciified arrow — normalize.
  s = s.replace(/\s*=>\s*/g, ' > ');

  // 2. Bold / emphasis markers render literally.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');

  // 3. Double-dash dividers render as encoding artifacts.
  s = s.replace(/(?<!-)--(?!-)/g, '-');
  s = s.replace(/^-{3,}$/gm, ''); // horizontal rules on their own line -> drop

  // 4. Multiple > collapse to single.
  s = s.replace(/>{2,}/g, '>');

  // 4b. "Greater/less than or equal" compound operators.
  //     These MUST run before rule 5 (>N / <N comparison spell-out),
  //     because rule 5's regex would otherwise see ">" and mangle them.
  //     Hebrew readers typically write/read these as "גדול שווה" etc., but
  //     the spelled-out words render cleanest in Chameleon.
  s = s.replace(/>=/g, 'גדול-שווה ');
  s = s.replace(/<=/g, 'קטן-שווה ');
  s = s.replace(/≥\s*/g, 'גדול-שווה ');
  s = s.replace(/≤\s*/g, 'קטן-שווה ');

  // 5. ">N" / "<N" flip in RTL — must be spelled out when N is a number
  //    comparison. Two exclusions:
  //      a) " > " transition syntax (spaces already around >) — excluded
  //         by rule 5's own pattern below.
  //      b) A digit IMMEDIATELY before the operator — that's also a
  //         transition ("2.1>1.8" means 2.1 transitioned to 1.8, not
  //         "2.1 is greater-than 1.8"). Use negative lookbehind to skip.
  //    Space-wrapped transitions (Cr: 2.1 > 1.8) are also preserved
  //    because `>(\d)` requires no whitespace between > and the digit.
  s = s.replace(/(?<![\d.])>(\d)/g, 'מעל $1');
  s = s.replace(/(?<![\d.])<(\d)/g, 'מתחת $1');

  // 6. English drug-schedule abbreviations confuse RTL readers.
  s = s.replace(/\bq(\d{1,2})h\b/gi, 'כל $1 שעות');
  s = s.replace(/\bqd\b/gi, 'פעם ביום');
  s = s.replace(/\bbid\b/gi, 'פעמיים ביום');
  s = s.replace(/\btid\b/gi, '3 פעמים ביום');
  s = s.replace(/\bqid\b/gi, '4 פעמים ביום');
  s = s.replace(/\bqhs\b/gi, 'לפני שינה');
  s = s.replace(/\bq(\d{1,2})\s*(hrs?|hours?)\b/gi, 'כל $1 שעות');

  // 7. Trailing "?" after a Hebrew word ending a line looks like an
  //    encoding error to Chameleon readers. Drop it.
  s = s.replace(/([\u0590-\u05FF])\?$/gm, '$1');

  // 8. Collapse runs of blank lines.
  s = s.replace(/\n{3,}/g, '\n\n');

  // 9. Trim trailing whitespace on each line.
  s = s.replace(/[ \t]+$/gm, '');

  return s;
}

/**
 * Lab-section-specific sanitizer. Stricter than `sanitizeForChameleon`:
 * also strips ALL `>` arrows (even space-padded transitions), and converts
 * H/L lab printout suffixes to Hebrew parens. Use this on the מעבדה
 * paste field specifically, since Chameleon's lab field is more fragile
 * than its narrative field.
 *
 * Verified 2026-04-28 (Bloch discharge calibration): the lab paste field
 * mangles `>` arrow chains; ditto Latin-1 H/L suffixes that get carried
 * over from the lab printout. Defense-in-depth catches model slips even
 * when the prompt says "no arrows".
 */
export function sanitizeLabSection(text: string): string {
  // First apply the general sanitizer (arrows, **, --, qNh, etc.)
  let s = sanitizeForChameleon(text);

  // 1. ANY remaining ">" between lab values (even space-padded) becomes
  //    Hebrew prose connector. Pattern: "<param/value> > <next>" → ", "
  //    Conservative: only strip > when it's surrounded by whitespace AND
  //    not a comparison (already handled). The general sanitizer left
  //    these alone (rule 5 only spells out >N comparisons).
  s = s.replace(/\s+>\s+/g, ', ');

  // 2. H / L lab printout suffixes — strip and convert to Hebrew parens.
  //    Matches "11.3 H" or "3.0 L" (number, optional space, H or L,
  //    word boundary). Case-sensitive on purpose (Hebrew text contains
  //    no Latin H/L).
  s = s.replace(/(\d+(?:\.\d+)?)\s+H\b/g, '$1 (מעל הנורמה)');
  s = s.replace(/(\d+(?:\.\d+)?)\s+L\b/g, '$1 (מתחת לנורמה)');
  // Same with no space (some printouts emit "11.3H").
  s = s.replace(/(\d+(?:\.\d+)?)H\b/g, '$1 (מעל הנורמה)');
  s = s.replace(/(\d+(?:\.\d+)?)L\b/g, '$1 (מתחת לנורמה)');
  // "L!" / "H!" critical-flag suffix — same handling.
  s = s.replace(/(\d+(?:\.\d+)?)\s*[HL]!/g, (_, num, off, str) =>
    `${num} ${str.includes('H') ? '(מעל הנורמה, חריג)' : '(מתחת לנורמה, חריג)'}`,
  );

  return s;
}

/**
 * Calculate corrected calcium when total Ca is reported alongside same-day
 * albumin. Hypoalbuminemia falsely lowers measured total Ca; correction
 * adjusts to a normal-albumin equivalent.
 *
 *   Corrected Ca = measured Ca + 0.8 × (4.0 − albumin)
 *
 * Returns the corrected value rounded to 1 decimal. Returns the original
 * Ca unchanged if albumin is null/undefined or already ≥4.0 (no
 * correction needed). Ionized Ca needs no correction — don't pass it
 * through this function.
 *
 * Eias 2026-04-28: matters clinically because Bloch case had Ca 11.2 with
 * albumin 3.0 → corrected 12.0. Raw Ca looked stable, corrected showed
 * worsening hypercalcemia.
 */
export function correctedCalcium(
  totalCa: number,
  albumin: number | null | undefined,
): number {
  if (albumin == null || albumin >= 4.0) return totalCa;
  const corrected = totalCa + 0.8 * (4.0 - albumin);
  return Math.round(corrected * 10) / 10;
}

/**
 * Walk a string by character class and insert directional marks at every
 * Hebrew\u2194Latin transition.
 *
 * 2026-05-12 (workstream a) \u2014 Replaces the prior `wrapForChameleon` Rule A
 * (`(Latin-only)` \u2192 `(LRM Latin LRM)`) and Rule B (Latin run + Western
 * punctuation \u2192 RLM before punct). Those two narrow patches missed the
 * dominant case in clinical content: a Latin run followed by a SPACE
 * then Hebrew (e.g., "ENOXAPARIN 20mg SC \u05E4\u05E2\u05DD \u05D1\u05D9\u05D5\u05DD"). The DVT prophylaxis
 * defect surfaced by the bot's no-bidi detector on 2026-05-12 was a live
 * case of this gap \u2014 manual repro confirmed zero bidi markers on the
 * clipboard, 5 ward-helper clipboard paths affected.
 *
 * Algorithm: classify each character as Hebrew / Latin / neutral. Hebrew
 * = U+0590..U+05FF (strong RTL). Latin = ASCII letters only (strong LTR).
 * Digits are bidi-WEAK per UAX-9 rule W2 and inherit the run direction,
 * so they classify as neutral \u2014 this preserves the `'\u05d2\u05d9\u05dc 92'` constraint
 * (Hebrew text with embedded digits but no Latin letters needs no marks).
 * Neutral = everything else (spaces, punctuation, parens, digits). On a
 * transition between Hebrew and Latin (whether or not separated by
 * neutrals), insert the appropriate mark BEFORE the new-direction
 * character: RLM if entering Hebrew, LRM if entering Latin. Neutrals
 * carry forward the prior class so transitions over whitespace and
 * digit-runs are still detected.
 *
 * Idempotent: existing direction marks classify as their direction-
 * equivalent class (RLM \u2192 hebrew, LRM \u2192 latin) for prev-state tracking,
 * but we skip mark INSERTION before any direction-mark character. Without
 * that skip, re-wrapping `'SC \u200f\u05e4\u05e2\u05dd'` would emit a second RLM before the
 * existing one and duplicate markers would accumulate on every pass.
 *
 * Marker constants are parameterized via `options`. Default RLM/LRM is
 * known-good in the legacy Chameleon EMR (Rule A and B emitted these
 * in production through 2026-05-12). An FSI/PDI isolates mode is
 * intentionally NOT implemented here \u2014 Chameleon's rendering of
 * U+2068/U+2069 hasn't been manually verified; if it strips them or
 * renders them as glyphs the "fix" would make paste worse than the bug.
 * Migration path: add an isolates mode behind an explicit option,
 * verify in Chameleon paste flow, then flip the default.
 *
 * @param text input string
 * @param options.rlm right-to-left mark (default U+200F)
 * @param options.lrm left-to-right mark (default U+200E)
 * @returns text with marks inserted at Hebrew\u2194Latin transitions
 */
export function bidiWrap(
  text: string,
  options: { rlm?: string; lrm?: string } = {},
): string {
  if (!text || text.length === 0) return text;
  const rlm = options.rlm ?? RLM;
  const lrm = options.lrm ?? LRM;

  // Strong-direction codepoints. Latin = ASCII letters only; digits are
  // bidi-WEAK per UAX-9 (rule W2) and inherit the run direction, so we
  // treat them as neutral here. That matches the `'\u05D2\u05D9\u05DC 92'` no-marker
  // contract enforced by tests/r2-deeper-dig.test.ts:204.
  //
  // Existing direction marks are classified as their direction-equivalent
  // class so a previously-wrapped string's prev state is preserved across
  // them \u2014 BUT we additionally skip mark INSERTION before any direction
  // mark character (see isDirMark below). Without that skip, re-wrapping
  // `'SC \u200F\u05E4\u05E2\u05DD'` would emit a second RLM before the existing one and
  // accumulate duplicates on every pass.
  //
  // RLM (U+200F) + ALM (U+061C) + RLI (U+2067) \u2192 'hebrew' (strongly RTL).
  // LRM (U+200E) + LRI (U+2066) \u2192 'latin' (strongly LTR).
  // FSI (U+2068) and PDI (U+2069) stay neutral; FSI's resolved direction
  // depends on its first strong character and PDI is a closer.
  type Klass = 'hebrew' | 'latin' | 'neutral';
  function classify(ch: string): Klass {
    if (/[\u0590-\u05FF\u200F\u061C\u2067]/.test(ch)) return 'hebrew';
    if (/[A-Za-z\u200E\u2066]/.test(ch)) return 'latin';
    return 'neutral';
  }
  const DIR_MARK_RE = /[\u200E\u200F\u061C\u2066\u2067\u2068\u2069]/;

  let out = '';
  let prev: Klass = 'neutral';
  for (const ch of text) {
    const klass = classify(ch);
    if (klass !== 'neutral' && prev !== 'neutral' && klass !== prev && !DIR_MARK_RE.test(ch)) {
      out += klass === 'hebrew' ? rlm : lrm;
    }
    out += ch;
    if (klass !== 'neutral') prev = klass;
  }
  return out;
}

/**
 * Full clipboard-boundary transform: sanitize, then insert directional marks.
 */
export function wrapForChameleon(text: string): string {
  return bidiWrap(sanitizeForChameleon(text));
}

/** Assert no unbalanced directional isolate marks (LRI/RLI/FSI vs PDI). */
export function lintBidi(s: string): string[] {
  const errors: string[] = [];
  const opens = (s.match(/[\u2066\u2067\u2068]/g) ?? []).length;
  const closes = (s.match(/[\u2069]/g) ?? []).length;
  if (opens !== closes) errors.push(`unbalanced isolates: ${opens} open vs ${closes} close`);
  return errors;
}

/**
 * Audit a note for Chameleon rule violations. Returns a human-readable list.
 * Empty array means the note is clean. Useful for tests + optional dev-time
 * banner.
 */
export function auditChameleonRules(text: string): string[] {
  const issues: string[] = [];
  if (/[→←↑↓]/.test(text)) issues.push('Unicode arrow found (corrupts in Chameleon)');
  if (/\*\*[^*]+\*\*/.test(text)) issues.push('** bold markers found');
  if (/(?<!-)--(?!-)/.test(text)) issues.push('-- double dash found');
  if (/>{2,}/.test(text)) issues.push('>> multiple > found');
  if (/[>=≥≤<]=|≥|≤/.test(text))
    issues.push('>=, <=, ≥, or ≤ found (spell out in Hebrew)');
  if (/(?<![\d.])>\d/.test(text)) issues.push('">N" comparison found (should be "מעל N")');
  if (/(?<![\d.])<\d/.test(text)) issues.push('"<N" comparison found (should be "מתחת N")');
  if (/\bq\d{1,2}h\b/i.test(text)) issues.push('qNh frequency found (use Hebrew)');
  if (/\b(bid|tid|qid|qd)\b/i.test(text)) issues.push('BID/TID/QID/QD found (use Hebrew)');

  // 2026-04-28: lab-section style guards.
  // Numeric trend pattern "N > M" or "N > M > P" — lab trends should now be
  // prose ("בקבלה X, במהלך Y, בשחרור Z"), not arrow-style. This is a STYLE
  // warning (the sanitizer leaves > alone because med tapers still use it),
  // surfaced for dev visibility / pre-commit.
  if (/\d+(?:\.\d+)?\s*>\s*\d+(?:\.\d+)?(?:\s*>\s*\d+(?:\.\d+)?)*/.test(text)) {
    issues.push('Numeric arrow trend "N > M" found — lab sections should use prose ("בקבלה X, במהלך Y, בשחרור Z")');
  }
  // "L"/"H" suffix immediately after a lab number (e.g. "Ca 11.3 H") — should
  // be parenthetical Hebrew "(מעל הנורמה)" / "(מתחת לנורמה)".
  if (/\d+(?:\.\d+)?\s+[LH]\b/.test(text)) {
    issues.push('"N L" or "N H" suffix found — use "(מעל/מתחת לנורמה)" parenthetical');
  }
  return issues;
}

/**
 * Audit a lab-section paste field specifically. Stricter than the general
 * `auditChameleonRules`: flags space-padded `>` as an arrow violation
 * (the lab field corrupts even with proper spacing) and emits messages
 * scoped to the lab context. Useful when the caller knows the text is
 * destined for the מעבדה paste field.
 *
 * 2026-04-28: extracted as a dedicated function to avoid false positives
 * on legitimate med-taper `>` syntax in narrative sections.
 */
export function auditLabSection(text: string): string[] {
  const issues = auditChameleonRules(text);
  // Stricter: any " > " between alphanumeric tokens flags as an arrow
  // violation in lab context (Chameleon's lab field is more fragile).
  if (/\S\s+>\s+\S/.test(text) && !issues.some((s) => /arrow found in lab section/.test(s))) {
    issues.push('">" arrow found in lab section — use prose ("בקבלה X, במהלך Y, בשחרור Z")');
  }
  // Compact "11.3H" / "3.0L" without space (common in lab printouts).
  if (/\d(?:\.\d+)?[HL]\b/.test(text) && !issues.some((s) => /H\/L suffix/.test(s))) {
    issues.push('lab H/L suffix (no space) found — use "(מעל/מתחת לנורמה)" parens');
  }
  // The general audit's "N L" / "N H" message is fine, but rephrase for
  // lab-section context if the test caller looks for "H/L suffix".
  return issues.map((s) =>
    /N L" or "N H" suffix/.test(s)
      ? 'lab H/L suffix found — use "(מעל/מתחת לנורמה)" parens'
      : s,
  );
}
