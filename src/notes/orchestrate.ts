import { getClient } from '@/agent/client';
import { runEmitTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { wrapForChameleon } from '@/i18n/bidi';
import { NOTE_SKILL_MAP } from './templates';
import type { ParseResult } from '@/agent/tools';
import type { NoteType } from '@/storage/indexed';
import type { ContinuityContext } from './continuity';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const SHARED_SOAP_STYLE = `
Output style (mandatory):
- Short and sweet — 200–400 Hebrew words total
- S: 1–3 sentences of overnight complaints, or "ללא תלונות" if none
- O: structured — Vitals | Exam | Labs (with trend arrows → ↑ ↓ where applicable) | Imaging if new
- A: per-system hashtag categories only, one short line each. Include only categories relevant to this patient. Canonical set: #הימודינמי #נשימתי #זיהומי #כלייתי #נוירולוגי #מטבולי #המטולוגי #גריאטרי
- P: numbered 1., 2., 3. — short imperative, 24-hour horizon only
- Bidi: drug + lab abbreviations stay English; trend arrows (→ ↑ ↓) are neutral Unicode; hashtag labels are Hebrew.
`.trim();

export function buildSoapPromptPrefix(continuity: ContinuityContext | null): string {
  if (!continuity || (!continuity.admission && continuity.priorSoaps.length === 0)) {
    return [
      'Emit a SOAP note in Hebrew.',
      "First SOAP for this patient — anchor the Assessment one-liner from today's chief complaint + PMH + age/sex.",
      SHARED_SOAP_STYLE,
    ].join('\n\n');
  }

  const admBlock = continuity.admission
    ? `ADMISSION (${fmtDate(continuity.admission.createdAt)}):\n${continuity.admission.bodyHebrew}`
    : '';

  if (continuity.mostRecentSoap) {
    const soapBlock = `MOST RECENT SOAP (${fmtDate(continuity.mostRecentSoap.createdAt)}):\n${continuity.mostRecentSoap.bodyHebrew}`;
    return [
      'Emit a SOAP note in Hebrew — follow-up for an existing admission episode.',
      'Context below. Preserve the admission one-liner. For each #hashtag category from the prior SOAP, track the trajectory vs today:',
      '- Same → "ללא שינוי משמעותי"',
      '- Changed → show the delta (e.g. Cr: 2.1 → 1.8 ↓, Apixaban הופסק, חום 39.2 → afebrile)',
      '- Resolved → mark "נפתר"',
      '- New → add under the right category',
      '',
      '---',
      admBlock,
      '',
      soapBlock,
      '---',
      '',
      SHARED_SOAP_STYLE,
    ].join('\n');
  }

  return [
    'Emit a SOAP note in Hebrew — this is the first SOAP for an existing admission.',
    'Use the admission note below to anchor the Assessment one-liner in the format: "<age>yo <sex>, admitted <date> for <diagnosis>, PMH of <PMH>". Populate hashtag categories from admission\'s active problems. Do not restate the full admission — only the one-liner + active problems.',
    '',
    '---',
    admBlock,
    '---',
    '',
    SHARED_SOAP_STYLE,
  ].join('\n');
}

export async function generateNote(
  noteType: NoteType,
  validated: ParseResult,
  continuity: ContinuityContext | null = null,
): Promise<string> {
  const client = await getClient();
  const skills = NOTE_SKILL_MAP[noteType];
  const skillContent = await loadSkills([...skills]);

  const prefix = noteType === 'soap' ? buildSoapPromptPrefix(continuity) : '';
  const systemWithPrefix = prefix ? `${skillContent}\n\n---\n\n${prefix}` : skillContent;

  const raw = await runEmitTurn(client, noteType, validated, systemWithPrefix);
  return wrapForChameleon(raw);
}
