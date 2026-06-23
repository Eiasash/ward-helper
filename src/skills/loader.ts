/**
 * Runtime skill loader. Fetches skill markdown / JSON from public/skills/
 * and caches. Each skill directory contains SKILL.md plus optional reference
 * files (markdown narrative or structured JSON). The loader fetches the
 * files whose `when(ctx)` predicate matches the current LoadContext and
 * concatenates them with `---` dividers so the model sees one combined skill
 * document.
 *
 * Conditional-load gate (runtime-enforced, 2026-06):
 *   Each entry in SKILL_FILES is a `{ name, when? }` unit. `when(ctx)` is a
 *   predicate over the LoadContext (note type + isRehab). A unit with no
 *   `when` always loads; a unit whose `when` returns false is SKIPPED before
 *   the network fetch — so e.g. the ~48 KB REHAB_NOTES.md never reaches the
 *   model prompt on a non-rehab note. This replaces the old "prompt-text only"
 *   gate (a promise) with a real runtime predicate (enforced).
 *
 *   Cache key is SET-BASED: keyed on the skill name PLUS the sorted set of
 *   file names actually loaded for a ctx. Two contexts that resolve to the
 *   same load set share one entry (same content); two contexts that resolve
 *   to DIFFERENT load sets get DISTINCT entries and cannot serve each other's
 *   set. (The old name-only key could have served the wrong set once the load
 *   became ctx-dependent.)
 *
 * `SKILL_FILES` here governs runtime LOADING (gated). `scripts/sync-skills.mjs`
 * governs which files are COPIED into public/skills/ at build (ungated — it
 * copies every runtime-relevant file so the gated units are on disk to fetch).
 * The two lists name the same files; only this one carries load predicates.
 * azma-ui's `slide_art/` + `manifest.json` are excluded from both (decorative /
 * verification-only).
 */

import type { NoteType } from '@/storage/indexed';

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

const cache = new Map<string, string>();

export type SkillName =
  | 'azma-ui'
  | 'szmc-clinical-notes'
  | 'szmc-interesting-cases'
  | 'hebrew-medical-glossary'
  | 'geriatrics-knowledge';

/**
 * Context the load gate evaluates. Threaded from `generateNote`
 * (orchestrate.ts) → `loadSkills` → `loadSkill`. Optional so non-note
 * callers (e.g. census/batch extract) can load ungated.
 */
export interface LoadContext {
  noteType?: NoteType;
  /** Rehab-ward context — derived from the room via soapMode.isRehabRoom. */
  isRehab?: boolean;
}

interface SkillFile {
  name: string;
  /**
   * Load predicate. Absent → always load. When a LoadContext is provided,
   * `when(ctx)` decides; when no ctx is provided at all, predicates are
   * skipped and every file loads (back-compat for ungated callers).
   */
  when?: (ctx: LoadContext) => boolean;
}

// Note types that can legitimately be a rehab note (rehab admission, rehab
// daily round = SOAP, rehab discharge, and a geriatric consult on a rehab-ward
// patient). REHAB_NOTES.md is relevant only for these; case/census never
// load it. The note-type clause is defensive — the load still requires
// isRehab, so the ward signal is the real gate.
const REHAB_NOTE_TYPES: ReadonlySet<NoteType> = new Set<NoteType>([
  'admission',
  'discharge',
  'consult',
  'soap',
]);

// Note types that need the full szmc-clinical-notes SKILL.md templates
// (admission/discharge/consult printed-output orders). NOT soap — adding
// szmc-clinical-notes to NOTE_SKILL_MAP.soap (so REHAB_NOTES.md is reachable
// on rehab rounds) must NOT drag the admission/discharge/consult templates
// into round notes, so SKILL.md is gated off for soap here.
const FULL_TEMPLATE_NOTE_TYPES: ReadonlySet<NoteType> = new Set<NoteType>([
  'admission',
  'discharge',
  'consult',
]);

