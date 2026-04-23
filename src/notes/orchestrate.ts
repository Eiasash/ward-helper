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

/**
 * Chameleon rules copied verbatim into every emit prompt so the model never
 * forgets. Kept in sync with public/skills/szmc-clinical-notes/SKILL.md
 * §"CHAMELEON EMR PASTE RULES". The sanitizer in bidi.ts catches violations
 * anyway, but the prompt prevents them from happening in the first place.
 */
const CHAMELEON_RULES = `
Chameleon paste rules — these are hard constraints:
- NEVER use Unicode arrows (→ ← ↑ ↓). Use a single ">" with spaces for trends/transitions: "Cr: 1.55 > 1.03".
- NEVER use ** for bold or -- as dividers. Plain text only.
- NEVER write ">200" or "<50". Spell out: "מעל 200", "מתחת 50".
- NEVER write q8h / q6h / bid / tid / qd. Spell out: "כל 8 שעות", "פעמיים ביום", "פעם ביום".
- No trailing "?" after a Hebrew statement. Use "(?)" inline only as an uncertainty marker in the plan.
- Section headers: plain Hebrew word + colon ("המלצות:"). No asterisks, no decoration.
- Drug recommendations use the drug-card pattern:
    Line 1: drug name (+ dose, in English)
    Line 2+: pure Hebrew instruction
  Never mix English drug names and "מ-X ל-Y" taper ranges on the same line.
- Dates DD/MM/YY. Lab values exact — never round.
`.trim();

/**
 * SOAP-specific style. SOAP runs "in the spirit of a consult": short,
 * problem-focused, action-oriented — the daily handoff, not a chart biography.
 */
const SOAP_STYLE = `
SOAP note style — short daily handoff written in the spirit of a geriatric consult:
- Total length 150-350 Hebrew words. Every line earns its place.
- S (סובייקטיבי): 1-3 sentences on overnight complaints / pain / sleep / appetite. If none: "ללא תלונות חדשות".
- O (אובייקטיבי): compact blocks, one line per block:
    סימנים חיוניים: BP, HR, SpO2, Temp (exact numbers).
    בדיקה: key positives/negatives only — no system-by-system sweep.
    מעבדה: trends as "סידן: 12.3 > 11.6 > 9.8 (20/04)" using a single ">" — NEVER arrows.
    הדמיה: only if new.
- A (הערכה): problem list by #hashtag category, one short Hebrew line each.
  Canonical categories (use only those relevant): # הימודינמי  # נשימתי  # זיהומי  # כלייתי  # נוירולוגי  # מטבולי  # המטולוגי  # גריאטרי  # תפקוד
- P (תוכנית): numbered 1., 2., 3. — 24-hour horizon. Each item a short imperative verb phrase.
  Drug changes use the drug-card pattern (drug name English, Hebrew instruction next line).
  Consult-spirit: when recommending meds, be specific and concrete (dose, route, frequency in Hebrew).
`.trim();

/**
 * Admission prompt — anchored to the szmc-clinical-notes printed-output order.
 * Output sections in order, plain text, Hebrew headers with colon.
 */
const ADMISSION_STYLE = `
Admission (קבלה רפואית) — emit these sections in order, each under its Hebrew header:

1. הצגת החולה: one line — age, sex, marital/living status, source (רפואה דחופה / מוסד / בית).
2. אבחנות פעילות: English UPPERCASE, modifiers where applicable (- Suspected, , Recurrent, M/P).
3. אבחנות ברקע: chronic conditions, English UPPERCASE.
4. תלונה עיקרית: 1-2 lines.
5. מחלה נוכחית: full narrative. Close with Padua score; add CHADS2-VASc if AF.
6. רקע רפואי: two parts —
    פרוט מחלות: (organ-system dash format — לבבי - ... / וסקולרי - ... / כלייתי - ...)
    אבחנות בעבר: English UPPERCASE list.
7. רגישויות: list with reactions, or "לא ידוע".
8. תרופות בבית: SZMC format: "Generic ( Brand ) Route Dose Unit X Freq / Period".
9. הרגלים: "מעשן: לא / שימוש באלכוהול: לא / שימוש בסמים: לא".
10. תפקוד: pre-morbid baseline + current (mobility aid, cognitive, caregiver, living situation).
11. בדיקה גופנית: vitals + systems. Short positives/negatives.
12. בדיקות עזר: raw cultures + imaging reports verbatim.
13. בדיקות מעבדה: short prose trends only ("סידן: 12.3 > 9.8").
14. דיון ותוכנית: "#" headers per problem, disease-focused, short (e.g. "# AKI על CKD", "# בלבול").
    Under each, 2-4 lines of reasoning + a bare-verb plan.
15. חתימה: "חתימת רופא: ד\"ר Eias Ashhab, מתמחה גריאטריה".
`.trim();

