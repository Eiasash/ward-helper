/**
 * Single source of truth for Unicode bidi-marker codepoints used across
 * ward-helper. Cross-runtime: imported by both `src/i18n/bidi.ts` (Vite/app)
 * and `scripts/lib/megaPersona.mjs` (Node/bot). Plain .mjs so both runtimes
 * resolve it without TypeScript compilation.
 *
 * 2026-05-12 — extracted as part of workstream (a)+(b) coupled landing in
 * STAGE3_GATES_2026-05-11.md. Keeps the app-side wrap mechanism and the
 * bot-side detector in lockstep — if either drifts the unit test in
 * tests/bidi.test.ts catches it.
 *
 * The set covers ALL seven UAX-9 directional formatting characters
 * (https://www.unicode.org/reports/tr9/), forward-compatible with any
 * future migration of `wrapForChameleon` to FSI/PDI isolates. The
 * canonical wrap currently emits only RLM/LRM for known-good rendering
 * in the Chameleon legacy EMR (FSI/PDI is Unicode-6.3-era and not yet
 * paste-verified there). Recognizing more than we emit prevents the
 * detector from regressing the moment the wrap broadens.
 */

/** U+200E LEFT-TO-RIGHT MARK */
export const LRM = '‎';
/** U+200F RIGHT-TO-LEFT MARK */
export const RLM = '‏';
/** U+061C ARABIC LETTER MARK */
export const ALM = '؜';
/** U+2066 LEFT-TO-RIGHT ISOLATE */
export const LRI = '⁦';
/** U+2067 RIGHT-TO-LEFT ISOLATE */
export const RLI = '⁧';
/** U+2068 FIRST STRONG ISOLATE */
export const FSI = '⁨';
/** U+2069 POP DIRECTIONAL ISOLATE */
export const PDI = '⁩';

/**
 * Regex matching any of the seven UAX-9 directional formatting characters.
 * Use for "does this text already contain bidi markers?" checks. NOT a
 * validator (doesn't enforce balanced isolates — see `lintBidi` for that).
 */
export const BIDI_MARKS_RE = /[‎‏؜⁦⁧⁨⁩]/;

/**
 * Hebrew character range used for direction-class detection.
 * Hebrew block: U+0590..U+05FF.
 */
export const HEBREW_RE = /[֐-׿]/;

/**
 * Latin letter range used for direction-class detection. ASCII letters
 * only — digits are bidi-WEAK per UAX-9 rule W2 and inherit the run
 * direction, so they are NOT included here. Includes digits would
 * misclassify pure-digit strings ("12345", "09/06/26") as 'ltr' when
 * UAX-9 says they're direction-neutral and inherit context.
 */
export const LATIN_RE = /[A-Za-z]/;
