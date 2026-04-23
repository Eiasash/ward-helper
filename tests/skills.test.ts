import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadSkill, loadSkills, clearSkillCache } from '@/skills/loader';

beforeEach(() => {
  clearSkillCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stub global fetch with a per-URL response map. Passing null means HTTP 404. */
function stubFetch(responses: Record<string, string | null>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const content = responses[url];
    if (content == null) {
      return { ok: false, text: async () => '' } as Response;
    }
    return { ok: true, text: async () => content } as Response;
  });
}

describe('loadSkill', () => {
  it('returns content of SKILL.md for a single-file skill', async () => {
    stubFetch({ '/skills/szmc-clinical-notes/SKILL.md': '# Clinical Notes\ncontent here' });
    const content = await loadSkill('szmc-clinical-notes');
    expect(content).toBe('# Clinical Notes\ncontent here');
  });

  it('caches result — fetch is called only once per skill', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', async () => {
      callCount++;
      return { ok: true, text: async () => 'cached content' } as Response;
    });
    await loadSkill('szmc-clinical-notes');
    await loadSkill('szmc-clinical-notes');
    expect(callCount).toBe(1);
  });

  it('throws when none of the skill files are found', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, text: async () => '' } as Response));
    await expect(loadSkill('szmc-clinical-notes')).rejects.toThrow('skill szmc-clinical-notes not found');
  });

  it('azma-ui combines SKILL.md and AZMA_REFERENCE.md with separator', async () => {
    stubFetch({
      '/skills/azma-ui/SKILL.md': 'azma skill body',
      '/skills/azma-ui/AZMA_REFERENCE.md': 'azma reference body',
    });
    const content = await loadSkill('azma-ui');
    expect(content).toContain('azma skill body');
    expect(content).toContain('azma reference body');
    expect(content).toContain('\n\n---\n\n');
  });

  it('azma-ui succeeds with only SKILL.md when AZMA_REFERENCE.md is missing', async () => {
    stubFetch({
      '/skills/azma-ui/SKILL.md': 'azma skill only',
      '/skills/azma-ui/AZMA_REFERENCE.md': null,
    });
    const content = await loadSkill('azma-ui');
    expect(content).toBe('azma skill only');
  });
});

describe('clearSkillCache', () => {
  it('forces a fresh fetch on the next call', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', async () => {
      callCount++;
      return { ok: true, text: async () => 'content' } as Response;
    });
    await loadSkill('szmc-clinical-notes');
    clearSkillCache();
    await loadSkill('szmc-clinical-notes');
    expect(callCount).toBe(2);
  });
});

describe('loadSkills', () => {
  it('joins multiple skills with === separator', async () => {
    stubFetch({
      '/skills/szmc-clinical-notes/SKILL.md': 'notes content',
      '/skills/hebrew-medical-glossary/SKILL.md': 'glossary content',
    });
    const combined = await loadSkills(['szmc-clinical-notes', 'hebrew-medical-glossary']);
    expect(combined).toContain('notes content');
    expect(combined).toContain('glossary content');
    expect(combined).toContain('\n\n===\n\n');
  });

  it('returns single skill content when called with one skill', async () => {
    stubFetch({ '/skills/szmc-clinical-notes/SKILL.md': 'solo skill' });
    const content = await loadSkills(['szmc-clinical-notes']);
    expect(content).toBe('solo skill');
  });
});