/**
 * Discharge prompt — 18-step printed order exactly as in the skill.
 */
const DISCHARGE_STYLE = `
Discharge (סיכום אשפוז) — emit the sections in the printed-output order below.
Do NOT include a glossary. Do NOT include תרופות באשפוז. Do NOT write PT/OT/dietician prose
in the body (the PT block auto-attaches; OT + dietician paste into their own sub-tabs).

Order:
1. אבחנות פעילות: English UPPERCASE with modifier where applicable (- Resolved, , Recurrent, M/P).
2. אבחנות ברקע: chronic.
3. רגישויות: list with reactions, or "לא ידוע".
4. תרופות בבית: SZMC format, pre-admission meds.
5. הצגת החולה: single line.
6. תלונה עיקרית: 1-2 lines.
7. מחלה נוכחית: full narrative (BEFORE רקע רפואי — opposite of admission).
8. רקע רפואי: "פרוט מחלות:" (organ-system) + "אבחנות בעבר:" (English UPPERCASE).
9. הרגלים.
10. בדיקה גופנית בקבלה: vitals + systems from admission.
11. בדיקות עזר (פירוט): cultures + imaging together, verbatim, BEFORE narrative.
12. בדיקות מעבדה: short prose trends only — "סידן: 12.3 > 9.8 (20/04)". Single ">", never arrows. Full lab table auto-appends.
13. מהלך ודיון: "#" headers per problem, disease-focused, short.
    Sequence: acute problem first > metabolic > infection > neuro > resolving > minor findings > consults > "# טיפול יעדי" if GOC discussed > "# תפקוד" at end.
14. המלצות בשחרור: numbered 1., 2., 3. ... N. Each a single recommendation. Include brief PT/OT/dietician referral lines ("הפניה לפיזיותרפיה בבית (יט\"ב)", "הפניה לריפוי בעיסוק בקהילה").
15. המשך טיפול תרופתי: numbered 1., 2., 3. ... N. SZMC format. Completed ABX omitted. Suspended drugs kept with restart note in parens.
16. חתימה: attending cosignature line first, then fellow's signature with מ.ר. and timestamp.
`.trim();

/**
 * Consult prompt — szmc-clinical-notes §"Consult" structure, in-lane/out-of-lane
 * discipline, no jargon.
 */
const CONSULT_STYLE = `
Consult (ייעוץ גריאטרי) — short, specific, in-lane only. Assume the reader is a non-geriatric team.
Forbidden jargon: CFS, frailty / פרגיליות, Beers, STOPP/START, ACB, polypharmacy, BPSD, CAM, PAINAD, sarcopenia, deprescribing.
Use plain Hebrew: "מטופל סיעודי", "תלוי לחלוטין", "להפסיק תרופות מיותרות".

Do NOT raise goals of care proactively unless explicitly asked or imminent end-of-life.

Sections in order:
1. כותרת: "ייעוץ גריאטרי — תאריך DD/MM/YY — מטופל X — מחלקה מפנה Y — יועץ ד\"ר Eias Ashhab".
2. סיבת הייעוץ: 1 line.
3. דיווח: brief relevant history.
4. הערכה: short paragraph — what's going on geriatrically.
5. המלצות תרופתיות: as drug cards (drug name English line 1, Hebrew instruction line 2). Groups:
    להפסיק: ... 
    להוסיף: ...
    לשנות מינון: ...
6. טיפול לא-תרופתי: bullet-free bare verbs (mobilization, reorientation, hearing aids, sleep hygiene).
7. בדיקות להשלמה: bare-verb list.
8. הפניות: out-of-lane items only ("לדיון עם גסטרו לגבי ...").
9. ביקור חוזר: "בהמשך לפי צורך" or specific interval.
10. חתימה: "חתימה: ד\"ר Eias Ashhab, מתמחה גריאטריה, DD/MM/YY".
`.trim();

