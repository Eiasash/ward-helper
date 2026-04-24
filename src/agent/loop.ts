import { callAnthropic, type AnthropicContentBlock } from './client';
import type { ParseResult, ParseFields } from './tools';
import { addTurn } from './costs';
import { recordExtract, recordEmit, recordError } from './debugLog';
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
Extract patient data from the attached image(s). Return EXACTLY ONE valid JSON object, with no prose, no markdown fences, no preamble.

Image context: the images are often PHONE PHOTOS of a desktop monitor displaying AZMA/Chameleon EMR, not clean digital screenshots. Expect keystone distortion, moiré patterns, glare, partial reflections, monitor bezel, and slight blur. Read through these — the underlying data is SZMC AZMA/Chameleon. Hebrew column headers and English medication names are high-contrast and reliable; numeric values (ID numbers, lab values, doses) are what you should be most careful about. When a digit is genuinely ambiguous due to photo quality (not just "could be 0 or O"), lower the confidence on that field instead of guessing.

AZMA / Chameleon — identity traps you MUST respect (these override anything else in the image):

1. The top-left title bar shows "Eitan 4  <Doctor name>  <Patient code>" — e.g. "Eitan 4  אשרב איאס  p15695". The Hebrew name in this strip is the LOGGED-IN CLINICIAN, NOT the patient. NEVER put this name in fields.name. The short "pNNNNN" code is an internal patient code, NOT the Israeli ת.ז. — never put it in fields.teudatZehut (a real ת.ז. is 9 digits, no letters).

2. The authoritative patient identity is the PATIENT CARD near the top-center/right, with vertically stacked labeled lines: "שם מטופל:", "ת.זהות:", "גיל:", "נקבה/זכר:", "מחלקה:", "ת.אשפוז:". Read name / teudatZehut / age / sex ONLY from this card. If the card is not clearly visible in any image, OMIT those fields entirely rather than substituting from elsewhere on screen.

3. The small numeric strip above the tabs has labeled cells: "גיל" (age, years), "משקל" (weight, kg), "חום" (temp, °C), "ל"ד" (BP), "דופק" (pulse), "סטורציה" (SpO₂), "BMI". Read by label, never by position. A 92-year-old weighing 62 kg shows "גיל: 92" and "משקל: 62.00" — returning age 62 in that case is a wrong-patient-age error. Omit the field rather than guess its label.

4. The left pane "visit history" rows (date + doctor name + discipline) are HISTORY, not the current patient. Doctor names in those rows are not patient data.

When in doubt about name / teudatZehut / age / sex, OMIT the field. An omitted field becomes a blank the doctor fills; a wrong field becomes a wrong-patient clinical note.

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
- Only include fields clearly readable from the image.
- For "meds", cap at 15 most relevant items. Skip irrelevant/historical.
- For "labs", cap at 10 most abnormal or most recent.
- "confidence" MUST contain ONLY the three critical identifier keys (name / teudatZehut / age) — NOT meds, labs, or any other field. These three drive wrong-patient / wrong-age errors, so the ward doc needs to know when extract was uncertain. Omit keys you can't assess.
- On a phone photo of a monitor, drop confidence to "med" on any field you wouldn't bet on after one quick glance; drop to "low" if pixels are genuinely smeared. Do NOT mark "high" just because the value is present — mark "high" only when the rendering is sharp AND unambiguous.
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

/**
 * Strip ```json ... ``` or ``` ... ``` fences the model sometimes adds.
 * Idempotent: safe to call on already-clean JSON.
 *
 * Why centralized: admission emits in v1.18.0 occasionally returned the JSON
 * envelope wrapped in fences, JSON.parse threw, the old runEmitTurn silently
 * returned the raw fenced string as the note body, and the user could then
 * copy literal "```json" into Chameleon. Both extract and emit parsers go
 * through this now.
 */
