import { runEmitTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { wrapForChameleon } from '@/i18n/bidi';
import { NOTE_SKILL_MAP } from './templates';
import { rehabAugmentation } from './rehabPrompts';
import type { SoapMode } from './soapMode';
import type { ParseResult } from '@/agent/tools';
import type { NoteType } from '@/storage/indexed';
import type { ContinuityContext } from './continuity';
import type { SeedDecision } from './seedFromYesterdaySoap';

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
בתוך השדה noteHebrew: ללא JSON מקונן, ללא code fences, ללא עטיפת אובייקטים. תוכן השדה הוא טקסט עברי בלבד.

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
 * SOAP-specific style — geriatric daily handoff (rehab AND acute medicine).
 * First-follow-up after admission has a patient capsule in A; subsequent
 * follow-ups skip it. Daily-asks (sleep/BM/urine/pain/cooperation) live in
 * S every round. O is bedside-only — no labs, no imaging printouts. Labs
 * and imaging go inline in A per relevant problem bullet, only when
 * actionable today.
 *
 * Section structure follows SZMC convention (Dr. עביד ראפת pattern).
 * Format applies to both rehab-ward daily rounds (ביקור רופא) and the
 * first SOAP follow-up in acute geriatric/internal medicine wards.
 */
const SOAP_STYLE = `
SOAP note — geriatric daily handoff. Format applies to both rehab daily rounds (ביקור רופא בשיקום) and acute-ward daily rounds (ביקור רופא במחלקה).

Length budget: 150-300 Hebrew words for stable follow-ups, 200-400 for first follow-up after admission (capsule adds ~80 words), 250-500 for complex follow-ups with multiple active acute issues.

Section order (standard SZMC, headers underlined):
  S דיווח המטופל:
  O בדיקה גופנית וממצאי עזר:
  A מסקנה והערכה:
  P לביצוע:
  תוכנית טיפול (יעדי טיפול):

— S (דיווח המטופל) — daily-asks ALWAYS, every round, every dept:
  Standing ask line: sleep (ישן/ה טוב בלילה or לא ישן/ה), pain (ללא כאבים / כאב X/10 / כאב מאוזן עם הטיפול), BM (יציאות תקינות / עצירות X ימים / פעמ"ם אתמול), urine (שתן תקין / רטנציה / קטטר), rehab participation (משתתף/ת בטיפול שיקומי / לא משתף/ת).
  Pain status determines whether the patient can do today's PT — don't bury it.
  Then: today's specific complaints, family requests, mood, transfer-related concerns.
  If patient feels well: "מרגיש/ה טוב, ישן/ה טוב בלילה. ללא כאבים. שתן ויציאות תקינים. משתתף/ת בטיפול שיקומי."

— O (בדיקה גופנית וממצאי עזר) — bedside exam ONLY. NEVER paste lab tables or imaging blocks here. NEVER list "מעבדה:" or "הדמיה:" in this section.
  Vitals: חום X.X, ד YY, ל"ד YY/YY, סטורציה NN%.
  Exam: cooperation + cognition implicit + 4-system (קולות הלב / כניסת אוויר / בטן / גפיים) + indication-focused additions (surgical wound length & sutures & drainage; per-limb motor + sensation + DP for mobility cases; fistula thrill+bruit for HD; cranial nerves for post-CVA).
  Labs and imaging belong in A under the relevant problem bullet — see below.

— A (מסקנה והערכה) —
  FIRST follow-up after admission (this is the patient's first daily round in the dept) opens with a 3-4 line PATIENT CAPSULE per SZMC convention (Dr. עביד ראפת pattern):
    "בן/בת [age], [marital], [parent count]. מתגורר/ת [living situation - alone / with whom / floor / elevator / caregiver / institution]. איש קשר עיקרי: [name + relationship + phone if available].
    רקע רפואי כולל [3-5 chronic dx prioritized for relevance].
    בבסיס [pre-admission ADL / mobility one-liner — walker / wheelchair / cane / independent / dependent].
    כעת לאחר [acute event] בתאריך [DD/MM]. התקבל/ה ל[ward] ביום [N] לאחר [event]."
  Then literal word "בעיות:" introducing problem bullets. Capsule mandatory on first follow-up regardless of complexity. Cross-check demographics against admission הצגת החולה — wrong on day 1 propagates for the entire admission.

  Subsequent follow-ups: NO capsule. Open A with a single one-line synthesis ("בשיקום לאחר X — מתקדם/יציב/החמרה ב-Y"), then bullets directly.

  Bullet format: \`*[domain] - [status, relevant lab/imaging inline, decision]\`
  Domain prefixes (Hebrew, with asterisk — NOT #hashtag):
    *אורתופדית  *זיהומית  *תפקודית  *עצמות  *כלייתי  *לבבי  *נשימתי  *נוירולוגית
    *כאב  *עצירות  *שינה  *תזונתי  *פסיכולוגית  *המטולוגית  *אא"ג  *קוגניטיבי
    *לחץ דם  *שתן  *מטבולית  *פצע  *בצקת

  Labs and imaging go INLINE in the relevant bullet, ONLY when actionable today. Examples:
    *עצמות - שבר נמוך-אנרגיה ב-89, ויטמין D 23 (חוסר). יש להשלים PTH/אלבומין/Ca מתוקן/ALP. להעלות D מעל 30 לפני ביספוספונט.
    *המטולוגית - Hb 10.1 (פרה-אופ 12.6). אנמיה לאחר ניתוח, מעקב מגמה.
    *עצירות - CT (30/04) שלל חסימה. נמשיך PEG וחוקנים PRN.
    *זיהומית - תרבית CRE רקטלית מ-03/05 בתהליך. רקע ERCP+ספסיס 2019.
  If a lab/result isn't driving a decision today, leave it out. The acute team's discharge has the full panel; this is a daily handoff.

— P (לביצוע) — bare-verb actions with explicit timing: היום / מחר בבוקר / לפני המנה הבאה / יומיומית / עד תאריך DD/MM. Usually shorter than A. For stable patients: "המשך טיפול שיקומי" alone is acceptable. For complex: 4-8 specific lines.

— תוכנית טיפול (יעדי טיפול) — 1-2 lines: case header + concrete goal by indication.
  Post-hip/knee replacement: "בן/בת X לאחר [procedure]. מטרה לעצמאות בניידות ובשרותים."
  Post-spine: "מטרה לעצמאות במעברים והליכה עם עזרים."
  Pre-cardiac: "מטרה לחיזוק תפקודי טרום-ניתוחי."
  Post-CVA day 0-3 only: "מוקדם מדי לקבוע מטרה." (After day 3 set a concrete goal.)

Forbidden tokens (Chameleon corrupts these): arrows (→ ← ↑ ↓), ** for bold, double-dash dividers, q8h/q6h/qd/bid notation, trailing "?", "**" anywhere. Use single ">" only for med tapers ("Lantus 22 > 10-12 יח"). Spell out: "כל 8 שעות" not "q8h", "מעל 200" not ">200". Drug names: English UPPERCASE GENERIC ( BRAND ) Route Dose Unit X Freq.
`.trim();

/**
 * Builds the optional "durable patient context" preamble that prepends the
 * SOAP system prompt when the caller has decided to seed today's draft from
 * yesterday's note via the runtime "השתמש בהערת אתמול" toggle.
 *
 * Contract:
 * - returns the empty string for any non-prefill seedContext, so callers can
 *   unconditionally concatenate.
 * - emits ONLY the patient-durable fields (handoverNote / planLongTerm /
 *   clinicalMeta) — yesterday's SOAP body itself is intentionally NOT
 *   reprinted here because `buildSoapPromptPrefix` already injects
 *   `MOST RECENT SOAP (date)` from the same `resolveContinuity` source.
 *   Re-emitting `bodyContext` here would duplicate the body in the prompt
 *   and confuse the model. (Architecture decision 2026-05-10 v1.41.0.)
 *
 * Currently `seedContext.bodyContext` therefore goes unused at runtime — it
 * remains on the SeedDecision type for future decoupling (e.g. a path that
 * uses seed without continuity). Both halves trace to the same SOAP body.
 *
 * The "do NOT copy verbatim" framing is critical for the body block (which
 * continuity prints) — the model otherwise tends to regurgitate yesterday's
 * S/vitals/labs as today's. That instruction lives in `buildSoapPromptPrefix`
 * already, so it isn't repeated here.
 */
export function buildSeedBlocks(seedContext: SeedDecision): string {
  if (seedContext.kind !== 'prefill') return '';
  return [
    '',
    "Patient durable context (use directly; do not re-derive from yesterday's prose):",
    `- handoverNote: ${seedContext.patientFields.handoverNote}`,
    `- planLongTerm: ${seedContext.patientFields.planLongTerm}`,
    `- clinicalMeta: ${JSON.stringify(seedContext.patientFields.clinicalMeta)}`,
    '',
  ].join('\n');
}

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
   בסעיף ריבוי תרופות, כל תרופה מופיעה פעם אחת בלבד.
9. הרגלים: "מעשן: לא / שימוש באלכוהול: לא / שימוש בסמים: לא".
10. תפקוד: STRUCTURED subsection (per Salaymeh 29/04/26 print), label: value lines in this exact order, NO prose:
    מגורים: בבית / בבית אבות / מוסד סיעודי
    עזרה: עצמאי / עזרת משפחה / עזרת מטפלת זרה / מטפלת ישראלית
    התמצאות: שמורה / דמנציה / חלקית
    הזנה: כלכלה רגילה פומית / טחונה / IDDSI N / PEG / NG
    הלבשה: עצמאי / עזרה חלקית / עזרה מלאה
    רחצה: עצמאי / עזרה חלקית / עזרה מלאה
    אכילה: עצמאי / עזרה חלקית / עזרה מלאה
    הכנת אוכל: עצמאי / עזרה חלקית / עזרה מלאה
    ניידות: עצמאי / עזרה חלקית / עזרה מלאה
    ניידות בכיסא גלגלים: עצמאי / עזרה חלקית / עזרה מלאה
    מעברים: עצמאי / עזרה חלקית / עזרה מלאה
    שליטה על שתן: עצמאי / עזרה חלקית / עזרה מלאה
    שליטה על יציאה: עצמאי / עזרה חלקית / עזרה מלאה
    All 9 ADL items use ONLY the 3-tier grade עצמאי / עזרה חלקית / עזרה מלאה. NEVER use MRS in admission. Include all items even if עצמאי throughout (signals you assessed).
11. בדיקה גופנית: vitals + systems. Short positives/negatives.
12. בדיקות עזר: raw cultures + imaging reports verbatim.
13. בדיקות מעבדה: short prose trends only ("CRP בקבלה 12.3, ירד ל-9.8"). NO arrows, NO ">" — Chameleon corrupts these. Strip H/L suffixes — use "(מעל/מתחת לנורמה)" parens.
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
1. אבחנות פעילות: ACUTE ADMIT REASON ONLY (chronic items go to ברקע). English UPPERCASE with modifier where applicable (- Resolved, , Recurrent, M/P). If patient received blood transfusion this admission, include "BLOOD TRANSFUSION X N units".
2. ניתוחים באשפוז: NGT / urinary catheter / PEG insertion or removal events ONLY, with dates. SKIP peripheral IV (עירוי פריפרי) — gets stripped in print. Omit the section entirely if no qualifying events.
3. אבחנות ברקע: chronic, English UPPERCASE. אבחנות בעבר are pre-populated from prior admissions — audit for duplicates/staleness, don't auto-delete; EMR merges בעבר into ברקע in print.
4. רגישויות: list with reactions, or "לא ידוע".
5. תרופות בבית: SZMC format, pre-admission meds, Title Case (Chameleon DB).
6. הצגת החולה: single line.
7. תלונה עיקרית: 1-2 lines.
8. מחלה נוכחית: this field APPENDS to the admission text in Chameleon — you are providing an AUDITED, FIXED version of the existing admission paragraph (typo correction, voice-rec error fix, missing info added). Doctor pastes this OVER the old text as a retro-fix. Full narrative.
9. רקע רפואי: "פרוט מחלות:" (organ-system) + "אבחנות בעבר:" (English UPPERCASE).
10. הרגלים.
11. בדיקה גופנית בקבלה: vitals + systems from admission.
12. בדיקות עזר (פירוט): cultures + imaging together, key findings only, BEFORE labs. Dates OK. NEVER include reporting doctor names, accession numbers, or specimen IDs (מספר בדיקה).
13. בדיקות מעבדה: CATEGORIZED PROSE TRENDS ONLY. Sub-headers per system: "ביוכימיה:", "מדדי דלקת:", "ספירת דם:", "גזים:". Trend pattern: "X בקבלה היה N, במהלך האשפוז M, בשחרור P". MAX 3 numeric values per parameter. NO arrows, NO ">" symbol (Chameleon corrupts these in lab context). Drop eGFR + BUN if creatinine listed (redundant). For total Ca with same-day albumin, calculate corrected Ca = Ca + 0.8 * (4.0 - Albumin) and report both. NO L/H suffix — use "(מעל הנורמה)" or "(מתחת לנורמה)" parenthetical. Full lab table auto-appends after this section.
14. מהלך ודיון: open with mandatory narrative pattern BEFORE any "#" headers:
    "בת/בן X [+ functional baseline + background summary]. עם הרקע הנ"ל -

    התקבלה בשל [presenting complaint + duration].

    במיון בבדיקת [vitals + key exam].

    במעבדה (כולל בדיקות עזר): [significant labs/imaging summary].

    ייעוצים במיון: [or "ללא ייעוצים במיון"].

    אושפזה בשל [reason] במחלקתנו.

    בקבלתה למחלקה: [arrival exam + arrival labs delta].

    במהלך אשפוז הציגה את הבעיות הבאות להתייחסות:"

    Then "#" headers per problem, disease-focused, short.
    Sequence: acute problem first > metabolic > infection > neuro > resolving > minor findings > consults.
    "# טיפול יעדי" ONLY if there is a documented decision (DNR, ceiling of care, status). Speculative GOC commentary gets cut.
    "# תפקוד" at the end.
15. המלצות בשחרור: DASH list ("- item"), NOT numbered. Each a single recommendation. Include brief PT/OT/dietician referral lines ("הפניה לפיזיותרפיה בבית (יט\"ב)", "הפניה לריפוי בעיסוק בקהילה"). DROP boilerplate: never include generic "פנייה למיון במצב החמרה" or "להביא סיכום אשפוז זה לכל פנייה רפואית עתידית" — these are filler. Each item ≤180 chars (Chameleon truncates mid-word otherwise).
16. המשך טיפול תרופתי: DASH list ("- item"), Title Case from Chameleon DB. EMR auto-numbers anyway. For PEG patients ALWAYS include "Water ( Water ) per gastrostomy 400 ml X 3 / d לפי צורך". Borderline home meds (unclear-indication PO Furosemide, statin in advanced dementia, etc.) → keep on PRN with "מינון לפי צורך, לפי החלטת רופא מטפל". NEVER deprescribe in the discharge print — that's the family physician's call. Completed ABX omitted.
17. חתימה: attending cosignature line first, then fellow's signature with מ.ר. and timestamp.
`.trim();

/**
 * Case-conference prompt — szmc-interesting-cases skill.
 * Template (not audit): 1-page case file with a fixed 6-section structure.
 * Default language is English (SZMC case conferences are in English); only
 * switch to Hebrew if the validated fields themselves signal a Hebrew request.
 * Keep sections in order; use tables for labs/imaging; abnormal values only.
 */
const CASE_STYLE = `
Case conference (מקרה מעניין / ישיבת מקרים) — 1-page case file for ward presentation.
Default language: English. Do NOT include opinions, teaching points, citations, PMIDs, or GOC commentary unless they appear in the source data.

Emit this exact 6-section structure, in order:

# [Last name] [First name], [Age][M/F] — Case Summary
**For ישיבת מקרים מעניינים — [Department]**

**Admission:** DD/MM/YYYY | **LOS:** X days | **Ward:** [X]
**Allergies:** [list or NKDA]

## 1. Who
One paragraph — age, sex, living/marital situation, functional baseline BEFORE admission, cognitive status, mobility aid, caregiver, relevant occupation/context. Mark [not provided] for any missing piece — never invent.

## 2. Background
Relevant comorbidities only — not every ICD code. Group by organ system if >4 conditions. Recent relevant workup/treatments (last 6 months).

## 3. Why they came
- **Chief complaint:** [one line]
- **Timeline:** symptom onset > ED > ward
- **ED vitals & key findings:** BP / HR / Sat / T / GCS + anything that changed triage
- **ED workup:** labs / imaging / ruled in / ruled out

## 4. What we found
Use a markdown table — Category | Key findings — with rows for: Vitals trend (if notable), Key labs (abnormal only, trends as "Ca: 12.3 > 11.6 > 9.8"), Imaging (1 line/study), Cultures (organism/sensitivity/specimen), ECG/TTE (if done), Consults (service/recommendation).

## 5. What we did
Active problems this admission — numbered list, ONE line per problem: workup done, treatment, response.
1. **[Problem]** — [workup / treatment / response]
2. **[Problem]** — [...]

## 6. Current status / disposition
- **Clinical status at presentation:** [improving / stable / deteriorating / discharged]
- **Functional status now vs baseline:** [PT assessment if available]
- **Disposition plan:** [home / rehab / hospice / long-term / still inpatient]
- **Open questions for the room:** [1-3 bullets the presenter flags — or omit the subheading if none in source]

Style: concise, tables over prose, abnormal labs only, no "teaching points" section, no NEJM headers. Drug doses inline with route ("Meropenem IV 1g q8h" is fine here — this is English case-conference, not Chameleon paste).
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

/**
 * SOAP with optional continuity context (admission + prior SOAPs).
 *
 * `mode` (added Phase C, v1.37.0): defaults to 'general' which produces
 * the pre-Phase-C output verbatim. Rehab-* modes append a small
 * augmentation block from rehabPrompts.ts at the end of the system
 * prompt — the augmentations are stubs until the rehab-quickref
 * SKILL.md lands; see rehabPrompts.ts header for the porting plan.
 */
export function buildSoapPromptPrefix(
  continuity: ContinuityContext | null,
  mode: SoapMode = 'general',
  seedContext: SeedDecision | null = null,
): string {
  const base = [CHAMELEON_RULES, SOAP_STYLE];
  const augmentation = rehabAugmentation(mode);
  const tail = augmentation ? [augmentation] : [];
  // Seed-prefix: durable patient fields (handoverNote / planLongTerm /
  // clinicalMeta) when the doctor toggled "השתמש בהערת אתמול" on Review.
  // Empty string when seedContext is null or non-prefill — non-disruptive
  // for every existing call site that doesn't pass seedContext.
  const seedPrefix = seedContext ? buildSeedBlocks(seedContext) : '';
  const seedTail = seedPrefix ? [seedPrefix] : [];

  if (!continuity || (!continuity.admission && continuity.priorSoaps.length === 0)) {
    return [
      'Emit a SOAP note in Hebrew.',
      "First SOAP for this patient — anchor the Assessment one-liner on today's chief complaint + PMH + age/sex.",
      ...base,
      ...tail,
      ...seedTail,
    ].join('\n\n');
  }

  const admBlock = continuity.admission
    ? `ADMISSION (${fmtDate(continuity.admission.createdAt)}):\n${continuity.admission.bodyHebrew}`
    : '';

  if (continuity.mostRecentSoap) {
    const soapBlock = `MOST RECENT SOAP (${fmtDate(continuity.mostRecentSoap.createdAt)}):\n${continuity.mostRecentSoap.bodyHebrew}`;
    return [
      'Emit a SOAP note in Hebrew — follow-up for an existing admission episode.',
      'No capsule — capsule appeared in the first SOAP after admission and does not repeat. Open A with a one-line synthesis ("בשיקום לאחר X — מתקדם/יציב/החמרה ב-Y"), then *domain bullets directly.',
      'For each *domain bullet from the prior SOAP, track the trajectory vs today:',
      '- Same: "ללא שינוי משמעותי"',
      '- Changed: show the delta using a single ">" (e.g. "Cr: 2.1 > 1.8", "Apixaban הופסק", "חום 39.2 > afebrile")',
      '- Resolved: mark "נפתר"',
      '- New: add under the right *domain',
      '',
      '---',
      admBlock,
      '',
      soapBlock,
      '---',
      '',
      ...base,
      ...tail,
      ...seedTail,
    ].join('\n');
  }

  return [
    'Emit a SOAP note in Hebrew — first SOAP after admission. This is the patient\'s first daily round in the dept.',
    'A opens with the SZMC patient capsule (3-4 lines) per the format in SOAP_STYLE below. Pull demographics, marital/parent count, living situation, baseline ADL/mobility, and active problems from the admission note. Then "בעיות:" introducing problem bullets per *domain (*אורתופדית / *זיהומית / *תפקודית / *עצמות / etc.). Do not restate the full admission.',
    '',
    '---',
    admBlock,
    '---',
    '',
    ...base,
    ...tail,
    ...seedTail,
  ].join('\n');
}

export function buildPromptPrefix(
  noteType: NoteType,
  continuity: ContinuityContext | null,
  soapMode: SoapMode = 'general',
  seedContext: SeedDecision | null = null,
): string {
  switch (noteType) {
    case 'soap':
      return buildSoapPromptPrefix(continuity, soapMode, seedContext);
    case 'admission':
      return [CHAMELEON_RULES, ADMISSION_STYLE].join('\n\n');
    case 'discharge':
      return [CHAMELEON_RULES, DISCHARGE_STYLE].join('\n\n');
    case 'consult':
      return [CHAMELEON_RULES, CONSULT_STYLE].join('\n\n');
    case 'case':
      // case-conference notes use szmc-interesting-cases skill. English-by-default
      // template; Chameleon paste rules still apply as a hedge (in case the user
      // requests Hebrew — the same arrow/bold/qNh landmines can still ride in).
      return [CHAMELEON_RULES, CASE_STYLE].join('\n\n');
    case 'census':
      // Census never reaches this path — generateNote is not called for
      // census records. Return an empty prefix as a defensive default.
      return '';
  }
}

/**
 * Hard safety guard: detect extract outputs that are obviously corrupted
 * before we let them reach the emit turn. An emit on bad identifiers
 * produces a wrong-patient clinical note — that failure mode is worse
 * than a noisy refusal.
 *
 * Thrown message is shown to the user; keep it Hebrew and actionable.
 *
 * Rules (each triggers a block on its own):
 *   1. `name` matches a known SZMC-geriatrics DOCTOR name. These appear
 *      in the top-left AZMA title strip and are the #1 vision trap.
 *      Keep this list tight — it's a hard block, so false positives are
 *      expensive. Add names only when a real miscapture is observed.
 *   2. `teudatZehut` is a Chameleon internal patient code (starts with
 *      ^p\d+$), not a 9-digit Israeli ID.
 *   3. Critical-identifier confidence of "low" on name or age for a
 *      note type that will paste into Chameleon. SOAP/admission/discharge/
 *      consult all go through Chameleon — case-conference notes are
 *      English-language handouts that Eias reviews visually and are
 *      exempt from this gate.
 *
 * The doctor-name matcher uses substring containment against NFC-normalized,
 * whitespace-collapsed input so "אשרב  איאס" (two spaces) and "אשרב איאס,"
 * both match "אשרב איאס". It is not a full name-parser — the goal is to
 * catch the specific capture pattern ("Eitan 4 <doctor> <pcode>" read as
 * the patient card), not to enforce a universal name blacklist.
 */
const KNOWN_SZMC_DOCTOR_NAMES = [
  'אשרב איאס',
  'אבו זיד גיהאד',
  'אסלן אורי',
  'אחמרו מאלק',
] as const;

const CHAMELEON_PATIENT_CODE_RE = /^p\d{3,}$/i;

export class ExtractCapturedDoctorError extends Error {
  constructor(public readonly capturedName: string) {
    super(
      `זוהה שם רופא במקום שם מטופל (${capturedName}). כנראה צולמה שורת הכותרת של AZMA במקום כרטיס המטופל. צלם שוב עם כרטיס המטופל בפריים.`,
    );
    this.name = 'ExtractCapturedDoctorError';
  }
}

export class ExtractCapturedPatientCodeError extends Error {
  constructor(public readonly code: string) {
    super(
      `זוהה קוד מטופל פנימי (${code}) במקום תעודת זהות. ת.ז. ישראלית חייבת להיות 9 ספרות. בדוק שכרטיס המטופל בפריים, לא רק שורת הכותרת.`,
    );
    this.name = 'ExtractCapturedPatientCodeError';
  }
}

export class ExtractLowConfidenceError extends Error {
  constructor(public readonly fields: readonly string[]) {
    super(
      `ביטחון נמוך בזיהוי (${fields.join(', ')}). מסוכן להפיק רשומה קלינית מערכים לא ודאיים — תקן ידנית או צלם מחדש.`,
    );
    this.name = 'ExtractLowConfidenceError';
  }
}

function normalizeForNameMatch(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function assertExtractIsSafe(
  noteType: NoteType,
  validated: ParseResult,
): void {
  // 1. Doctor-name capture.
  const rawName = validated.fields.name;
  if (rawName && typeof rawName === 'string') {
    const normName = normalizeForNameMatch(rawName);
    for (const doc of KNOWN_SZMC_DOCTOR_NAMES) {
      if (normName.includes(doc)) {
        throw new ExtractCapturedDoctorError(rawName);
      }
    }
  }

  // 2. Chameleon patient-code mistake.
  const tz = validated.fields.teudatZehut?.trim();
  if (tz && CHAMELEON_PATIENT_CODE_RE.test(tz)) {
    throw new ExtractCapturedPatientCodeError(tz);
  }

  // 3. Low-confidence critical identifier gate — Chameleon-bound notes only.
  if (noteType !== 'case') {
    const low: string[] = [];
    if (validated.confidence['name'] === 'low') low.push('שם');
    if (validated.confidence['age'] === 'low') low.push('גיל');
    if (low.length > 0) {
      throw new ExtractLowConfidenceError(low);
    }
  }
}

export async function generateNote(
  noteType: NoteType,
  validated: ParseResult,
  continuity: ContinuityContext | null = null,
  soapMode: SoapMode = 'general',
  abortSignal?: AbortSignal,
  seedContext: SeedDecision | null = null,
): Promise<string> {
  assertExtractIsSafe(noteType, validated);

  const skills = NOTE_SKILL_MAP[noteType];
  const skillContent = await loadSkills([...skills]);

  // soapMode is consulted only for noteType === 'soap'. Other note types
  // pass through buildPromptPrefix's default and the mode is silently
  // ignored — keeping the signature uniform across note types lets the
  // UI hand the same `mode` to generateNote regardless of the type the
  // user is actually generating.
  // seedContext: the runtime "השתמש בהערת אתמול" toggle on Review feeds
  // a SeedDecision through here so the SOAP prompt can include the
  // patient's durable context (handoverNote / planLongTerm / clinicalMeta).
  // null preserves the v1.40.x behavior — only the new toggle path
  // populates this argument.
  const prefix = buildPromptPrefix(noteType, continuity, soapMode, seedContext);
  const systemWithPrefix = `${skillContent}\n\n---\n\n${prefix}`;

  // abortSignal: Phase E batch driver passes its AbortController so a
  // mid-batch cancel propagates through both extract + emit calls.
  const raw = await runEmitTurn(
    noteType,
    validated.fields,
    systemWithPrefix,
    abortSignal,
  );
  return wrapForChameleon(raw);
}