/** SOAP with optional continuity context (admission + prior SOAPs). */
export function buildSoapPromptPrefix(continuity: ContinuityContext | null): string {
  const base = [CHAMELEON_RULES, SOAP_STYLE];

  if (!continuity || (!continuity.admission && continuity.priorSoaps.length === 0)) {
    return [
      'Emit a SOAP note in Hebrew.',
      "First SOAP for this patient — anchor the Assessment one-liner on today's chief complaint + PMH + age/sex.",
      ...base,
    ].join('\n\n');
  }

  const admBlock = continuity.admission
    ? `ADMISSION (${fmtDate(continuity.admission.createdAt)}):\n${continuity.admission.bodyHebrew}`
    : '';

  if (continuity.mostRecentSoap) {
    const soapBlock = `MOST RECENT SOAP (${fmtDate(continuity.mostRecentSoap.createdAt)}):\n${continuity.mostRecentSoap.bodyHebrew}`;
    return [
      'Emit a SOAP note in Hebrew — follow-up for an existing admission episode.',
      'For each #hashtag category from the prior SOAP, track the trajectory vs today:',
      '- Same: "ללא שינוי משמעותי"',
      '- Changed: show the delta using a single ">" (e.g. "Cr: 2.1 > 1.8", "Apixaban הופסק", "חום 39.2 > afebrile")',
      '- Resolved: mark "נפתר"',
      '- New: add under the right category',
      '',
      '---',
      admBlock,
      '',
      soapBlock,
      '---',
      '',
      ...base,
    ].join('\n');
  }

  return [
    'Emit a SOAP note in Hebrew — first SOAP for an existing admission.',
    'Use the admission note below to anchor the Assessment one-liner: "<age>yo <sex>, admitted <date> for <diagnosis>, PMH <PMH>". Populate hashtag categories from admission\'s active problems. Do not restate the full admission.',
    '',
    '---',
    admBlock,
    '---',
    '',
    ...base,
  ].join('\n');
}

function buildPromptPrefix(noteType: NoteType, continuity: ContinuityContext | null): string {
  switch (noteType) {
    case 'soap':
      return buildSoapPromptPrefix(continuity);
    case 'admission':
      return [CHAMELEON_RULES, ADMISSION_STYLE].join('\n\n');
    case 'discharge':
      return [CHAMELEON_RULES, DISCHARGE_STYLE].join('\n\n');
    case 'consult':
      return [CHAMELEON_RULES, CONSULT_STYLE].join('\n\n');
    case 'case':
      // case-conference notes use szmc-interesting-cases skill; paste rules still apply.
      return CHAMELEON_RULES;
  }
}

export async function generateNote(
  noteType: NoteType,
  validated: ParseResult,
  continuity: ContinuityContext | null = null,
): Promise<string> {
  const client = await getClient();
  const skills = NOTE_SKILL_MAP[noteType];
  const skillContent = await loadSkills([...skills]);

  const prefix = buildPromptPrefix(noteType, continuity);
  const systemWithPrefix = `${skillContent}\n\n---\n\n${prefix}`;

  const raw = await runEmitTurn(client, noteType, validated, systemWithPrefix);
  return wrapForChameleon(raw);
}
