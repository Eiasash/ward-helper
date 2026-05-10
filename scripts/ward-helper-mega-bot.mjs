#!/usr/bin/env node
/**
 * ward-helper-mega-bot — N-persona parallel chaos runner.
 *
 * Spawns 5-10 doctor personas in parallel browser contexts on iPhone 13
 * emulation, each running a continuous action loop for `WARD_BOT_DURATION_MS`
 * (default 30 min). Personas pick weighted-random scenarios + chaos
 * injectors per tick. Recovery layer absorbs misclicks and stuck states.
 * Aggregated bug report at the end.
 *
 * To run:
 *   WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed WARD_BOT_FIXTURE=1 \
 *     CHAOS_EXECUTABLE_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \
 *     node scripts/ward-helper-mega-bot.mjs
 *
 * Env vars:
 *   WARD_BOT_FIXTURE=1            — skip Opus, use hardcoded scenario per persona
 *   WARD_BOT_PERSONAS=5           — number of parallel personas (default 5, max 10)
 *   WARD_BOT_DURATION_MS=1800000  — total wall time (default 30 min)
 *   WARD_BOT_PERSONA_LIST=...     — comma-separated keys, overrides default rotation
 *   CHAOS_COST_CAP_USD=50         — hard ceiling on Opus spend
 *   CHAOS_HEADLESS=1              — headless (default true)
 *   CHAOS_EXECUTABLE_PATH=...     — system Chrome path on Windows
 */

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PERSONAS, runPersona } from './lib/megaPersona.mjs';
import { writePatientGallery } from './lib/patientChart.mjs';
import { CostTracker, generateScenarioOpus } from './lib/scenarioGen.mjs';

// ============================================================================
// Authorization gate
// ============================================================================

if (process.env.WARD_BOT_RUN_AUTHORIZED !== 'yes-i-reviewed') {
  console.error('═══════════════════════════════════════════════════════════════');
  console.error(' ward-helper-mega-bot: REFUSING TO RUN.');
  console.error(' Set WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed to authorize.');
  console.error(' This bot runs 5-10 personas in parallel for 30 min by default.');
  console.error('═══════════════════════════════════════════════════════════════');
  process.exit(2);
}

const FIXTURE_MODE = process.env.WARD_BOT_FIXTURE === '1';
const KEY = process.env.CLAUDE_API_KEY;

if (!FIXTURE_MODE) {
  if (!KEY) { console.error('CLAUDE_API_KEY not set (or WARD_BOT_FIXTURE=1 to skip)'); process.exit(2); }
  if (KEY.length !== 108) {
    console.error(`CLAUDE_API_KEY length=${KEY.length}, expected 108`);
    process.exit(2);
  }
}

// ============================================================================
// Config
// ============================================================================

const CONFIG = {
  url: process.env.WARD_BOT_URL || 'https://eiasash.github.io/ward-helper/',
  personas: Math.min(10, Math.max(1, Number(process.env.WARD_BOT_PERSONAS || 5))),
  durationMs: Number(process.env.WARD_BOT_DURATION_MS || 1800000),
  costCapUsd: Number(process.env.CHAOS_COST_CAP_USD || 50),
  reportDir: process.env.CHAOS_REPORT_DIR || 'chaos-reports/ward-bot-mega',
  headless: process.env.CHAOS_HEADLESS !== '0',
  executablePath: process.env.CHAOS_EXECUTABLE_PATH || undefined,
  personaList: (process.env.WARD_BOT_PERSONA_LIST || '').split(',').filter(Boolean),
};

