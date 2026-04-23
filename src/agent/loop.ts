import type Anthropic from '@anthropic-ai/sdk';
import { MODEL } from './client';
import { parseAzmaTool, emitNoteTool, type ParseResult } from './tools';
import type { NoteType } from '@/storage/indexed';

function dataUrlToB64(dataUrl: string): { mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('invalid data URL');
  const raw = match[1] ?? 'image/png';
  const data = match[2] ?? '';
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
  const mediaType = (allowed as readonly string[]).includes(raw) ? (raw as typeof allowed[number]) : 'image/png';
  return { mediaType, data };
}

export async function runExtractTurn(
  client: Anthropic,
  images: string[],
  skillContent: string,
): Promise<ParseResult> {
  const imageBlocks = images.map((dataUrl) => {
    const { mediaType, data } = dataUrlToB64(dataUrl);
    return {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: mediaType, data },
    };
  });

  const userContent: Anthropic.MessageParam['content'] = [
    ...imageBlocks,
    {
      type: 'text' as const,
      text: 'Extract structured data from these AZMA screenshots. For every field, report confidence and source_region.',
    },
  ];

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: skillContent,
    tools: [parseAzmaTool],
    tool_choice: { type: 'tool', name: 'parse_azma_screen' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('no parse_azma_screen tool_use');
  return toolUse.input as ParseResult;
}

export async function runEmitTurn(
  client: Anthropic,
  noteType: NoteType,
  parsed: ParseResult,
  skillContent: string,
): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: skillContent,
    tools: [emitNoteTool],
    tool_choice: { type: 'tool', name: 'emit_note' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Emit a SZMC ${noteType} note in Hebrew from the validated data below. ` +
              `Preserve bidi rules: Hebrew prose, English drug/acronym/lab names, RLM/LRM where needed.\n\n` +
              JSON.stringify(parsed.fields, null, 2),
          },
        ],
      },
    ],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('no emit_note tool_use');
  return (toolUse.input as { noteHebrew: string }).noteHebrew;
}
