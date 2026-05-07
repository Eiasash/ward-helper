/**
 * Per-section regenerate logic. Tests the surgical replace + the prompt
 * shape (not a real API call — that's the agent.test.ts territory).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { replaceSectionInBody, regenerateSection, SectionRegenError } from '@/notes/regenerate';
// regenerate.ts now imports callClaude from @/ai/dispatch (v1.39.0
// single-chokepoint refactor). Spies attach to dispatch, not the legacy
// @/agent/client surface.
import * as client from '@/ai/dispatch';

describe('replaceSectionInBody', () => {
  const body = [
    '# סעיף ראשון',
    'תוכן ראשון.',
    '',
    '# סעיף שני',
    'תוכן שני.',
    '',
    '# סעיף שלישי',
    'תוכן שלישי.',
  ].join('\n');

  it('replaces the middle section while preserving neighbors', () => {
    const replaced = replaceSectionInBody(body, 1, '# סעיף שני\nחדש לגמרי.');
    expect(replaced).toContain('# סעיף ראשון');
    expect(replaced).toContain('תוכן ראשון.');
    expect(replaced).toContain('# סעיף שני\nחדש לגמרי.');
    expect(replaced).toContain('# סעיף שלישי');
    expect(replaced).toContain('תוכן שלישי.');
    expect(replaced).not.toContain('תוכן שני.');
  });

  it('replaces the first section', () => {
    const replaced = replaceSectionInBody(body, 0, '# סעיף ראשון\nרענן.');
    expect(replaced.startsWith('# סעיף ראשון\nרענן.')).toBe(true);
    expect(replaced).toContain('# סעיף שלישי');
  });

  it('replaces the last section', () => {
    const replaced = replaceSectionInBody(body, 2, '# סעיף שלישי\nאחרון.');
    expect(replaced).toMatch(/# סעיף שלישי\nאחרון\.$/);
  });

  it('returns body unchanged when idx is out of range', () => {
    expect(replaceSectionInBody(body, 99, 'noop')).toBe(body);
    expect(replaceSectionInBody(body, -1, 'noop')).toBe(body);
  });

  it('strips trailing whitespace from the new section body', () => {
    const replaced = replaceSectionInBody(body, 1, '# סעיף שני\nחדש.\n\n   \n');
    expect(replaced).toContain('# סעיף שני\nחדש.');
    // The result shouldn't have the trailing whitespace from the input.
    const middleIdx = replaced.indexOf('# סעיף שלישי');
    expect(middleIdx).toBeGreaterThan(0);
  });
});

describe('regenerateSection (proxy contract)', () => {
  const body = [
    '# פתיח',
    'אישה בת 78.',
    '',
    '# מהלך אשפוז',
    'אושפזה בשל UTI.',
    '',
    '# המלצות',
    'המשך טיפול אנטיביוטי.',
  ].join('\n');

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the regenerated section body when the model honors the contract', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: '{"sectionBody": "# מהלך אשפוז\\nאושפזה בשל UTI עם המודינמיקה תקינה."}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    } as Awaited<ReturnType<typeof client.callClaude>>);

    const result = await regenerateSection({
      noteType: 'admission',
      body,
      sectionIndex: 1,
      systemSkillContent: 'system',
    });
    expect(result).toContain('# מהלך אשפוז');
    expect(result).toContain('המודינמיקה');
  });

  it('throws when the regenerated header drifts to a different section', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: '{"sectionBody": "# המלצות\\nמשהו אחר."}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    } as Awaited<ReturnType<typeof client.callClaude>>);

    await expect(
      regenerateSection({
        noteType: 'admission',
        body,
        sectionIndex: 1, // # מהלך אשפוז — but model returned # המלצות
        systemSkillContent: 'system',
      }),
    ).rejects.toThrow(SectionRegenError);
  });

  it('throws when sectionBody is missing', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    } as Awaited<ReturnType<typeof client.callClaude>>);

    await expect(
      regenerateSection({
        noteType: 'admission',
        body,
        sectionIndex: 1,
        systemSkillContent: 'system',
      }),
    ).rejects.toThrow(/missing sectionBody/);
  });

  it('throws SectionRegenError on out-of-range section index', async () => {
    await expect(
      regenerateSection({
        noteType: 'admission',
        body,
        sectionIndex: 99,
        systemSkillContent: 'system',
      }),
    ).rejects.toThrow(SectionRegenError);
  });

  it('uses a small max_tokens (6000) — section regen budget is bounded vs full-emit', async () => {
    const spy = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValue({
        content: [{ type: 'text', text: '{"sectionBody": "# מהלך אשפוז\\nתוכן."}' }],
        usage: { input_tokens: 50, output_tokens: 20 },
      } as Awaited<ReturnType<typeof client.callClaude>>);

    await regenerateSection({
      noteType: 'admission',
      body,
      sectionIndex: 1,
      systemSkillContent: 'system',
    });
    expect(spy).toHaveBeenCalled();
    const callArgs = spy.mock.calls[0]?.[0] as { max_tokens?: number } | undefined;
    expect(callArgs?.max_tokens).toBe(6000);
  });
});
