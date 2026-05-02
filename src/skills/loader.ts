/**
 * Runtime skill loader. Fetches skill markdown / JSON from public/skills/
 * and caches. Each skill directory contains SKILL.md plus optional reference
 * files (markdown narrative or structured JSON). The loader fetches them in
 * the order listed in SKILL_FILES and concatenates with `---` dividers so
 * the model sees one combined skill document.
 *
 * Keep SKILL_FILES in sync with `scripts/sync-skills.mjs` — both files
 * declare which files per skill are runtime-relevant. Files in the source
 * skill folder that aren't listed here are NOT bundled (e.g. azma-ui's
 * `slide_art/` directory and `manifest.json` are decorative / verification-
 * only and would just bloat the bundle).
 */

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

const cache = new Map<string, string>();

export type SkillName =
  | 'azma-ui'
  | 'szmc-clinical-notes'
  | 'szmc-interesting-cases'
  | 'hebrew-medical-glossary'
  | 'geriatrics-knowledge';

// Additional files per skill beyond SKILL.md.
// Keep in sync with sync-skills.mjs.
//   azma-ui (R4): SKILL.md is short; AZMA_REFERENCE.md has the column/icon
//     lookup; azma_reference.json has structured manifest-grade data the
//     model can match against literal Hebrew strings in screenshots.
//     slide_art/ + manifest.json are intentionally excluded — decorative or
//     verification-only.
//   geriatrics-knowledge: just SKILL.md (the inline tables in it are the
//     reachable content from this runtime; project_knowledge_search isn't
//     available here so we patch the trigger instruction at sync time).
const SKILL_FILES: Record<SkillName, string[]> = {
  'azma-ui': ['SKILL.md', 'AZMA_REFERENCE.md', 'azma_reference.json'],
  'szmc-clinical-notes': ['SKILL.md'],
  'szmc-interesting-cases': ['SKILL.md'],
  'hebrew-medical-glossary': ['SKILL.md'],
  'geriatrics-knowledge': ['SKILL.md'],
};

async function fetchIfExists(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function loadSkill(name: SkillName): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;
  const files = SKILL_FILES[name];
  const parts: string[] = [];
  for (const f of files) {
    const body = await fetchIfExists(`${BASE}skills/${name}/${f}`);
    if (body) parts.push(body);
  }
  if (parts.length === 0) throw new Error(`skill ${name} not found`);
  const combined = parts.join('\n\n---\n\n');
  cache.set(name, combined);
  return combined;
}

export async function loadSkills(names: SkillName[]): Promise<string> {
  const parts = await Promise.all(names.map(loadSkill));
  return parts.join('\n\n===\n\n');
}

export function clearSkillCache(): void {
  cache.clear();
}
