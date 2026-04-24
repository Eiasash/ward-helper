/**
 * Bidi + Chameleon sanitization layer.
 *
 * The agent is told (via the skill) not to emit forbidden chars, but models
 * slip up. This module is the LAST line of defense before the clipboard:
 * every string that gets copy-pasted into Chameleon flows through
 * `wrapForChameleon`, which first `sanitizeForChameleon`s then applies
 * bidi marks. Keep these rules in sync with
 * public/skills/szmc-clinical-notes/SKILL.md §"CHAMELEON EMR PASTE RULES".
 */

const HEBREW_RE = /[\u0590-\u05FF]/;
const LATIN_RE = /[A-Za-z]/;
const RLM = '\u200F';
const LRM = '\u200E';

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
 * Full clipboard-boundary transform: sanitize, then insert directional marks.
 */
export function wrapForChameleon(text: string): string {
  let out = sanitizeForChameleon(text);
  // Rule A: (Latin-only content) -> (LRM Latin-only content LRM)
  out = out.replace(/\(([^()\u0590-\u05FF]+)\)/g, (_, inner) => `(${LRM}${inner}${LRM})`);
  // Rule B: English run followed by Western punctuation -> RLM before the punct
  out = out.replace(/([A-Za-z][A-Za-z0-9 +\-/]{2,})([.,:;])/g, `$1${RLM}$2`);
  return out;
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
  return issues;
}
