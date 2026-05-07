import { callClaude } from '@/ai/dispatch';
import { type AnthropicContentBlock } from './client';
import type { ParseResult, ParseFields } from './tools';
import { addTurn } from './costs';
import { recordExtract, recordEmit, recordError } from './debugLog';
import { pushBreadcrumb } from '@/ui/components/MobileDebugPanel';
import { isValidIsraeliTzLuhn } from '@/notes/israeliTz';
import type { NoteType } from '@/storage/indexed';
import type { CaptureBlock } from '@/camera/session';

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

function dataUrlToPdfBlock(dataUrl: string): AnthropicContentBlock {
  const m = /^data:application\/pdf;base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('invalid PDF data URL');
  const data = m[1] ?? '';
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
}

const EXTRACT_JSON_INSTRUCTIONS = `
Extract patient data from the attached image(s). Return EXACTLY ONE valid JSON object, with no prose, no markdown fences, no preamble.

REQUIRED FIELDS — extract from ANY input format (AZMA grid, freeform Hebrew prose, phone-consult dictation, SOAP narrative). If mentioned ANYWHERE in the input, populate. If truly absent, omit (do not invent).

  fields.name        ← "שם:" / "מטופל:" / "מטופלת:" / name before "ת.ז."
  fields.teudatZehut ← 9-digit number after "ת.ז." / "תעודת זהות" / "ID:"
  fields.age         ← number after "גיל:" / "בת" / "בן" / "age:"
  fields.sex         ← "מטופל"=M, "מטופלת"=F, "בן"=M, "בת"=F, "ז"=M, "נ"=F
  fields.room        ← "חדר:" / "חדר " + number/letter
  fields.dob         ← date after "תאריך לידה" / "ת.ל."

These are HARD requirements. Read the input TWICE — pass 1 for identity, pass 2 for clinical. Do not skip identity fields just because the input doesn't look like an AZMA screen.

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
    "dob"?: string,
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

/**
 * Which strategy in extractJsonObject ended up resolving the parse. Logged
 * to the debug panel so a user (or future me) can tell at a glance how often
 * the model is misbehaving and forcing us into the recovery paths.
 *
 *   'fast'     — model emitted clean JSON or fence-bookended JSON. Good model day.
 *   'fenced'   — model emitted prose preamble + ```json fence. The v1.21.0
 *                production case. If you see this regularly the model is
 *                ignoring the "no preamble" prompt instruction.
 *   'brace'    — model emitted prose with raw {...} (no fences). Even more
 *                misbehaved; safer recovery thanks to string-literal-aware walker.
 *   'fallback' — no JSON-shaped content found. Caller's JSON.parse will throw
 *                with a real diagnostic for the extract-parse error path.
 */
export type ExtractStrategy = 'fast' | 'fenced' | 'brace' | 'fallback';

export interface ExtractResult {
  json: string;
  strategy: ExtractStrategy;
}

/**
 * Same logic as extractJsonObject but reports which strategy resolved the
 * parse. New callers should prefer this for observability. extractJsonObject
 * is the legacy string-returning shim and stays unchanged for backwards-compat
 * with existing tests and call sites.
 */
export function extractJsonStrategy(s: string): ExtractResult {
  if (!s) return { json: s, strategy: 'fast' };

  // 1. Fast path: already-clean JSON, or pure fence-wrapped JSON.
  const stripped = stripMarkdownFence(s);
  if (stripped.startsWith('{') && stripped.endsWith('}')) {
    return { json: stripped, strategy: 'fast' };
  }

  // 2. Fenced block anywhere in the body. Greedy on outer match, lazy on inner
  // content — `[\s\S]*?` so we stop at the FIRST closing fence, not the last
  // (which would swallow trailing prose-with-backticks if any).
  const fenced = s.match(/```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n?\s*```/);
  if (fenced && fenced[1]) {
    const inner = fenced[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      return { json: inner, strategy: 'fenced' };
    }
  }

  // 3. Balanced-brace fallback. Track string-literal state so '{' or '}' inside
  // a JSON string value doesn't throw off the depth count.
  const start = s.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return { json: s.slice(start, i + 1).trim(), strategy: 'brace' };
      }
    }
  }

  // 4. Nothing extractable — return stripped so caller's JSON.parse throws a
  // real "Unexpected token..." error with the bad payload, matching the
  // pre-v1.21.1 failure mode for genuinely malformed responses.
  return { json: stripped, strategy: 'fallback' };
}

