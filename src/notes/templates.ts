import type { NoteType } from '@/storage/indexed';
import type { SkillName } from '@/skills/loader';

export const NOTE_SKILL_MAP: Record<NoteType, [SkillName, SkillName]> = {
  admission: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  discharge: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  consult: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  case: ['szmc-interesting-cases', 'hebrew-medical-glossary'],
  soap: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
};

export const NOTE_LABEL: Record<NoteType, string> = {
  admission: 'קבלה',
  discharge: 'שחרור',
  consult: 'ייעוץ',
  case: 'מקרה מעניין',
  soap: 'SOAP יומי',
};
