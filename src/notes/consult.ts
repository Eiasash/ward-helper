/**
 * Consult-style chat orchestrator.
 *
 * Different shape from the capture→extract→emit pipeline in orchestrate.ts.
 * Here the doctor speaks free-form (Hebrew, English, or mixed) and the
 * model plays the role of a senior geriatric clinician at SZMC: it asks
 * focused clarifying questions, pushes back when reasoning looks off, and
 * — when the doctor explicitly asks — emits a Chameleon-ready note from
 * everything that's been said in the thread.
 *
 * Design choices:
 * - Chat turns use a SHORT system prompt and a small max_tokens budget.
 *   Average turn is 2-4 sentences; long structured output is reserved for
 *   the explicit emit step.
 * - Emit is a separate call that loads the full szmc-clinical-notes skill
 *   and produces the same {noteHebrew} JSON envelope used by the capture
 *   path, so the bidi sanitizer and Chameleon paste rules apply uniformly.
 * - No image inputs in chat mode by design — if the doctor has AZMA
 *   screenshots, the existing /capture flow is the right tool. This avoids
 *   the wrong-patient defense complexity that lives in orchestrate.ts.
 *
 * PHI footprint: chat history lives in sessionStorage on the device only.
 * Cleared on "new case" or page reload. No persistence to IndexedDB or
 * Supabase from this module — only the final emitted note hits the storage
 * layer (via the existing Save flow).
 */

import { callAnthropic } from '@/agent/client';
import { addTurn } from '@/agent/costs';
import { recordEmit, recordError } from '@/agent/debugLog';
import { loadSkills } from '@/skills/loader';
import { wrapForChameleon } from '@/i18n/bidi';
import { NOTE_SKILL_MAP, NOTE_LABEL } from './templates';
import type { NoteType } from '@/storage/indexed';