const RUN_ID = `wm-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const REPORT_PATH = path.resolve(CONFIG.reportDir, `${RUN_ID}.md`);
const TIMELINE_PATH = path.resolve(CONFIG.reportDir, `${RUN_ID}-timeline.jsonl`);

const BUGS = [];
const TIMELINE = [];

// ============================================================================
// Logging
// ============================================================================

function logBug(severity, scenario_id, where, what, evidence) {
  const bug = { severity, scenario_id, where, what, evidence, at: new Date().toISOString() };
  BUGS.push(bug);
  // Don't spam stdout with every LOW — just CRIT/HIGH.
  if (severity === 'CRITICAL' || severity === 'HIGH') {
    console.warn(`[BUG/${severity}] ${where}: ${what}`);
  }
}

function nowIso() { return new Date().toISOString(); }

// ============================================================================
// Rich fixture scenarios — full multi-day charts so the gallery looks like
// real ward patients. Every identifier is fictitious; tz checksums are
// intentionally invalid (Israeli MOH algorithm).
// ============================================================================

const FIXTURE_PATIENTS = [
  {
    name_he: 'אסתר כהן-לוי', tz: '111111111', age: 84, sex: 'F', room: '12', bed: 'A',
    cc: 'בת 84, ירידה בתפקוד וחום נמוך 48 שעות, חשד ל-UTI עם דליריום ו-AKI prerenal.',
    adm: {
      S: 'בת 84, גרה עם בעלה בדירת 2 חדרים, עצמאית בעבר ב-ADL. בני המשפחה מדווחים על ירידה בערנות מ-48 שעות, חוסר תיאבון, חולשה כללית. ללא כאבי חזה, ללא קוצר נשימה. שתן עכור לפי הבעל. PMH: HTN, DM2, OA, חסר ויטמין B12. תרופות בבית: Amlodipine 5mg PO qd, Metformin 500mg bid, Eltroxin 50mcg qd, B12 1000mcg IM monthly.',
      O: 'BP 132/74, HR 98, T 37.9, SpO2 96% RA, RR 18. ערה אך מבולבלת לזמן ולמקום (CAM positive). מוקוזות יבשות. ריאות נקיות בילטרלית. בטן רכה ללא רגישות. CVA tenderness שמאל +. גפיים: ללא בצקת, פולסים תקינים. עור: ללא פצעי לחץ. Labs: WBC 14.7 (neutrophils 86%), Hb 11.2, Plt 248, Na 132, K 4.1, Cr 1.6 (baseline 0.9), BUN 42, CRP 112, glucose 148, urinalysis: leukocytes 3+, nitrites positive, RBC 2-3, WBC >50/HPF.',
      A: '1) UTI עם דליריום ב-84yo. 2) AKI prerenal על רקע התייבשות (FENa<1%, BUN/Cr 26). 3) חולשה כללית, ירידה בתפקוד.',
      P: 'אשפוז במחלקה גריאטרית. Ceftriaxone 1g IV q24h x7d (לאחר תרבית). Hydration NS 1.5L/day, monitor I/O. Hold Metformin עד שיפור Cr. Reassess Cr q24h. CAM screening q-shift. PT/OT consult. Geriatric assessment. Foley לזמן קצר אם ניטור I/O נדרש.',
    },
    soap: [
      { day: 2, S: 'אכלה ארוחת בוקר. פחות מבולבלת. אומרת שהיא בבית חולים.', O: 'T 37.2, BP 124/70, HR 88, SpO2 97%. ערה ומגיבה. WBC 11.8, Cr 1.3, CRP 84. תרבית שתן: E. coli sensitive ל-Ceftriaxone.', A: '1) UTI — משפר. 2) AKI — משפר.', P: 'המשך Ceftriaxone, יום 2/7. Hydration. PT.' },
      { day: 3, S: 'ישנה לילה טוב. אוכלת היטב. שמח לראות נכדה.', O: 'T 36.8, BP 128/72, HR 78, SpO2 98%. ערנות מלאה, CAM שלילי. Cr 1.0, WBC 9.2, CRP 42.', A: 'משופר משמעותית.', P: 'Step-down ל-Cefuroxime 500mg PO bid x5d נוספים. תכנון שחרור.' },
      { day: 4, S: 'מבקשת ללכת הביתה. עצמאית במקלחת. ADL בסיסי 6/6.', O: 'T 36.6, BP 126/68, ערה ומכוונת. PT report: עצמאית ב-ambulation, מטיילת במסדרון 60m.', A: 'מוכנה לשחרור.', P: 'שחרור היום עם Cefuroxime PO. הסבר על שתייה מספקת.' },
    ],
    consults: [
      { from: 'גריאטריה', to: 'אורולוגיה', body: 'בת 84 עם UTI חוזר (3-rd episode השנה), מבקשים הערכה לחסימה תחתונה / VUR. אנא ביצוע bladder ultrasound ו-PVR. תודה.' },
    ],
    dis: {
      summary: 'אשפוז של 4 ימים בשל UTI עם דליריום ו-AKI prerenal על רקע התייבשות. השתפרה לחלוטין עם Ceftriaxone IV → Cefuroxime PO + Hydration. CAM שלילי בשחרור. ADL חוזר ל-baseline.',
      meds_at_discharge: 'Cefuroxime 500mg PO bid x3 ימים נוספים. Pantoprazole 20mg PO qd. Atorvastatin 20mg PO qhs. Eltroxin 50mcg PO qd. Metformin 500mg bid (התחילה מחדש לאחר Cr חזר ל-baseline). Amlodipine 5mg PO qd.',
      follow_up: 'מרפאת גריאטריה 2 שבועות. תרבית שתן ביקורת בעוד 6 שבועות. הפניית אורולוגיה (consult report בתיק).',
    },
  },
  {
    name_he: 'יעקב אברהם', tz: '222222220', age: 78, sex: 'M', room: '15', bed: 'B',
    cc: 'בן 78 עם CHF NYHA III, התקבל עם דקומפנסציה — קוצר נשימה הולך ומתגבר ובצקת ברגליים.',
    adm: {
      S: 'בן 78, עם CHF EF 30% (HFrEF, ischemic), מטופל בקרדיולוגיה. השבועיים האחרונים: עליה במשקל 4kg, קוצר נשימה במאמץ קל (2 קומות → 1 קומה), אורתופנאה (משתמש ב-3 כריות). ללא כאבי חזה. PMH: CAD s/p CABG x3 (2018), DM2, HTN, CKD3 (baseline Cr 1.6). תרופות: Furosemide 40mg PO bid, Bisoprolol 5mg qd, Sacubitril/Valsartan 49/51 bid, Spironolactone 25mg qd, Aspirin 100mg, Atorvastatin 80mg, Metformin 1g bid.',
      O: 'BP 142/88, HR 102 irregular, T 36.6, SpO2 91% RA → 95% on 2L. JVP 12cm. ריאות: rales bilateral basal זה לזה. S3 gallop. בצקת 3+ עד הברכיים. Labs: Hb 12.1, BUN 56, Cr 2.1, K 4.8, Na 134, BNP 2840, troponin negative, glucose 178. ECG: AFib RVR 102, no acute ST changes. CXR: cardiomegaly, pulmonary venous congestion, bilateral pleural effusions.',
      A: '1) Acute decompensated heart failure (NYHA IV in flare). 2) New-onset AFib RVR. 3) Acute on chronic kidney injury (Cr 2.1 vs baseline 1.6).',
      P: 'אשפוז במחלקה גריאטרית. Furosemide 80mg IV bid (target net negative 1-2L/day). Daily weights, strict I/O. Telemetry. Rate control: Metoprolol 5mg IV → po. Hold Sacubitril/Valsartan עד יציבות Cr. Echo ביקורת. Cardiology consult.',
    },
    soap: [
      { day: 2, S: 'יותר נוח, ישן בכרית אחת. ירידה במשקל 1.8kg.', O: 'BP 128/76, HR 78 (sinus), SpO2 96% RA. JVP 8cm. רעלים בסיסיים בלבד. Cr 1.9, K 4.6, BNP 1820.', A: '1) HF — משפר. 2) AFib — converted to sinus.', P: 'המשך Lasix 80mg IV bid. הוספת Bisoprolol 2.5mg.' },
      { day: 3, S: 'מצוין. הולך עצמאית במסדרון.', O: 'משקל 76 (קבלה 80). BP 122/72, HR 70 sinus. ריאות נקיות. Cr 1.7.', A: 'יציב.', P: 'Step-down ל-Furosemide 40mg PO bid. החזרת Sacubitril/Valsartan במינון מופחת 24/26.' },
      { day: 4, S: 'מתכונן לשחרור. הסבר על משקל יומי + מגבלת מלח.', O: 'משקל יציב 76kg. BP 126/74. ECG: sinus 68bpm.', A: 'מוכן לשחרור.', P: 'שחרור עם prescription מלא + נספח חינוכי על HF self-care.' },
    ],
    consults: [
      { from: 'גריאטריה', to: 'קרדיולוגיה', body: 'בן 78 עם HFrEF EF 30% במחלקה עם דקומפנסציה ו-AFib חדש. בקשה להערכת אופטימיזציה של GDMT לאחר יציבות + שיקול ICD/CRT (QRS 156). תודה.' },
    ],
    dis: {
      summary: 'אשפוז של 4 ימים בשל ADHF + new AFib RVR. הגיב ל-Furosemide IV עם איזון נוזלים ושיפור פונקציה. AFib המיר ל-sinus rhythm ספונטנית. כעת compensated NYHA II. הומלץ אופטימיזציה של GDMT במרפאה.',
      meds_at_discharge: 'Furosemide 40mg PO bid. Metoprolol succinate 25mg qd (חדש — החליף Bisoprolol). Sacubitril/Valsartan 24/26 bid (downtitrated). Spironolactone 25mg qd. Aspirin 100mg qd. Atorvastatin 80mg qhs. Metformin 500mg bid (downtitrated). Pantoprazole 20mg qd.',
      follow_up: 'מרפאת קרדיולוגיה תוך שבועיים. שקילה יומית — להגיע לחדר מיון אם עליה >2kg ב-3 ימים. NYHA self-monitoring.',
    },
  },
  {
    name_he: 'שרה בן-דוד', tz: '333333339', age: 91, sex: 'F', room: '20', bed: 'A',
    cc: 'בת 91 עם נפילה בבית ושבר עורקי-צוואר ירך ימין, post-op ORIF יום 3 — מעברת לגריאטריה.',
    adm: {
      S: 'בת 91, גרה עם בת בקומה השנייה. נפילה בעלייה במדרגות. ללא LOC. נלקחה לחדר מיון, אובחן intertrochanteric fracture R, נותחה (DHS) לפני 3 ימים. Post-op ללא סיבוכים, מבקשים העברה לגריאטריה לצורך rehabilitation. PMH: HTN, OA, חרשות חלקית, demensia mild (MMSE 24/30). תרופות: Amlodipine 5mg, Donepezil 5mg, Vitamin D 1000IU, Calcium 600mg.',
      O: 'BP 128/72, HR 78, T 36.7, SpO2 97% RA. ערה ומגיבה, מבולבלת קלות (CAM negative). חתך ניתוחי R hip — נקי, ללא דלקת. ירך ימין: כאבים VAS 4/10 עם תרופה. גפיים: ללא DVT signs, drains הוסרו. דיסטל neuro intact. Hb 9.8 (drop from 11.2 pre-op), WBC 8.4, Cr 0.9.',
      A: '1) S/p ORIF intertrochanteric Fx R hip post-op day 3. 2) Anemia post-op (Hb 9.8) — hemodilution + blood loss. 3) Mild dementia. 4) Risk factors: עליה ל-rehabilitation + sarcopenia + osteoporosis.',
      P: 'PT 2x/day — toe-touch weight-bearing R, advance as tolerated. Pain: Paracetamol 1g qid scheduled + PRN morphine 2.5mg SC. DVT prophylaxis: Enoxaparin 40mg SC qd x14d. Multivitamin + Vitamin D + Calcium. Hb monitor q3d, transfuse if <8 או symptomatic. Consult: Rehabilitation, social worker, dietician.',
    },
    soap: [
      { day: 2, S: 'אומרת שהכאב נסבל. רוצה לאכול יותר. PT עזרה לשבת.', O: 'BP 124/70, T 36.5, SpO2 97%. PT report: tolerated 2 sessions, sit-to-stand x3 with walker.', A: 'מתקדמת.', P: 'המשך PT 2x/day. הוספת dietary protein supplement.' },
      { day: 3, S: 'הולכת 5 צעדים עם walker.', O: 'Hb 9.5 (יורד טיפה אך yet asymptomatic). BP 128/74.', A: 'התקדמות בתפקוד, anemia יציבה אסימפטומטית.', P: 'המשך תכנית. Iron sulfate 325mg PO qd. דיון על אופי ה-rehabilitation עם משפחה.' },
      { day: 5, S: 'הולכת 30m במסדרון עם walker.', O: 'Hb 9.7 (התייצב). VAS 2/10. ADL: לבוש עצמאי, מקלחת בעזרה.', A: 'התקדמות מצוינת.', P: 'תכנון העברה ל-rehabilitation מוסדי / שיקום בקהילה לפי החלטת משפחה.' },
      { day: 7, S: 'מוכנה. בת מצטרפת היום לתכנון.', O: 'יציבה. הולכת 50m ללא הפסקה.', A: 'מוכנה לשחרור.', P: 'שחרור לרהביליטציה מוסדית — בית אבות שיקומי. דוח מפורט בתיק.' },
    ],
    consults: [
      { from: 'גריאטריה', to: 'אנדוקרינולוגיה', body: 'בת 91 לאחר Fx ירך עם FRAX score גבוה. מבקשים שיקול לטיפול אנטי-אוסטאופורוטי (DXA לפני שנה: T-score -3.1 ב-spine). שאלה: Denosumab vs Zoledronate. תודה.' },
      { from: 'גריאטריה', to: 'גריאטריה — ועדה רב-תחומית', body: 'בת 91 עם dementia + post-fall + post-op. מבקשים הערכה רב-תחומית לתכנון discharge: בית אבות שיקומי vs בית עם care-giver. שיתוף בני משפחה.' },
    ],
    dis: {
      summary: 'אשפוז גריאטרי של 7 ימים לאחר ORIF intertrochanteric Fx R hip. PT אינטנסיבי, התקדמה לעצמאות חלקית עם walker. Anemia post-op יציבה ללא צורך בעירוי. הוחלט על שחרור לרהביליטציה מוסדית בהתאם לרצון המשפחה.',
      meds_at_discharge: 'Paracetamol 1g qid x14d. Enoxaparin 40mg SC qd x10d נוספים. Iron sulfate 325mg PO qd. Vitamin D 1000IU. Calcium 600mg bid. Amlodipine 5mg qd. Donepezil 5mg qd. Pantoprazole 20mg qd. Denosumab 60mg SC q6mo (התחיל היום).',
      follow_up: 'מעקב במרפאת גריאטריה תוך 4-6 שבועות. אורתופדיה לביקורת רנטגן בעוד 6 שבועות. ועדת קביעת רשות שיקום מוסדי (טופס בתיק).',
    },
  },
  // 7 more ...
  {
    name_he: 'דוד רוזנברג', tz: '444444448', age: 73, sex: 'M', room: '23', bed: 'B',
    cc: 'בן 73 עם AKI על רקע התייבשות + sepsis ממקור urinary, בריא יחסית בעבר.',
    adm: {
      S: 'בן 73, פעיל, היה בחופשה במזרח התיכון לפני שבוע. שלשולים 5 ימים, חום, חולשה. חזר לארץ אתמול, היום הגיע לחדר מיון עם הכרה ירודה ויובש. PMH: HTN, BPH (Tamsulosin). חיסונים מעודכנים.',
      O: 'BP 90/55, HR 118, T 38.9, SpO2 96% RA, RR 24. ישנוני, מגיב לקול. מוקוזות יבשות מאוד. בטן רכה. ללא בצקת. Labs: WBC 18.4, lactate 3.8, Cr 2.4 (baseline 1.0), BUN 78, Na 148, K 3.2, glucose 142, CRP 218, urinalysis: nitrites+, leukocytes 3+, RBC 2-3.',
      A: '1) Severe sepsis — urosepsis with AKI. 2) Hypovolemia + hypernatremia. 3) Mild hypokalemia.',
      P: 'IV bolus NS 30mL/kg → maintenance. Empiric Pip-Tazo 4.5g IV q8h. Blood + urine cultures. q4h vitals + lactate q6h. Foley with strict I/O. Reassess fluid status q6h.',
    },
    soap: [
      { day: 2, S: 'יותר ערני. הצליח לשתות.', O: 'BP 110/68, HR 92, T 37.8. lactate 1.6, Cr 1.7, Na 142. urinalysis: שיפור.', A: 'sepsis — מגיב לטיפול.', P: 'המשך Pip-Tazo. Cultures: E. coli sensitive ל-Cefepime. step-down ל-Cefepime 1g IV q12h.' },
      { day: 4, S: 'מצוין. אוכל היטב.', O: 'BP 124/74, HR 76, T 36.7. WBC 8.2, Cr 1.1.', A: 'recovered.', P: 'PO step-down: Ciprofloxacin 500mg bid x5d (עד השלמת קורס סה"כ 14d).' },
    ],
    consults: [],
    dis: {
      summary: 'אשפוז של 4 ימים עם urosepsis + AKI טרום-כלייתי. תגובה מהירה לטיפול עם Pip-Tazo IV ו-IV fluids. Cr חזר ל-baseline. שוחרר במצב טוב להמשך Ciprofloxacin PO.',
      meds_at_discharge: 'Ciprofloxacin 500mg PO bid x5d נוספים. Tamsulosin 0.4mg qhs. Hydration encouragement. Probiotic.',
      follow_up: 'מרפאה תוך שבועיים. ביקורת תרבית שתן בעוד 6 שבועות.',
    },
  },
  {
    name_he: 'רחל שטרן', tz: '555555557', age: 86, sex: 'F', room: '8', bed: 'A',
    cc: 'בת 86 עם דליריום על רקע sepsis ממקור pulmonary — pneumonia.',
    adm: {
      S: 'בת 86 בבית עם בני משפחה, עצמאית חלקית. שיעול ופלגם 3 ימים, חום מאתמול, היום בלבול ויקיצות. PMH: HTN, hypothyroidism, OA, mild cognitive impairment. תרופות: Eltroxin, Atenolol, Acetaminophen PRN.',
      O: 'BP 100/62, HR 110, T 38.7, SpO2 92% RA → 96% on 2L. מבולבלת לזמן ולמקום (CAM+). ריאות: crackles RUL + RLL. Labs: WBC 16.8, Hb 12.4, Cr 1.0, lactate 2.4, CRP 184, procalcitonin 4.2. CXR: RUL + RLL consolidation.',
      A: '1) CAP severe (CURB-65 = 3) with delirium. 2) Sepsis with pulmonary source.',
      P: 'Ceftriaxone 1g IV qd + Azithromycin 500mg IV qd. O2 לטרגט SpO2 ≥94%. Atypical coverage. CAM screening q-shift. Hold Atenolol עד יציבות. Hydration. Consider transfer to ICU if שיכרון.',
    },
    soap: [
      { day: 2, S: 'יותר ערה. SpO2 שיפור.', O: 'BP 116/70, T 37.5, SpO2 96% RA. WBC 12.4, lactate 1.3.', A: 'משפר.', P: 'המשך אנטיביוטיקה. Step-down ל-RA פעם השלישית.' },
      { day: 4, S: 'הכרה מלאה (CAM neg).', O: 'T 36.8, SpO2 97%. CXR: ריזולוציה חלקית.', A: 'recovered מ-delirium, recovering מ-pneumonia.', P: 'PO step-down ל-Amoxicillin/Clavulanate 875/125 bid. תכנון שחרור.' },
      { day: 5, S: 'מבקשת לחזור הביתה.', O: 'יציבה. ADL חזר.', A: 'מוכנה לשחרור.', P: 'שחרור עם PO antibiotics להמשך 3-5 ימים.' },
    ],
    consults: [],
    dis: {
      summary: 'אשפוז של 5 ימים עם CAP + delirium ב-86yo. הגיבה לטיפול אנטיביוטי IV. Delirium reversible. ADL חזר ל-baseline.',
      meds_at_discharge: 'Amoxicillin/Clavulanate 875/125 PO bid x5d. Eltroxin 50mcg qd. Atenolol 25mg qd (חזר). Pantoprazole 20mg.',
      follow_up: 'מרפאה תוך 7 ימים. CXR ביקורת בעוד 4-6 שבועות.',
    },
  },
];

// Pad to 10 with synthetic short variants if needed.
while (FIXTURE_PATIENTS.length < 10) {
  const base = FIXTURE_PATIENTS[FIXTURE_PATIENTS.length % 5];
  FIXTURE_PATIENTS.push({
    ...base,
    name_he: base.name_he + ' (II)',
    tz: String((Number(base.tz) + 1) % 1e9).padStart(9, '0'),
    room: String((Number(base.room) + 1)),
  });
}

function fixtureScenarioFor(personaIdx, personaKey) {
  const p = FIXTURE_PATIENTS[personaIdx % FIXTURE_PATIENTS.length];
  return {
    scenario_id: `mega-${RUN_ID}-${personaIdx}`,
    demographics: { name_he: p.name_he, tz: p.tz, age: p.age, sex: p.sex, room: p.room, bed: p.bed },
    chief_complaint: p.cc,
    admission_note: p.adm,
    soap_rounds: p.soap || [],
    consult_letters: p.consults || [],
    discharge_letter: p.dis,
    _persona_idx: personaIdx,
    _persona: personaKey,
  };
}

// ============================================================================
// Default persona rotation
// ============================================================================

const DEFAULT_PERSONA_ROTATION = [
  'speedrunner', 'methodical', 'misclicker', 'multitasker',
  'keyboardWarrior', 'batterySaver', 'unicodeChaos',
  'speedrunner', 'misclicker', 'multitasker',  // repeat top 3 for 8-10 count
];

function pickPersonaKeys(n) {
  if (CONFIG.personaList.length > 0) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(CONFIG.personaList[i % CONFIG.personaList.length]);
    }
    return out;
  }
  return DEFAULT_PERSONA_ROTATION.slice(0, n);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  await fs.mkdir(CONFIG.reportDir, { recursive: true });
  console.log(`ward-helper-mega-bot — ${RUN_ID}`);
  console.log(`  url=${CONFIG.url}`);
  console.log(`  personas=${CONFIG.personas} duration=${(CONFIG.durationMs / 60000).toFixed(1)}min`);
  console.log(`  cost-cap=$${CONFIG.costCapUsd} fixture=${FIXTURE_MODE}`);
  console.log(`  headless=${CONFIG.headless} report=${REPORT_PATH}`);

  const launchOpts = { headless: CONFIG.headless };
  if (CONFIG.executablePath) {
    launchOpts.executablePath = CONFIG.executablePath;
  }
  const browser = await chromium.launch(launchOpts);

  const personaKeys = pickPersonaKeys(CONFIG.personas);
  console.log(`  personas: ${personaKeys.map((k, i) => `${i}=${k}`).join(' ')}`);

  // Status updater — every 60s, print live status.
  const statusInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - mainStart) / 1000);
    const remain = Math.round((CONFIG.durationMs - (Date.now() - mainStart)) / 1000);
    console.log(`  [${elapsed}s elapsed, ${remain}s remain] BUGS=${BUGS.length} (${countSev('CRITICAL')}C/${countSev('HIGH')}H/${countSev('MEDIUM')}M/${countSev('LOW')}L)`);
  }, 60_000);
  const mainStart = Date.now();

  // onTick callback — append to timeline + cap memory at 10k events.
  function onTick(ev) {
    if (TIMELINE.length < 10_000) TIMELINE.push(ev);
  }

  // ──────────── Pre-spawn scenario generation ────────────
  // Fixture mode: instant hardcoded scenarios. Real-Opus mode: generate one
  // rich scenario per persona via Opus 4.7 + adaptive thinking. Generation
  // happens BEFORE spawning so all personas have a real chart up-front; if
  // Opus fails for one, the remaining personas still proceed.
  const allScenarios = [];
  const costTracker = new CostTracker(CONFIG.costCapUsd);
  if (FIXTURE_MODE) {
    for (let i = 0; i < personaKeys.length; i++) {
      allScenarios.push(fixtureScenarioFor(i, PERSONAS[personaKeys[i]]?.name || personaKeys[i]));
    }
  } else {
    console.log(`  generating ${personaKeys.length} scenarios via Opus 4.7 (effort=${process.env.CHAOS_EFFORT || 'medium'}) ...`);
    const genStart = Date.now();
    // Sequential generation — Anthropic rate limits prefer this and the
    // total time (~3-5s × N) is well under the 30-min run budget.
    for (let i = 0; i < personaKeys.length; i++) {
      try {
        const scen = await generateScenarioOpus({
          apiKey: KEY,
          model: process.env.CHAOS_MODEL || 'claude-opus-4-7',
          effort: process.env.CHAOS_EFFORT || 'high',
          seedIdx: i,
          runId: RUN_ID,
          costTracker,
          onLog: (m) => console.log(m),
        });
        scen._persona = PERSONAS[personaKeys[i]]?.name || personaKeys[i];
        scen._persona_idx = i;
        allScenarios.push(scen);
      } catch (err) {
        console.warn(`  scenario ${i} gen failed (${err.message?.slice(0, 80)}) — falling back to fixture`);
        allScenarios.push(fixtureScenarioFor(i, PERSONAS[personaKeys[i]]?.name || personaKeys[i]));
      }
    }
    console.log(`  scenarios ready in ${((Date.now() - genStart) / 1000).toFixed(1)}s, cost so far $${costTracker.total().toFixed(2)} (${costTracker.calls} calls)`);
  }

  // Spawn all personas in parallel.
  const promises = personaKeys.map((key, idx) => {
    const scenario = allScenarios[idx];
    return runPersona({
      browser,
      personaKey: key,
      scenario,
      durationMs: CONFIG.durationMs,
      reportDir: CONFIG.reportDir,
      url: CONFIG.url,
      logBug,
      onTick,
    }).catch((err) => {
      logBug('CRITICAL', scenario.scenario_id, `persona-${key}/fatal`,
        `persona crashed: ${err.message?.slice(0, 200)}`);
      return { persona: PERSONAS[key]?.name || key, wallMs: Date.now() - mainStart, tally: null, error: err.message };
    });
  });

  const results = await Promise.all(promises);
  clearInterval(statusInterval);
  await browser.close();

  await writeTimeline();
  await writeReport(results);

  // Patient gallery — synthetic charts the user can browse like real patients.
  const galleryDir = path.resolve(CONFIG.reportDir, `${RUN_ID}-patients`);
  const galleryMeta = {
    runId: RUN_ID,
    duration: `${((Date.now() - mainStart) / 60000).toFixed(1)} min`,
    generatedBy: FIXTURE_MODE ? 'fixture' : 'Opus 4.7',
  };
  const gallery = await writePatientGallery(allScenarios, galleryDir, galleryMeta);

  console.log(`\n=== ward-helper-mega-bot complete ===`);
  console.log(`Wall: ${((Date.now() - mainStart) / 60000).toFixed(2)} min`);
  console.log(`Cost: $${costTracker.total().toFixed(2)} (${costTracker.calls} Opus calls)`);
  console.log(`Bugs: ${BUGS.length} (${countSev('CRITICAL')}C/${countSev('HIGH')}H/${countSev('MEDIUM')}M/${countSev('LOW')}L)`);
  console.log(`Report:  ${REPORT_PATH}`);
  console.log(`Patient gallery (${gallery.count} charts):`);
  console.log(`         ${gallery.indexPath}`);
  console.log(`         → open in browser to browse the synthetic patient records`);
}

function countSev(sev) { return BUGS.filter((b) => b.severity === sev).length; }

async function writeTimeline() {
  const lines = TIMELINE.map((e) => JSON.stringify(e)).join('\n');
  await fs.writeFile(TIMELINE_PATH, lines, 'utf8');
}

async function writeReport(results) {
  const lines = [];
  lines.push(`# ward-helper-mega-bot — ${RUN_ID}`);
  lines.push('');
  lines.push(`- Wall time: ${results.length > 0 ? Math.round(Math.max(...results.map((r) => r.wallMs)) / 1000) : 0}s`);
  lines.push(`- Personas: ${results.length}`);
  lines.push(`- Total bugs: ${BUGS.length}`);
  lines.push(`- Fixture mode: ${FIXTURE_MODE}`);
  lines.push('');

  lines.push('## Per-persona summary');
  lines.push('| Persona | Wall | Actions | Chaos | Errors | Recoveries |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const t = r.tally;
    if (!t) { lines.push(`| ${r.persona} | crashed | — | — | — | — |`); continue; }
    lines.push(`| ${r.persona} | ${Math.round(r.wallMs / 1000)}s | ${t.actions} | ${t.chaos} | ${t.errors} | ${r.recoveries} |`);
  }
  lines.push('');

  lines.push('## Action coverage');
  const allByAction = {};
  for (const r of results) {
    if (!r.tally) continue;
    for (const [k, v] of Object.entries(r.tally.byAction || {})) {
      allByAction[k] = (allByAction[k] || 0) + v;
    }
  }
  lines.push('| Action | Total runs |');
  lines.push('|---|---|');
  for (const k of Object.keys(allByAction).sort()) {
    lines.push(`| ${k} | ${allByAction[k]} |`);
  }
  lines.push('');

  lines.push('## Bug summary by severity');
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    const c = countSev(sev);
    if (c > 0) lines.push(`- **${sev}**: ${c}`);
  }
  lines.push('');

  lines.push('## Bug summary by flow');
  const byFlow = {};
  for (const b of BUGS) {
    const flow = b.where.split('/').slice(0, 2).join('/');
    byFlow[flow] = byFlow[flow] || { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 };
    byFlow[flow][b.severity]++;
    byFlow[flow].total++;
  }
  lines.push('| Flow | CRIT | HIGH | MED | LOW | Total |');
  lines.push('|---|---|---|---|---|---|');
  for (const [flow, c] of Object.entries(byFlow).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| \`${flow}\` | ${c.CRITICAL} | ${c.HIGH} | ${c.MEDIUM} | ${c.LOW} | ${c.total} |`);
  }
  lines.push('');

  lines.push('## Bug details (CRITICAL + HIGH only — full list in JSONL timeline)');
  for (const b of BUGS.filter((b) => b.severity === 'CRITICAL' || b.severity === 'HIGH')) {
    lines.push(`### [${b.severity}] ${b.where}`);
    lines.push(`- Scenario: ${b.scenario_id}`);
    lines.push(`- What: ${b.what}`);
    if (b.evidence) lines.push(`- Evidence: \`${String(b.evidence).slice(0, 280)}\``);
    lines.push(`- At: ${b.at}`);
    lines.push('');
  }

  lines.push('## All bugs (compact)');
  for (const b of BUGS) {
    lines.push(`- [${b.severity}] ${b.where}: ${b.what}`);
  }

  lines.push('');
  lines.push(`Timeline JSONL: \`${TIMELINE_PATH}\`  (${TIMELINE.length} events)`);
  await fs.writeFile(REPORT_PATH, lines.join('\n'), 'utf8');
}

main().catch((e) => { console.error('fatal:', e); process.exitCode = 1; });
