import { getClient } from '@/agent/client';
import { runEmitTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { wrapForChameleon } from '@/i18n/bidi';
import { NOTE_SKILL_MAP } from './templates';
import type { ParseResult } from '@/agent/tools';
import type { NoteType } from '@/storage/indexed';

export async function generateNote(noteType: NoteType, validated: ParseResult): Promise<string> {
  const client = await getClient();
  const skills = NOTE_SKILL_MAP[noteType];
  const skillContent = await loadSkills([...skills]);
  const raw = await runEmitTurn(client, noteType, validated, skillContent);
  return wrapForChameleon(raw);
}