/**
 * Extract a JSON object from a model response that may include prose preamble,
 * "Pass 1 / Pass 2" reasoning, markdown fences, or postamble. Returns a string
 * the caller will JSON.parse — does not parse itself, so caller controls the
 * error path.
 *
 * Strategy in order:
 *   1. Fast path — if stripMarkdownFence yields a `{...}`-shaped string, use it.
 *   2. Find a ```json ... ``` (or bare ``` ... ```) block anywhere in the body
 *      and extract its content.
 *   3. Balanced-brace fallback — walk from the first `{` matching depth, while
 *      respecting JSON string literals so a quoted `{` doesn't throw off depth.
 *   4. If nothing extractable, return stripped output and let JSON.parse throw
 *      a real error message — preserves the existing failure mode for callers.
 *
 * Why centralized: as of 2026-04 Sonnet still emits multi-paragraph "Pass 1
 * Identity / Pass 2 Clinical" preambles before the JSON envelope, even when the
 * system prompt explicitly forbids prose. The original v1.18.1 stripMarkdownFence
 * only stripped fences anchored at start/end of the body, so any preamble made
 * `JSON.parse` throw "Unexpected token 'I'..." (debug-panel issue, ward-helper
 * v1.21.0). All three response parsers (extract, emit, census) now go through
 * this.
 *
 * For observability, prefer extractJsonStrategy() which also returns which
 * strategy resolved the parse. This shim is preserved for the legacy
 * single-string contract that tests assert on directly.
 */
export function extractJsonObject(s: string): string {
  return extractJsonStrategy(s).json;
}

/**
 * Build the Anthropic content array from a CaptureBlock list. Order is
 * preserved so a text block AFTER an image is read by the model as a caption
 * or commentary on the preceding image; a text block BEFORE an image is read
 * as priming context. The extract JSON instructions are prepended as the
 * leading text block so the model always sees the schema first.
 */
function blocksToContent(blocks: readonly CaptureBlock[]): AnthropicContentBlock[] {
  const out: AnthropicContentBlock[] = [
    { type: 'text', text: EXTRACT_JSON_INSTRUCTIONS },
  ];
  for (const b of blocks) {
    if (b.kind === 'image') {
      out.push(dataUrlToImageBlock(b.dataUrl));
    } else if (b.kind === 'pdf') {
      // Surface filename + size as a text header so the model knows what
      // it's looking at (helpful when a doctor uploads e.g. a discharge letter
      // PDF alongside a labs PDF — the names disambiguate). The document
      // content block itself follows.
      out.push({
        type: 'text',
        text: `## PDF: ${b.filename} (${Math.round(b.sizeBytes / 1024)} KB)\n`,
      });
      out.push(dataUrlToPdfBlock(b.dataUrl));
    } else {
      const header =
        b.sourceLabel === 'paste' ? '## נתונים מודבקים\n' : '## הערות נוספות\n';
      out.push({ type: 'text', text: header + b.content });
    }
  }
  return out;
}

