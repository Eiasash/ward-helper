import type { NoteType } from '@/storage/indexed';
import type { SkillName } from '@/skills/loader';

/**
 * Skill allowlist per note type. Sent as `system` on the emit call.
 *
 * Cost impact: the szmc-clinical-notes skill is 23 KB (~6000 tokens).
 * At \$3/M input = ~\$0.018 per emit. For admission/discharge/consult
 * it's worth it (they describe admission-specific headers, the 18-step
 * printed-output order, drug-card patterns, etc). For SOAP — which has
 * a complete self-contained prompt prefix in orchestrate.ts's
 * SOAP_STYLE — it's pure waste. Most SOAP generations barely touched
 * the skill content; the model was pattern-matching on SOAP_STYLE.
 *
 * SOAP now loads ONLY the glossary (3.7 KB, ~930 tokens). Saves ~\$0.015
 * per SOAP, ~\$1-\$2/mo at typical ward rounds volume. More importantly,
 * the smaller system prompt leaves more room for continuity context
 * (prior admission + recent SOAPs) without hitting the 100k context cap.
 *
 * Types are `readonly SkillName[]` (was tuple of two) so admission can
 * one day grow a third skill without a schema change.
 */
export const NOTE_SKILL_MAP: Record<NoteType, readonly SkillName[]> = {
  admission: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  discharge: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  consult: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  case: ['szmc-interesting-cases', 'hebrew-medical-glossary'],
  // SOAP is driven entirely by orchestrate.ts's SOAP_STYLE prefix —
  // ship ONLY the glossary for Hebrew term consistency.
  soap: ['hebrew-medical-glossary'],
  // Census is not a clinical note — it's grid extraction. AZMA-UI is the
  // primary reference (column semantics, color codes, icon meanings); the
  // glossary rides along to keep the every-note-type invariant in
  // tests/templates.test.ts intact (and Hebrew patient names benefit from
  // the bidi/transliteration hints anyway).
  census: ['azma-ui', 'hebrew-medical-glossary'],
};

export const NOTE_LABEL: Record<NoteType, string> = {
  admission: 'קבלה',
  discharge: 'שחרור',
  consult: 'ייעוץ',
  case: 'מקרה מעניין',
  soap: 'SOAP יומי',
  census: 'רשימת מחלקה',
};
