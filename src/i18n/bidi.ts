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
 * Insert RLM after English runs that end a Hebrew sentence with punctuation,
 * and wrap parenthesized Latin-only content with LRM on both sides.
 * Applied only at the clipboard boundary before paste into Chameleon.
 */
export function wrapForChameleon(text: string): string {
  // Rule 1: (Latin-only content) -> (LRM Latin-only content LRM)
  let out = text.replace(/\(([^()\u0590-\u05FF]+)\)/g, (_, inner) => `(${LRM}${inner}${LRM})`);
  // Rule 2: English run followed by Western punctuation -> RLM before the punct
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
