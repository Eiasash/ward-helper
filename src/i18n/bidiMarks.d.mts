/**
 * Type declarations for bidiMarks.mjs. The runtime module is plain ESM so
 * both the Vite/TypeScript app and the Node/bot scripts (scripts/lib/*.mjs)
 * can import it without TS compilation; this .d.mts ships the types for
 * the TS-side callers.
 *
 * Extension MUST be .d.mts (not .d.ts) — tsconfig resolves declaration
 * files by exact extension match against the source file's extension.
 */

export const LRM: string;
export const RLM: string;
export const ALM: string;
export const LRI: string;
export const RLI: string;
export const FSI: string;
export const PDI: string;
export const BIDI_MARKS_RE: RegExp;
export const HEBREW_RE: RegExp;
export const LATIN_RE: RegExp;