export interface ConsultMsg {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const CONSULT_SYSTEM = `You are a senior geriatric clinician at Shaare Zedek Medical Center (SZMC), Jerusalem, helping a fellow think through a patient case in real time.

Your role:

1. LISTEN. Take the case as the fellow gives it. Hebrew, English, or mixed — match the language they're using. If they switch, you switch.

2. ASK SHORT, FOCUSED CLARIFYING QUESTIONS only when essential clinical detail is missing. Priorities for geriatric admissions: functional baseline (CFS, IADL, ambulation), home medications (especially anticoagulants, opioids, hypoglycemics, antihypertensives), advance directives / code status, recent changes in cognition or mobility, social support / living situation. ONE question at a time. Don't interrogate.

3. PUSH BACK when the working diagnosis or plan looks wrong, incomplete, or off-protocol. You're not a yes-man. Cite specific reasoning — "consider Beers list interaction with X", "delirium screen looks underweighted given the cognitive change you described", "this dose is renally cleared and Cr is 1.8".

4. KEEP REPLIES SHORT — 2-5 sentences by default. Conversational tone. Save long structured output for when the fellow asks you to draft the note.

5. NEVER INVENT PATIENT DATA. If the fellow hasn't mentioned a value, don't assert it. Acknowledge gaps explicitly: "you didn't mention albumin — assume hypoalbuminemia for the corrected calcium?".

6. WHEN THE FELLOW ASKS YOU TO DRAFT A NOTE — phrases like "תכין קבלה", "תכין שחרור", "סיים", "draft the admission", "draft discharge", "write it up", "שחרור", "סיכום" — reply EXACTLY with the literal token <NOTE_READY> on its own line, with no other text. The system handles emission separately. Do NOT attempt to write the note yourself in chat mode.

Geriatric mindset is the lens: frailty matters more than age, every admission gets a delirium screen and a STOPP/START review, function is the outcome that matters, goals of care are part of the differential.`;

const NOTE_READY_TOKEN = '<NOTE_READY>';

export interface ChatTurnResult {
  /** Assistant reply text. Empty string if the model signalled emit-ready. */
  reply: string;
  /** True when the model emitted the <NOTE_READY> sentinel — UI should
   *  prompt the doctor to pick a note type and run runConsultEmit. */
  emitReady: boolean;
  /** Token usage for this turn — fed into the existing cost meter. */
  inTokens: number;
  outTokens: number;
}

/**
 * One conversational turn. Sends the full history; trusts callAnthropic
 * to fall back from direct→proxy as configured. No retry — if a single
 * chat reply fails, the user sees the error inline and can re-send.
 */
export async function runConsultTurn(history: ConsultMsg[]): Promise<ChatTurnResult> {
  if (history.length === 0) {
    throw new Error('runConsultTurn called with empty history');
  }
  if (history[history.length - 1]!.role !== 'user') {
    throw new Error('runConsultTurn: last message must be from user');
  }

  const messages = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const res = await callAnthropic({
    messages,
    max_tokens: 1024,
    system: CONSULT_SYSTEM,
  });

  addTurn({
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  });

  const text = res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  // Sentinel detection — model signals "draft now" by returning the literal
  // token. Anything else is conversational. We're permissive about the
  // exact match (case-insensitive, ignore surrounding whitespace) because
  // a 4096-token model occasionally adds a stray period or newline.
  const emitReady =
    /^\s*<note_ready>\s*$/i.test(text) ||
    text.toUpperCase().includes(NOTE_READY_TOKEN);

  return {
    reply: emitReady ? '' : text,
    emitReady,
    inTokens: res.usage.input_tokens,
    outTokens: res.usage.output_tokens,
  };
}

const EMIT_FROM_CHAT_INSTRUCTIONS = `
Return EXACTLY ONE valid JSON object, with no prose, no markdown fences, no preamble. Shape:

{ "noteHebrew": "<the complete Hebrew note as plain text, ready for Chameleon paste>" }

Inside noteHebrew:
- Plain text only. Hebrew section headers + colon. No JSON nesting, no code fences, no asterisks for bold.
- Section order matches the SZMC institutional format defined in the skill content above.
- Use ONLY clinical detail mentioned by the fellow in the chat transcript. If a value is absent, write "לא צוין" or omit the line — never invent.
- Drug names: English UPPERCASE, format: GENERIC ( BRAND ) Route Dose Unit X Freq / Period. Hebrew instruction text on the next line if needed.
- Chameleon paste rules: NO Unicode arrows (→ ← ↑ ↓), NO ** for bold, NO -- as dividers, NO ">200" / "<50" (spell out: "מעל 200" / "מתחת 50"), NO q8h/bid/tid (spell out in Hebrew). Use single ">" between values for trends ("Cr: 1.55 > 1.03 > 0.92"). No trailing "?" after Hebrew statements.
`.trim();

/**
 * Emit a Chameleon-ready note from the chat transcript.
 *
 * The transcript is rendered as a "case discussion" preamble; the szmc-
 * clinical-notes skill rides as the system prompt so all the institutional
 * rules apply. Output goes through wrapForChameleon (RTL marks + paste
 * sanitization) before being returned to the caller.
 *
 * Throws on JSON parse failure or empty noteHebrew. Caller should surface
 * the error inline in the chat (red error bubble) and offer a retry.
 */
export async function runConsultEmit(
  noteType: NoteType,
  history: ConsultMsg[],
): Promise<string> {
  if (history.length === 0) {
    throw new Error('runConsultEmit called with empty history');
  }

  const skills = NOTE_SKILL_MAP[noteType];
  const skillContent = await loadSkills([...skills]);

  const transcript = history
    .map((m) => {
      const tag = m.role === 'user' ? 'הרופא' : 'יועץ';
      return `${tag}:\n${m.content.trim()}`;
    })
    .join('\n\n---\n\n');

  const userText = [
    `From the following case discussion between a geriatrics fellow and a senior clinician, emit a complete SZMC ${NOTE_LABEL[noteType]} (${noteType}) note in Hebrew.`,
    '',
    'CASE DISCUSSION TRANSCRIPT:',
    '',
    transcript,
    '',
    '---',
    '',
    EMIT_FROM_CHAT_INSTRUCTIONS,
  ].join('\n');

  const started = Date.now();
  let res;
  try {
    res = await callAnthropic(
      {
        messages: [{ role: 'user', content: userText }],
        max_tokens: 4096,
        system: skillContent,
      },
      { retryOnTransient: 2 },
    );
  } catch (e) {
    recordError(e, { phase: 'consult-emit', context: noteType });
    throw e;
  }

  addTurn({
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  });

  const text = res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  if (!text) {
    const err = new Error('empty response from emit');
    recordError(err, { phase: 'consult-emit', context: noteType });
    throw err;
  }

  // Strip code fences if present, then attempt to extract the first {…}
  // object. Same defensive parsing as runEmitTurn but inlined to avoid
  // pulling in the heavy extractJsonStrategy dependency. The model is
  // generally well-behaved on this prompt — one fallback layer is enough.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let candidate = stripped;
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('emit response was not JSON');
    }
    candidate = candidate.slice(start, end + 1);
  }

  let parsed: { noteHebrew?: string };
  try {
    parsed = JSON.parse(candidate) as { noteHebrew?: string };
  } catch (e) {
    recordError(e, {
      phase: 'consult-emit-parse',
      context: candidate.slice(0, 200),
    });
    throw new Error('emit response was not valid JSON');
  }

  if (typeof parsed?.noteHebrew !== 'string' || parsed.noteHebrew.length === 0) {
    throw new Error('emit response missing noteHebrew');
  }

  recordEmit(text, {
    noteType,
    in_tokens: res.usage.input_tokens,
    out_tokens: res.usage.output_tokens,
    ms: Date.now() - started,
    // parseStrategy intentionally omitted — that field is typed for the
    // extractJsonStrategy parser used in capture-flow emits. Chat-flow
    // emit is simpler (fence-strip + brace-extract inlined above) and
    // doesn't fit any of the named strategies.
  });

  return wrapForChameleon(parsed.noteHebrew);
}

/** Exported for tests + UI affordances. */
export const CONSULT_NOTE_READY_TOKEN = NOTE_READY_TOKEN;
