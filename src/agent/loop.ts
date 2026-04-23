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
  },
  "confidence": {
    "name"?: "low" | "med" | "high",
    "teudatZehut"?: "low" | "med" | "high",
    "age"?: "low" | "med" | "high"
  }
}

KEEP IT COMPACT:
- Only include fields clearly readable from the screenshot.
- For "meds", cap at 15 most relevant items. Skip irrelevant/historical.
- For "labs", cap at 10 most abnormal or most recent.
- "confidence" MUST contain ONLY the three critical identifier keys (name / teudatZehut / age) — NOT meds, labs, or any other field. These three drive wrong-patient / wrong-age errors, so the ward doc needs to know when extract was uncertain. Omit keys you can't assess.
- DO NOT emit a "sourceRegions" field — it's no longer consumed.
- DO NOT include a "vitals" field unless BP/HR/SpO2/Temp are all visible as numbers.

Preserve language: drug names in English, Hebrew clinical prose in Hebrew. Never transliterate.
Return ONLY the JSON object. No fences. Aim for the smallest complete JSON.
`.trim();

const CRITICAL_CONFIDENCE_KEYS = ['name', 'teudatZehut', 'age'] as const;

function filterToCriticalThree(
  conf: Record<string, unknown> | undefined,
): Record<string, 'low' | 'med' | 'high'> {
  if (!conf) return {};
  const out: Record<string, 'low' | 'med' | 'high'> = {};
  for (const k of CRITICAL_CONFIDENCE_KEYS) {
    const v = conf[k];
    if (v === 'low' || v === 'med' || v === 'high') out[k] = v;
  }
  return out;
}

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
    // 1500 is plenty for a compact ParseResult. Empirically this keeps
    // single- and two-shot captures well inside the proxy's 10s Netlify
    // Function budget even with the critical-3 confidence block re-enabled.
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
    return {
      fields: (parsed.fields ?? {}) as ParseFields,
      // Enforce the critical-3 scope on read. Models sometimes emit extra
      // confidence keys despite the prompt (e.g. room, chiefComplaint — we
      // observed this in production on v1.6.0). The UI trust boundary is the
      // ParseResult, so strip unknown keys here instead of letting them leak
      // into FieldRow and render pills where we don't want them.
      confidence: filterToCriticalThree(parsed.confidence),
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

  // Emit calls on long notes (admission/discharge) can exceed the Toranot
  // proxy's ~10s Netlify Function budget even on the first token. Retry on
  // 504 twice with 2s/4s backoff — cold-start 504s often resolve on retry,
  // and three attempts total is the right cost ceiling for a clinical flow
  // where each failure otherwise forces a full re-capture.
  const res = await callProxy(
    {
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      max_tokens: 4096,
      system: skillContent,
    },
    { retryOn504: 2 },
  );

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
