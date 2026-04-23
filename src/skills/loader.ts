/**
 * Runtime skill loader. Fetches skill markdown from public/skills/ and caches.
 * Each skill directory contains SKILL.md plus optional reference markdown files.
 * The loader fetches SKILL.md first, then any additional .md files listed in
 * SKILL_FILES below (maintained alongside sync-skills.mjs).
 */

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

const cache = new Map<string, string>();

export type SkillName =
  | 'azma-ui'
  | 'szmc-clinical-notes'
  | 'szmc-interesting-cases'
  | 'hebrew-medical-glossary';

// Additional files per skill beyond SKILL.md.
// Keep in sync with sync-skills.mjs — azma-ui in particular references AZMA_REFERENCE.md.
const SKILL_FILES: Record<SkillName, string[]> = {
  'azma-ui': ['SKILL.md', 'AZMA_REFERENCE.md'],
  'szmc-clinical-notes': ['SKILL.md'],
  'szmc-interesting-cases': ['SKILL.md'],
  'hebrew-medical-glossary': ['SKILL.md'],
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
