import { callProxy, type AnthropicContentBlock } from './client';
import type { ParseResult, ParseFields } from './tools';
import { addTurn } from './costs';
import type { NoteType } from '@/storage/indexed';

/**
 * Extract structured AZMA data. Uses JSON-mode prompting (not tool_use)
 * because the Toranot proxy strips the `tools` field.
 *
 * We instruct the model to return strict JSON that exactly matches the
 * ParseResult shape, then parse/validate client-side.
 */

function dataUrlToImageBlock(dataUrl: string): AnthropicContentBlock {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('invalid data URL');
  const raw = m[1] ?? 'image/jpeg';
  const data = m[2] ?? '';
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
  const mediaType = (allowed as readonly string[]).includes(raw)
    ? (raw as (typeof allowed)[number])
    : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

const EXTRACT_JSON_INSTRUCTIONS = `
Extract patient data from the AZMA screenshots. Return EXACTLY ONE valid JSON object, with no prose, no markdown fences, no preamble.

Shape (ALL fields optional — OMIT anything not clearly visible, do NOT invent):
{
  "fields": {
    "name"?: string,
    "teudatZehut"?: string,
    "age"?: number,
    "sex"?: "M" | "F",
    "room"?: string,
    "chiefComplaint"?: string,
    "pmh"?: string[],
    "meds"?: [{ "name": string, "dose"?: string, "freq"?: string }],
    "allergies"?: string[],
    "labs"?: [{ "name": string, "value": string, "unit"?: string }]
  }
}

KEEP IT COMPACT:
- Only include fields clearly readable from the screenshot.
- For "meds", cap at 15 most relevant items. Skip irrelevant/historical.
- For "labs", cap at 10 most abnormal or most recent.
- DO NOT include a "confidence" or "sourceRegions" field — omit them entirely.
- DO NOT include a "vitals" field unless BP/HR/SpO2/Temp are all visible as numbers.

Preserve language: drug names in English, Hebrew clinical prose in Hebrew. Never transliterate.
Return ONLY the JSON object. No fences. Aim for the smallest complete JSON.
`.trim();

function parseJsonStrict<T>(text: string): T {
  // Strip ```json fences if the model ignored instructions.
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Find the outermost { ... } if there's extra prose before/after.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }
  return JSON.parse(s) as T;
}

export async function runExtractTurn(
  images: string[],
  skillContent: string,
): Promise<ParseResult> {
  const imageBlocks = images.map(dataUrlToImageBlock);
  const content: AnthropicContentBlock[] = [
    ...imageBlocks,
    { type: 'text', text: EXTRACT_JSON_INSTRUCTIONS },
  ];

  const res = await callProxy({
    messages: [{ role: 'user', content }],
    // 1500 is plenty for a compact ParseResult. Higher values let the model
    // ramble with confidence/sourceRegions objects that blow past the
    // proxy's 10s Netlify Function budget.
    max_tokens: 1500,
    system: skillContent,
  });

  addTurn({
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  } as { input_tokens: number; output_tokens: number });

  const text = res.content.map((b) => b.text).join('\n').trim();
  if (!text) throw new Error('empty response from proxy');

  try {
    const parsed = parseJsonStrict<ParseResult>(text);
    // Ensure required fields exist; backfill empties.
    return {
      fields: (parsed.fields ?? {}) as ParseFields,
      confidence: parsed.confidence ?? {},
      sourceRegions: parsed.sourceRegions ?? {},
    };
  } catch (e) {
    throw new Error(
      `failed to parse JSON from model: ${(e as Error).message}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
}

const EMIT_JSON_INSTRUCTIONS = `
Return EXACTLY ONE valid JSON object with this shape — no prose, no markdown fences, no preamble:

{ "noteHebrew": string }

The "noteHebrew" value is the full SZMC-format note in Hebrew, ready to paste into Chameleon. Plain text only. Follow the Chameleon paste rules strictly.
Return ONLY the JSON.
`.trim();

export async function runEmitTurn(
  noteType: NoteType,
  validatedFields: ParseFields,
  skillContent: string,
): Promise<string> {
  const userText = [
    `Emit a SZMC ${noteType} note in Hebrew from the validated data below.`,
    'Preserve bidi rules: Hebrew prose, English drug/acronym/lab names, RLM/LRM where needed.',
    '',
    JSON.stringify(validatedFields, null, 2),
    '',
    EMIT_JSON_INSTRUCTIONS,
  ].join('\n');

  const res = await callProxy({
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    max_tokens: 4096,
    system: skillContent,
  });

  addTurn({
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  } as { input_tokens: number; output_tokens: number });

  const text = res.content.map((b) => b.text).join('\n').trim();
  if (!text) throw new Error('empty response from proxy');

  try {
    const parsed = parseJsonStrict<{ noteHebrew: string }>(text);
    if (typeof parsed.noteHebrew !== 'string' || parsed.noteHebrew.length === 0) {
      throw new Error('missing noteHebrew field');
    }
    return parsed.noteHebrew;
  } catch (e) {
    // If JSON parsing fails, fall back to treating the whole response as
    // the note body — the model may have ignored the JSON instruction.
    if ((e as Error).message.includes('JSON')) {
      return text;
    }
    throw e;
  }
}