export async function runExtractTurn(
  blocks: readonly CaptureBlock[],
  skillContent: string,
  abortSignal?: AbortSignal,
): Promise<ParseResult> {
  if (blocks.length === 0) throw new Error('אין קלט לעיבוד');
  const content = blocksToContent(blocks);
  const imageCount = blocks.reduce((n, b) => n + (b.kind === 'image' ? 1 : 0), 0);

  const started = Date.now();
  let res;
  try {
    res = await callClaude(
      {
        messages: [{ role: 'user', content }],
        // 8k headroom — adaptive thinking eats into max_tokens, and the visible
        // ParseResult JSON is still ~1500 tokens. Pre-Opus-4.7 we had 1500
        // total; with adaptive thinking we need budget for both reasoning + output.
        max_tokens: 8000,
        system: skillContent,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
      },
      // One retry on transient network / 5xx. Extract is the user's first
      // real wait after hitting Proceed; a single transient failure forcing
      // them back to Capture is a worse UX than 2-3 extra seconds here.
      // We cap at 1 (not 2 like emit) because extract is much shorter — a
      // retry landing a cold proxy function usually works on the first try.
      //
      // abortSignal: Phase E batch driver passes its AbortController so a
      // user "בטל" mid-batch cancels the in-flight extract immediately,
      // not after the 45s extract timeout fires.
      { retryOnTransient: 1, signal: abortSignal },
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
  if (!text) {
    const err = new Error('empty response from proxy');
    recordError(err, { phase: 'extract' });
    throw err;
  }

  const { json: clean, strategy } = extractJsonStrategy(text);
  // Record the extract body BEFORE parsing so a parse failure still leaves
  // the full body in the debug panel slot — the parse error itself goes via
  // recordError below, but a copy-snapshot bug-report needs the body too.
  recordExtract(text, {
    images: imageCount,
    in_tokens: res.usage.input_tokens,
    out_tokens: res.usage.output_tokens,
    ms: Date.now() - started,
    parseStrategy: strategy,
  });
  let parsed: ParseResult;
  try {
    parsed = JSON.parse(clean) as ParseResult;
  } catch (e) {
    recordError(e, { phase: 'extract-parse', context: clean.slice(0, 200) });
    throw new Error(
      `failed to parse JSON from model: ${(e as Error).message}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }

  // v1.39.3 telemetry: count clinical field types extracted. When this
  // is 0 (identity-only extract), the SOAP emit produces a Marciano-style
  // stub with "ממתין להשלמת נתונים" placeholders. The /review clinical-
  // content gate prevents that stub from shipping at the doctor's hand,
  // but we want production telemetry to tell us WHY extract returned
  // identity-only — photo quality? schema permissiveness? vision
  // regression? After 5-10 instances we'll know which lever to pull.
  const f = (parsed.fields ?? {}) as ParseFields;
  const clinicalCount =
    (f.chiefComplaint?.trim() ? 1 : 0) +
    ((f.meds?.length ?? 0) > 0 ? 1 : 0) +
    ((f.labs?.length ?? 0) > 0 ? 1 : 0) +
    ((f.pmh?.length ?? 0) > 0 ? 1 : 0) +
    ((f.allergies?.length ?? 0) > 0 ? 1 : 0) +
    (f.vitals && Object.keys(f.vitals).length > 0 ? 1 : 0);
  if (clinicalCount === 0) {
    // Capture tz shape (length + Luhn validity) but NOT the raw value —
    // breadcrumbs are device-local but we still don't write 9-digit
    // identifiers to localStorage. Length lets us tell "model returned
    // 6 digits" (AZMA showed it short, OCR didn't pad) from "model
    // returned 9 zero-padded digits" (the 666544000 failure mode).
    const tzRaw = f.teudatZehut?.trim() ?? '';
    pushBreadcrumb('extract.lowClinical', {
      imageCount,
      hasName: Boolean(f.name?.trim()),
      hasTz: Boolean(tzRaw),
      tzLen: tzRaw.length,
      tzLuhnValid: tzRaw ? isValidIsraeliTzLuhn(tzRaw) : false,
      hasAge: typeof f.age === 'number',
      in_tokens: res.usage.input_tokens,
      out_tokens: res.usage.output_tokens,
      ms: Date.now() - started,
      parseStrategy: strategy,
    });
  }

  return {
    fields: f,
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
  abortSignal?: AbortSignal,
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
    res = await callClaude(
      {
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: skillContent,
      },
      { retryOnTransient: 2, signal: abortSignal },
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
  if (!text) {
    const err = new Error('empty response from proxy');
    recordError(err, { phase: 'emit', context: noteType });
    throw err;
  }

  // No silent fallback to raw text — if parsing fails, throw and let the UI
  // surface a regenerate prompt. The pre-v1.18.1 fallback let users paste a
  // literal "```json" wrapper into Chameleon. v1.21.1 upgraded fence-strip to
  // full JSON-extraction so prose preamble doesn't break parsing either.
  const { json: clean, strategy } = extractJsonStrategy(text);
  recordEmit(text, {
    noteType,
    in_tokens: res.usage.input_tokens,
    out_tokens: res.usage.output_tokens,
    ms: Date.now() - started,
    parseStrategy: strategy,
  });
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

// ─────────────────────────────────────────────────────────────────────────
// Census extraction (AZMA "ניהול מחלקה" department grid)
// ─────────────────────────────────────────────────────────────────────────

export interface CensusRow {
  name: string;
  teudatZehut: string | null;
  room: string;
  isolation: boolean;
  ventilation: boolean;
  bloodBankColor: 'green' | 'purple' | 'yellow' | null;
  unsignedAdmission: boolean;
  unsignedShiftSummary: boolean;
}

export interface CensusResult {
  rows: CensusRow[];
  parsedAt: number;
}

const CENSUS_JSON_INSTRUCTIONS = `
You are extracting a patient list from ONE of these sources:
  (a) AZMA "ניהול מחלקה" department patient grid screenshot, OR
  (b) A printed paper handover sheet (דף מודפס של רשימת המחלקה / handover sheet — דף נייר).

The photo may be rotated 90°/180° (paper photographed sideways is common). Mentally normalize orientation before extracting.

Return EXACTLY ONE valid JSON object — no prose, no markdown fences, no preamble — matching this shape:

{
  "rows": [
    {
      "name": string,                       // patient full name (Hebrew). See NAME DISCIPLINE below.
      "teudatZehut": string | null,         // 9-digit Israeli ID; null if not visible/legible
      "room": string,                       // e.g. "12", "12-A", "ICU-3"; "" if no room column
      "isolation": boolean,                 // (AZMA only) diagnosis text rendered RED — false on paper
      "ventilation": boolean,               // (AZMA only) column 2 "מ" flag set — false on paper
      "bloodBankColor": "green" | "purple" | "yellow" | null,  // (AZMA only) — null on paper
      "unsignedAdmission": boolean,         // (AZMA only) blue pen icon — false on paper
      "unsignedShiftSummary": boolean       // (AZMA only) green circle icon — false on paper
    }
  ]
}

When extracting from a paper sheet, set ALL AZMA flag fields to their "absent" value (false / null) — paper has no equivalent. Do NOT guess flags from non-AZMA inputs.

NAME DISCIPLINE — critical, this is the most common failure mode:
- A name is a PERSON (e.g. "יוסף סוקולסקי", "מרים סופרין").
- NEVER put a column header or status phrase in the name field. Phrases like "סטטוס קליטה" / "תאריך קבלה" / "אבחנה" / "שם" are headers, not patients — they appear ONCE at the top of a column, not per row.
- If a row clearly has an ID but the name cell is blank, smudged, or unreadable, return name: "" (empty string). Do NOT invent a name. Do NOT borrow from an adjacent column (diagnosis ≠ name).
- Hebrew names are typically two words (first + last). A single technical word in the name slot is almost always a header bleed — emit "" instead.

Extract EVERY visible patient row. If a row is partially cut off at the edge of the image, include what you can read and set teudatZehut: null when the ID is not legible.

DO NOT confuse data rows with: the application title bar, visit-history side pane, doctor-name strip (AZMA), column header row, totals/summary row, signature block (paper).

DO NOT invent rows. If a photo only shows 3 rows clearly (rest blurred), return only those 3 — better to under-report than to fabricate.

Return ONLY the JSON.
`.trim();

export async function runCensusExtractTurn(
  images: string[],
  skillContent: string,
): Promise<CensusResult> {
  if (images.length === 0) throw new Error('census extract requires at least one image');
  const imageBlocks = images.map(dataUrlToImageBlock);
  const content: AnthropicContentBlock[] = [
    ...imageBlocks,
    { type: 'text', text: CENSUS_JSON_INSTRUCTIONS },
  ];

  const started = Date.now();
  let res;
  try {
    res = await callClaude(
      {
        messages: [{ role: 'user', content }],
        // 4096 tokens fits a 30-row grid with all flags. Direct path easily
        // handles this; proxy path may 504 on cold starts — caller should
        // retry from Census.tsx if needed.
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: skillContent,
      },
      { retryOnTransient: 1 },
    );
  } catch (e) {
    recordError(e, { phase: 'census-extract' });
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
    const err = new Error('empty response from proxy (census)');
    recordError(err, { phase: 'census-extract' });
    throw err;
  }

  const clean = extractJsonObject(text);
  let parsed: { rows?: unknown };
  try {
    parsed = JSON.parse(clean) as { rows?: unknown };
  } catch (e) {
    recordError(e, { phase: 'census-parse', context: clean.slice(0, 200) });
    throw new Error(
      `failed to parse census JSON: ${(e as Error).message}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
  const rows = Array.isArray(parsed.rows) ? (parsed.rows as CensusRow[]) : [];
  return { rows, parsedAt: Date.now() };
}