// Additional files per skill beyond SKILL.md, with their load predicates.
// Keep the FILE SET in sync with sync-skills.mjs (which copies them, ungated).
//   azma-ui (R4): SKILL.md + AZMA_REFERENCE.md + azma_reference.json — all
//     always-load (no clinical-note gate applies to census/extract).
//   szmc-clinical-notes: SKILL.md for the full-template note types;
//     REHAB_NOTES.md only for a rehab note (isRehab) of a rehab-capable type.
//     CHANGELOG.md is intentionally NOT a runtime unit — dev history, copied
//     to disk by sync-skills.mjs but never loaded into the prompt.
//   geriatrics-knowledge: just SKILL.md.
const SKILL_FILES: Record<SkillName, SkillFile[]> = {
  'azma-ui': [
    { name: 'SKILL.md' },
    { name: 'AZMA_REFERENCE.md' },
    { name: 'azma_reference.json' },
  ],
  'szmc-clinical-notes': [
    {
      name: 'SKILL.md',
      when: (ctx) => ctx.noteType === undefined || FULL_TEMPLATE_NOTE_TYPES.has(ctx.noteType),
    },
    {
      name: 'REHAB_NOTES.md',
      when: (ctx) =>
        ctx.isRehab === true &&
        (ctx.noteType === undefined || REHAB_NOTE_TYPES.has(ctx.noteType)),
    },
  ],
  'szmc-interesting-cases': [{ name: 'SKILL.md' }],
  'hebrew-medical-glossary': [{ name: 'SKILL.md' }],
  'geriatrics-knowledge': [{ name: 'SKILL.md' }],
};

/** Resolve the file units that load for this ctx (predicate evaluation). */
function resolveFiles(name: SkillName, ctx: LoadContext | undefined): string[] {
  const units = SKILL_FILES[name];
  // Missing ctx → evaluate predicates against an EMPTY context, NOT "load
  // all". A gated unit (e.g. REHAB_NOTES.md, which requires isRehab===true)
  // must never load just because a caller omitted context — that would
  // regress the cost/budget guarantee at contextless call sites (now that
  // NOTE_SKILL_MAP.soap includes szmc-clinical-notes). Ungated units (no
  // `when`) still always load.
  const c = ctx ?? {};
  return units.filter((u) => !u.when || u.when(c)).map((u) => u.name);
}

/** Set-based cache key: skill name + the sorted set of loaded file names. */
function cacheKeyFor(name: SkillName, files: string[]): string {
  return `${name}::${[...files].sort().join(',')}`;
}

async function fetchIfExists(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Load a skill for the given context. Returns the concatenated content of the
 * file units whose predicate matches `ctx`. Returns '' when NO unit matches
 * (the skill legitimately contributes nothing for this ctx — e.g.
 * szmc-clinical-notes on a general SOAP); callers should treat '' as
 * "no contribution", not an error. Throws only when units were expected but
 * every fetch failed (a genuine missing-bundle error).
 */
export async function loadSkill(name: SkillName, ctx?: LoadContext): Promise<string> {
  const files = resolveFiles(name, ctx);
  const key = cacheKeyFor(name, files);
  if (cache.has(key)) return cache.get(key)!;

  // No unit matched this ctx → intentional empty contribution. Cache it.
  if (files.length === 0) {
    cache.set(key, '');
    return '';
  }

  const parts: string[] = [];
  for (const f of files) {
    const body = await fetchIfExists(`${BASE}skills/${name}/${f}`);
    if (body) parts.push(body);
  }
  if (parts.length === 0) throw new Error(`skill ${name} not found`);
  const combined = parts.join('\n\n---\n\n');
  cache.set(key, combined);
  return combined;
}

export async function loadSkills(names: SkillName[], ctx?: LoadContext): Promise<string> {
  const parts = await Promise.all(names.map((n) => loadSkill(n, ctx)));
  // Drop empty contributions so a skill that gated to nothing for this ctx
  // doesn't inject a stray '===' separator.
  return parts.filter((p) => p.length > 0).join('\n\n===\n\n');
}

export function clearSkillCache(): void {
  cache.clear();
}
