import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSkill, loadSkills, clearSkillCache } from '@/skills/loader';

/**
 * Runtime conditional-load gate (loader.ts). REHAB_NOTES.md must load only
 * for a rehab note (isRehab) of a rehab-capable type, and must NOT bleed into
 * general admission/discharge/consult; the rehab daily round (SOAP) must reach
 * REHAB_NOTES.md WITHOUT pulling the szmc-clinical-notes SKILL.md templates.
 * Cache is set-based: distinct load sets get distinct entries (no cross-serve).
 */

const SKILL = 'SZMC-CLINICAL-NOTES SKILL BODY';
const REHAB = 'REHAB_NOTES BODY ### Rehab discharge';
const GLOSSARY = 'HEBREW GLOSSARY BODY';

const URLS: Record<string, string> = {
  '/skills/szmc-clinical-notes/SKILL.md': SKILL,
  '/skills/szmc-clinical-notes/REHAB_NOTES.md': REHAB,
  '/skills/hebrew-medical-glossary/SKILL.md': GLOSSARY,
};

function stubFetch(counter?: { n: number }) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (counter) counter.n++;
    const content = URLS[url];
    if (content == null) return { ok: false, text: async () => '' } as Response;
    return { ok: true, text: async () => content } as Response;
  });
}

beforeEach(() => {
  clearSkillCache();
  stubFetch();
});
afterEach(() => vi.restoreAllMocks());

describe('loader conditional-load gate — REHAB_NOTES.md', () => {
  it('rehab context loads REHAB_NOTES.md (admission/discharge/consult)', async () => {
    for (const noteType of ['admission', 'discharge', 'consult'] as const) {
      clearSkillCache();
      const out = await loadSkill('szmc-clinical-notes', { noteType, isRehab: true });
      expect(out, noteType).toContain(REHAB);
      expect(out, noteType).toContain(SKILL);
    }
  });

  it('non-rehab context does NOT load REHAB_NOTES.md (admission/discharge/consult)', async () => {
    for (const noteType of ['admission', 'discharge', 'consult'] as const) {
      clearSkillCache();
      const out = await loadSkill('szmc-clinical-notes', { noteType, isRehab: false });
      expect(out, noteType).toContain(SKILL);
      expect(out, noteType).not.toContain(REHAB);
    }
  });

  it('rehab daily round (SOAP) loads REHAB_NOTES.md but NOT the SKILL.md templates', async () => {
    const out = await loadSkill('szmc-clinical-notes', { noteType: 'soap', isRehab: true });
    expect(out).toContain(REHAB);
    expect(out).not.toContain(SKILL);
  });

  it('general SOAP loads nothing from szmc-clinical-notes (empty contribution)', async () => {
    const out = await loadSkill('szmc-clinical-notes', { noteType: 'soap', isRehab: false });
    expect(out).toBe('');
  });

  it('cache returns the correct load set per context — no cross-contamination', async () => {
    const general = await loadSkill('szmc-clinical-notes', { noteType: 'admission', isRehab: false });
    const rehab = await loadSkill('szmc-clinical-notes', { noteType: 'admission', isRehab: true });
    expect(general).not.toContain(REHAB);
    expect(rehab).toContain(REHAB);
    // Re-read the general ctx — must still be the general set, not the rehab one.
    const generalAgain = await loadSkill('szmc-clinical-notes', { noteType: 'admission', isRehab: false });
    expect(generalAgain).toBe(general);
    expect(generalAgain).not.toContain(REHAB);
  });

  it('distinct load sets get distinct cache entries; same set reuses cache', async () => {
    const counter = { n: 0 };
    stubFetch(counter);
    // rehab admission → SKILL + REHAB (2 fetches)
    await loadSkill('szmc-clinical-notes', { noteType: 'admission', isRehab: true });
    expect(counter.n).toBe(2);
    // same ctx → cache hit (0 more)
    await loadSkill('szmc-clinical-notes', { noteType: 'admission', isRehab: true });
    expect(counter.n).toBe(2);
    // different load set (general admission → SKILL only) → distinct entry, 1 fetch
    await loadSkill('szmc-clinical-notes', { noteType: 'admission', isRehab: false });
    expect(counter.n).toBe(3);
  });

  it('loadSkills (generateNote shape) — rehab SOAP gets glossary + REHAB, not SKILL', async () => {
    const out = await loadSkills(['hebrew-medical-glossary', 'szmc-clinical-notes'], {
      noteType: 'soap',
      isRehab: true,
    });
    expect(out).toContain(GLOSSARY);
    expect(out).toContain(REHAB);
    expect(out).not.toContain(SKILL);
  });

  it('loadSkills (generateNote shape) — general SOAP gets glossary only, no stray separator', async () => {
    const out = await loadSkills(['hebrew-medical-glossary', 'szmc-clinical-notes'], {
      noteType: 'soap',
      isRehab: false,
    });
    expect(out).toBe(GLOSSARY);
    expect(out).not.toContain('===');
  });
});