export function stripMarkdownFence(s: string): string {
  if (!s) return s;
  let out = s.trim();
  out = out.replace(/^\s*```(?:json|JSON)?\s*\r?\n?/, '');
  out = out.replace(/\r?\n?\s*```\s*$/, '');
  return out.trim();
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

  const started = Date.now();
  let res;
  try {
    res = await callAnthropic(
      {
        messages: [{ role: 'user', content }],
        // 1500 is plenty for a compact ParseResult. With a user-direct path this
        // comfortably fits the Anthropic non-streaming envelope; with the proxy
        // fallback it stays under the 10s budget too.
        max_tokens: 1500,
        system: skillContent,
      },
      // One retry on transient network / 5xx. Extract is the user's first
      // real wait after hitting Proceed; a single transient failure forcing
      // them back to Capture is a worse UX than 2-3 extra seconds here.
      // We cap at 1 (not 2 like emit) because extract is much shorter — a
      // retry landing a cold proxy function usually works on the first try.
      { retryOnTransient: 1 },
    );
  } catch (e) {
    recordError(e, { phase: 'extract' });
    throw e;
  }

  addTurn({
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  } as { input_tokens: number; output_tokens: number });

  const text = res.content.map((b) => b.text).join('\n').trim();
  recordExtract(text, {
    images: images.length,
    in_tokens: res.usage.input_tokens,
    out_tokens: res.usage.output_tokens,
    ms: Date.now() - started,
  });
  if (!text) {
    const err = new Error('empty response from proxy');
    recordError(err, { phase: 'extract' });
    throw err;
  }

  const clean = stripMarkdownFence(text);
  let parsed: ParseResult;
  try {
    parsed = JSON.parse(clean) as ParseResult;
  } catch (e) {
    recordError(e, { phase: 'extract-parse', context: clean.slice(0, 200) });
    throw new Error(
      `failed to parse JSON from model: ${(e as Error).message}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
  return {
    fields: (parsed.fields ?? {}) as ParseFields,
    // Enforce the critical-3 scope on read. Models sometimes emit extra
    // confidence keys despite the prompt (e.g. room, chiefComplaint — we
    // observed this in production on v1.6.0). The UI trust boundary is the
    // ParseResult, so strip unknown keys here instead of letting them leak
    // into FieldRow and render pills where we don't want them.
    confidence: filterToCriticalThree(
      parsed.confidence as Record<string, unknown> | undefined,
    ),
  };
}

const EMIT_JSON_INSTRUCTIONS = `
Return EXACTLY ONE valid JSON object with this shape — no prose, no markdown fences, no preamble:

{ "noteHebrew": string }

The "noteHebrew" value is the full SZMC-format note in Hebrew, ready to paste into Chameleon. Plain text only. Follow the Chameleon paste rules strictly.

CRITICAL — handling missing data:
- If the validated fields are sparse, write a SHORT note with only the sections you can fill confidently.
- Do NOT write placeholder tokens like [יש להשלים], [TODO], [not provided], or "לא ידוע" in prose slots. Either fill the section with real data or OMIT the whole section's body (keep the header, leave one blank line under it).
- For exam/labs/imaging with zero data, write one short line: "לא צולם בקבלה" or "מחכה לתוצאות" — never a stub.
- For drug doses where you have the drug but not the dose, omit the parenthetical and write just the generic + Hebrew instruction.
- Under "דיון ותוכנית" / "מהלך ודיון" / "A:" / "P:" — if there's insufficient input to discuss a real problem, emit a single line: "ממתין להשלמת נתונים" and stop. Do not invent problems.

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

  // Long emits (admission/discharge) can take 30-60s even on the direct path.
  // Retry transient network/5xx failures up to 2 more times with 2s/4s backoff.
  // Direct-to-Anthropic transient failures are rare; proxy-path 504s are
  // common but at least one retry sometimes lands in a warm function.
  const started = Date.now();
  let res;
  try {
    res = await callAnthropic(
      {
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        max_tokens: 4096,
        system: skillContent,
      },
      { retryOnTransient: 2 },
    );
  } catch (e) {
    recordError(e, { phase: 'emit', context: noteType });
    throw e;
  }

  addTurn({
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  } as { input_tokens: number; output_tokens: number });

  const text = res.content.map((b) => b.text).join('\n').trim();
  recordEmit(text, {
    noteType,
    in_tokens: res.usage.input_tokens,
    out_tokens: res.usage.output_tokens,
    ms: Date.now() - started,
  });
  if (!text) {
    const err = new Error('empty response from proxy');
    recordError(err, { phase: 'emit', context: noteType });
    throw err;
  }

  // No silent fallback to raw text — if parsing fails, throw and let the UI
  // surface a regenerate prompt. The pre-v1.18.1 fallback let users paste a
  // literal "```json" wrapper into Chameleon.
  const clean = stripMarkdownFence(text);
  let parsed: { noteHebrew?: string };
  try {
    parsed = JSON.parse(clean) as { noteHebrew?: string };
  } catch (e) {
    recordError(e, { phase: 'emit-parse', context: clean.slice(0, 200) });
    throw new Error('emit response was not valid JSON even after fence strip');
  }
  if (typeof parsed?.noteHebrew !== 'string' || parsed.noteHebrew.length === 0) {
    const err = new Error('emit response missing noteHebrew field');
    recordError(err, { phase: 'emit-parse', context: clean.slice(0, 200) });
    throw err;
  }
  return parsed.noteHebrew;
}
