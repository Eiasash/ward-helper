/**
 * Per-section regenerate — focused emit that returns ONLY one section.
 *
 * The full emit (orchestrate.ts → runEmitTurn) is a 4096-token request that
 * costs $0.02-$0.10. Regenerating one section ("the discussion paragraph
 * sounds wrong; rewrite it without changing the meds list") shouldn't pay
 * that price. This module:
 *
 *   1. Builds a prompt that pins the surrounding sections as context and
 *      asks for ONLY the named section's body (no headers, no other
 *      sections), in plain Hebrew text.
 *   2. Calls the proxy with a small max_tokens budget.
 *   3. Returns the regenerated body. The caller is responsible for
 *      surgically replacing the section in the parent note via
 *      `replaceSectionInBody`.
 *
 * The full-note emit is left intact — this is a side-channel for a single
 * section only. It must NEVER trigger a full re-emit.
 */

import { callAnthropic } from '@/agent/client';
import { addTurn } from '@/agent/costs';
import { recordEmit, recordError } from '@/agent/debugLog';
import { extractJsonStrategy } from '@/agent/loop';
import type { NoteType } from '@/storage/indexed';
import { splitIntoSections, type NoteSection } from './sections';

const SECTION_REGEN_INSTRUCTIONS = `
You are regenerating ONE SECTION of an existing SZMC clinical note. The user marked this section for refresh. The other sections of the note are PINNED — preserve voice, preserve cross-references to them.

Return EXACTLY ONE valid JSON object — no prose, no markdown fences, no preamble:

{ "sectionBody": string }

The "sectionBody" is the FULL CONTENT of the section INCLUDING its own "# header" line, ready to drop in as a replacement. Plain text only. Match the existing section's hebrew-medical voice and Chameleon formatting (no arrows, no **bold**, no qNh, etc.).

Do NOT emit other sections. Do NOT emit a JSON envelope around the wider note. Do NOT change the section's "#" header line — keep it byte-for-byte identical so the surgical replace lines up.

Return ONLY the JSON object.
`.trim();

export class SectionRegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionRegenError';
  }
}

/**
 * Regenerate a single section's text via a focused, low-cost emit. The
 * caller passes the full current note body and the index of the section
 * to refresh; the function returns the regenerated section body (header
 * line + content), suitable for `replaceSectionInBody`.
 *
 * Throws when the model returns an envelope without sectionBody, or
 * when the regenerated text doesn't begin with the same `# header` line
 * — the safety check ensures we don't replace one section's content with
 * another section's text by accident.
 */
export async function regenerateSection(args: {
  noteType: NoteType;
  body: string;
  sectionIndex: number;
  systemSkillContent: string;
  /** Optional user steer — "make it shorter" / "drop the AKI line". */
  userHint?: string;
}): Promise<string> {
  const { noteType, body, sectionIndex, systemSkillContent, userHint } = args;
  const sections = splitIntoSections(body);
  const target = sections[sectionIndex];
  if (!target) {
    throw new SectionRegenError(`section index ${sectionIndex} out of range`);
  }

  const userText = buildSectionUserText({ noteType, sections, sectionIndex, target, userHint });

  let res;
  try {
    res = await callAnthropic(
      {
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        // 1500 is plenty for a single section (typical 60-300 tokens).
        // Capping low keeps the regen cheap and the round-trip fast.
        max_tokens: 1500,
        system: systemSkillContent,
      },
      { retryOnTransient: 1 },
    );
  } catch (e) {
    recordError(e, { phase: 'section-regen', context: noteType });
    throw e;
  }

  addTurn({
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  } as { input_tokens: number; output_tokens: number });

  const text = res.content.map((b) => b.text).join('\n').trim();
  if (!text) {
    const err = new SectionRegenError('empty response from proxy');
    recordError(err, { phase: 'section-regen', context: noteType });
    throw err;
  }

  const { json: clean, strategy } = extractJsonStrategy(text);
  recordEmit(text, {
    noteType,
    in_tokens: res.usage.input_tokens,
    out_tokens: res.usage.output_tokens,
    ms: 0,
    parseStrategy: strategy,
  });

  let parsed: { sectionBody?: string };
  try {
    parsed = JSON.parse(clean) as { sectionBody?: string };
  } catch (e) {
    recordError(e, { phase: 'section-regen-parse', context: clean.slice(0, 200) });
    throw new SectionRegenError(
      `regenerate response was not valid JSON. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
  if (typeof parsed.sectionBody !== 'string' || parsed.sectionBody.length === 0) {
    throw new SectionRegenError('regenerate response missing sectionBody field');
  }

  // Guardrail: the regenerated text must lead with the SAME header line.
  // If not, the model drifted to a different section — safer to throw than
  // to swap sections. Exception: the special "פתיחה" intro section has no
  // header line, so we only check when the existing target has one.
  const targetFirstLine = target.body.split('\n')[0] ?? '';
  if (targetFirstLine.startsWith('# ')) {
    const newFirstLine = parsed.sectionBody.split('\n')[0] ?? '';
    if (newFirstLine.trim() !== targetFirstLine.trim()) {
      throw new SectionRegenError(
        `regenerated header drifted: expected "${targetFirstLine}", got "${newFirstLine}"`,
      );
    }
  }

  return parsed.sectionBody.replace(/\s+$/, '');
}

function buildSectionUserText(args: {
  noteType: NoteType;
  sections: NoteSection[];
  sectionIndex: number;
  target: NoteSection;
  userHint?: string;
}): string {
  const { noteType, sections, sectionIndex, target, userHint } = args;

  const beforeBlock = sections
    .slice(0, sectionIndex)
    .map((s) => s.body)
    .join('\n\n');
  const afterBlock = sections
    .slice(sectionIndex + 1)
    .map((s) => s.body)
    .join('\n\n');

  const lines: string[] = [];
  lines.push(`Note type: ${noteType}`);
  lines.push(`Target section: "${target.name}"`);
  lines.push('');
  if (beforeBlock.trim().length > 0) {
    lines.push('--- SECTIONS BEFORE (PINNED — for context only) ---');
    lines.push(beforeBlock);
    lines.push('');
  }
  lines.push('--- CURRENT TARGET SECTION (refresh this only) ---');
  lines.push(target.body);
  lines.push('');
  if (afterBlock.trim().length > 0) {
    lines.push('--- SECTIONS AFTER (PINNED — for context only) ---');
    lines.push(afterBlock);
    lines.push('');
  }
  if (userHint && userHint.trim()) {
    lines.push('--- USER HINT ---');
    lines.push(userHint.trim());
    lines.push('');
  }
  lines.push(SECTION_REGEN_INSTRUCTIONS);
  return lines.join('\n');
}

/**
 * Surgically replace section #idx in a full note body with the supplied
 * section body. Returns the new full body. Pure / deterministic. The
 * inverse of splitIntoSections + a join — preserves the surrounding
 * sections byte-for-byte (modulo trailing whitespace normalization).
 *
 * If idx is out of range, returns the original body unchanged. Empty input
 * returns the new section body alone.
 */
export function replaceSectionInBody(
  body: string,
  idx: number,
  newSectionBody: string,
): string {
  const sections = splitIntoSections(body);
  if (idx < 0 || idx >= sections.length) return body;
  const cleaned = newSectionBody.replace(/\s+$/, '');
  const updated = sections.map((s, i) => (i === idx ? { ...s, body: cleaned } : s));
  return updated.map((s) => s.body).join('\n\n');
}
