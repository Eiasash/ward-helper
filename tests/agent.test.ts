import { describe, it, expect, vi } from 'vitest';
import { runExtractTurn, runEmitTurn } from '@/agent/loop';
import type { ParseResult } from '@/agent/tools';

type FakeClient = {
  messages: {
    create: ReturnType<typeof vi.fn>;
  };
};

function makeFakeClient(): FakeClient {
  return {
    messages: {
      create: vi.fn(async (opts: { system: string }) => {
        if (opts.system.includes('azma-ui') || opts.system.includes('AZMA')) {
          return {
            content: [
              {
                type: 'tool_use' as const,
                name: 'parse_azma_screen',
                input: {
                  fields: { name: 'דוד כהן', age: 82, chiefComplaint: 'קוצר נשימה' },
                  confidence: { name: 'high', age: 'high', chiefComplaint: 'med' },
                  sourceRegions: {
                    name: 'ADT banner',
                    age: 'ADT banner',
                    chiefComplaint: 'triage note',
                  },
                },
              },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        }
        return {
          content: [
            {
              type: 'tool_use' as const,
              name: 'emit_note',
              input: { noteHebrew: 'קבלה: דוד כהן, בן 82...' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 200, output_tokens: 300 },
        };
      }),
    },
  };
}

describe('agent loop', () => {
  it('extract turn returns ParseResult with confidence + sources', async () => {
    const client = makeFakeClient();
    const result = await runExtractTurn(
      // @ts-expect-error — fake client shape is sufficient
      client,
      ['data:image/png;base64,iVBOR'],
      'SKILL CONTENT azma-ui',
    );
    expect(result.fields.name).toBe('דוד כהן');
    expect(result.confidence['name']).toBe('high');
    expect(result.sourceRegions['chiefComplaint']).toBe('triage note');
  });

  it('emit turn returns a Hebrew note string', async () => {
    const client = makeFakeClient();
    const parsed: ParseResult = {
      fields: { name: 'דוד', age: 82 },
      confidence: {},
      sourceRegions: {},
    };
    const note = await runEmitTurn(
      // @ts-expect-error — fake client shape is sufficient
      client,
      'admission',
      parsed,
      'szmc-clinical-notes skill content',
    );
    expect(note).toContain('קבלה');
  });
});
