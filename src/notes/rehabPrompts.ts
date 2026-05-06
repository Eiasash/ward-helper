// src/notes/rehabPrompts.ts
//
// Rehab SOAP mode augmentations, ported from
// /mnt/skills/user/rehab-quickref/SKILL.md v4.1 (2026-05-05).
//
// Each mode's augmentation is appended to the base SOAP_STYLE prompt by
// buildSoapPromptPrefix(mode). These are LLM directives — they encode
// clinical rules that affect output. Human-only meta (speed tips,
// anti-patterns, calibration history) is intentionally excluded to keep
// the per-emit token cost down.
//
// Ground-truth invariants that must NOT change without skill-side update:
//   - Drug names ENGLISH UPPERCASE in note body
//   - Dose changes IN A bullets, not P
//   - HD weekday letters: א ב ג ד ה ו ש = Sun..Sat (ש = Friday in HD context)
//   - Domain prefixes use `*` not `-` or `•`
//   - Section headers are S / O / A / P + תוכנית טיפול

import type { SoapMode } from './soapMode';

// ─── Universal rules — applied to ALL rehab modes ────────────────────

const REHAB_UNIVERSAL = `
חוקי כתיבה אוניברסליים (חלים על כל מצב שיקום):
• שמות תרופות באנגלית UPPERCASE בכל מקום בגוף הרשומה.
• שינויי מינון נכתבים IN של בולט A כפעולה ציווי. לא דוחים ל-P.
  דוגמאות: "נוריד METOPROLOL ל-50", "הושהה FOSRENOL", "נמיר Duloxetine ל-mirtazapine".
• P מיועד לפעולות לא-תרופתיות בלבד (התייעצויות, בדיקות, הסרת תפרים).
• כותרות סקציות: S / O / A / P + תוכנית טיפול (יעדי טיפול).
• בולטים ב-A משתמשים בתחיליות domain עם '*':
  *אורתופדית, *זיהומית, *תפקודית, *כלייתי, *לבבי, *לחץ דם, *בצקת,
  *נשימתי, *נירולוגית, *כאב, *שתן, *מטבולית, *פצע, *עצירות, *שינה,
  *תזונתי, *פסיכולוגית, *עצמות, *סוכרת, *תרופתית.
• אם דומיין לא טופל היום, אל תכתוב bullet שלו.
• ביטויי תזמון ב-P: היום, מחר בבוקר, לפני המנה הבאה, יומיומית, בערב,
  במשך X ימים, עד תאריך DD/MM.
`;

// ─── FIRST-DAY ───────────────────────────────────────────────────────

const REHAB_FIRST_DAY = `
דפוס FIRST-DAY (יום ראשון בשיקום או יום 0/1):

S - דיווח המטופל/ת (פסקה קצרה, לא בולטים):
  • שינה לילה ראשון במחלקה
  • שליטה בכאב על הרג'ים הנוכחי - שאל במפורש
  • אירועים אחרונים: נפילה לפני אשפוז? קרוב-עילפון בפיזיו?
  • חששות לגבי שחרור / ניתוח / משפחה
  • מצב רוח ומוטיבציה לשיקום

O - בדיקה גופנית וממצאי עזר:
  ל"ד, ד, חום, סטורציה. אורתוסטטיים אם נפילות/סחרחורת.
  בדיקה ממוקדת לפי אינדיקציה:
  • Post-CVA: עצבים גולגולתיים, מוטוריקה לפי גף-סגמנט, תחושה, שפה
  • Post-hip/knee: פצע ניתוחי (אורך, סיכות, ניקוז), מוטוריקה לכל גף, DP
  • Post-spine: פצע, מוטוריקה IP/QUAD/dorsi-plantar דו-צדדי, סוגרים
  • Pre-cardiac: לב (דרגת אושה), JVP, בסיסי ריאות, בצקת
  • ESKD/HD: פיסטולה - thrill+bruit, סימני זיהום בגישה
  מעבדה בקבלה inline. ECG אם חריג.

A - מסקנה והערכה:
  פותחים ב-3-4 שורות capsule:
    [גיל] [מצב משפחתי] [ילדים]. [מצב מגורים - לבד? קומה? מעלית?].
    רקע רפואי כולל [3-5 מחלות כרוניות, לפי רלוונטיות לשיקום].
    בבסיס [ADL/IADL לפני אשפוז במשפט אחד].
    כעת לאחר [אירוע חריף] בתאריך [DD/MM]. התקבל/ה לשיקום ביום [N] לאחר [הניתוח/האירוע].
  אחר כך:
    בעיות:
    *[domain] - [מצב + החלטה]
    *[domain] - [מצב + החלטה]

P - לביצוע:
  פעולות עם תזמון מפורש. מעבדות שיוספו היום. התייעצויות שיתבקשו.

תוכנית טיפול (יעדי טיפול):
  מטרה קונקרטית לפי אינדיקציה:
  • Post-hip/knee: "מטרה לעצמאות בניידות ובשרותים."
  • Post-spine: "מטרה לעצמאות במעברים והליכה עם עזרים."
  • Pre-cardiac: "לקראת ניתוח X בעוד N שבועות. מטרה לחיזוק תפקודי טרום-ניתוחי."
  • Post-deconditioning: "מטרה לחזרה לתפקוד בסיסי לפני האשפוז."
  • Post-CVA יום 0-3 בלבד: "מוקדם מדי לקבוע מטרה."
  • Post-fracture ללא ניתוח: "מטרה לעצמאות בניידות בהתאם להוראות אורתופדיה."

חוק קפסולת *אורתופדית - 6 אלמנטים חובה ב-FIRST-DAY עבור כל קבלת אורתו:
  1. סוג ניתוח מדויק + מפרטי חומרה (לא "ניתוח שבר ירך" - אלא Hemiarthroplasty,
     THA, DHS, IM nail PFNA/TFN/Gamma, cannulated screws, ORIF, CRIF.
     ל-IM nails: מפרטי גודל מסמ"ך הניתוחי verbatim).
  2. גישה (ירך): anterolateral / posterolateral / direct anterior / lateral.
  3. תאריך ניתוח DD/MM/YY מפורש - לא "אתמול".
  4. POD היום מחושב.
  5. סטטוס סיכות + תאריך הסרה מתוכנן (ירך POD 10-14, גב POD 14).
  6. משך + מינון פרופילקסיה DVT - תאריך עד שרץ + מינון מותאם כליות.
     ירך פוסט-ניתוחי = 35 ימים סטנדרט. CrCl ≤30 או HD = ENOXAPARIN 20mg (לא 40).
`;

// ─── HD-COMPLEX ──────────────────────────────────────────────────────

const REHAB_HD_COMPLEX = `
דפוס HD-COMPLEX (יום 0/1 לחולה ESRD/HD או ≥4 כרוניות עם תרופות פעילות):

S - פסקה דחוסה אחת, לא בולטים:
  פותחים ב-capsule דחוס ב-S עצמה (לא ב-A) - הדמוגרפיה והרקע הרפואי
  הם הקונטקסט הקליני המרכזי בתיק.
    [bn/bt N], [marital], [parents/children]. [מצב מגורים - קומה,
    מעלית, מטפל, איש קשר ראשי + קרבה].
    רקע רפואי כולל [chronic dx 1] על [drug/dialysis modality],
    [chronic dx 2] עם [complication], [chronic dx 3], [...להמשיך לרשום
    כל מצב כרוני עם תרופה או מודאליות], [G6PD או דיאגנוזות תרופה-מלכודת בסוף].
    בבסיס תפקודי - [ADL/IADL לפני אשפוז במשפט אחד].
    כעת לאחר [אירוע חריף + מנגנון] בתאריך [DD/MM/YY].
    [סיכום מבצעי במשפט אחד עם מפרטי חומרה]. במהלך האשפוז [תכיפות HD,
    מוצרי דם, סיבוכים]. הועבר/ה לשיקום ביום [N] לאחר [הניתוח/האירוע].
  בסוף הפסקה - check-list תסמינים שורה כל אחד:
    מתלונן/ת על [pain location] - [intensity, control with current regimen]
    ישן/ה בלילה [+ qualifier]
    שתן ויציאה [תקנות / שינוי]
    תאבון [תקין / פוחת / מוגבר]
    מצב רוח [+ motivation for rehab]

O - בדיקה מלאה כולל פריטי HD:
  ל"ד, ד, חום, סטורציה, משקל + BMI.
  מצב כללי, MMSE/MoCA אם PT/OT עשו (או הסבר למה לא).
  לב, ריאות, בטן.
  פיסטולה [side] - bruit + thrill, מראה, סימני זיהום בגישה.
  פצע ניתוחי - אורך, סיכות, ניקוז, ריפוי, חבישה.
  גפיים - בצקת, DP פולסים דו-צדדי.
  מוטוריקה - QUAD לפי צד עם ציון, סיבה ברורה לאסימטריה אם קיימת.
  תחושה. נירו/עצבים גולגולתיים/שפה רק אם פוסט-CVA או פוסט-spine.

A - bullet אחד לכל drug-disease conflict (לא bullet אחד לכל מערכת):
  *תרופתית יכול להופיע מספר פעמים. case Zizo קלסי = 11 בולטים.
  כל שינוי מינון inline בתוך ה-bullet כפעולה ציווי. P לא-תרופתי בלבד.

  בולטים מנדטוריים ל-HD-COMPLEX יום-1 (דלגי רק אם לא רלוונטי):

  *אורתופדית - POD N לאחר {procedure} עם {hardware specs}.
    {Wound status}. {WB instruction}. {Suture removal date}.

  *כלייתי - ESKD על המודיאליזה {לוח 3X/שבוע באותיות יום} {access type}.
    {Residual urine}. {Net dialysis dose if known}.
    קיצור עברי לוח HD: ב ד ש = שני/רביעי/שישי. א ג ה = ראשון/שלישי/חמישי.
    שימי לב: ש = שישי בקונטקסט HD ישראלי, לא שבת.

  *זיהומית - מסלול CRP עם ערכים, חום/אין חום, מקורות אפשריים:
    פיסטולה / פצע / שתן / ריאתי / line / דם.
    פעולה: תרביות + משטח פצע + UA.

  *מטבולית - סטטוס Ca/P/PTH/Vit D. סקירת קושר זרחן. התערבויות פעילות
    על כל סטייה עם מינון.

  *סוכרת - תבנית BG, רג'ים נוכחי, זיהוי תופעת Dawn, שינוי בבזאלי/תיקון
    עם מינון קונקרטי.

  *לחץ דם וקצב לב - טווח ל"ד, דופק, סוכנים נוכחיים, החלטה: הורדת מינון /
    העלאה / החזקה לפי ערכים שנצפו.

  *נירולוגית - אבחנת פרכוסים, AED עם מינון מותאם ESRD, זמן מאז אירוע
    אחרון, תוכנית: התייעצות נירו / EEG אם לא ברור.

  *כאב - רג'ים נוכחי בשכבות (טרנס-דרמלי + פאראצטמול קבוע + אופיואיד PRN),
    VAS, תוכנית הסלמה/de-escalation.

  *עצמות - אבחנת אוסטאופורוזיס, שבר שבריריות אחרון, סטטוס החלטה
    בייספוספונט: HOLD תלוי בעיבוד CKD-MBD. השלמת Vit D. התייעצות
    אנדוקרינולוגית לגבי Prolia אם מותווה.

  *תרופתית - drug-disease conflict: שם תרופה + למה לא נכון לחולה הזה +
    תוכנית החלפה + התייעצות נדרשת. בולט אחד לכל קונפליקט.

  *[domain אחר] - לפי הצורך: G6PD + Optalgin, anticoag + תזמון HD וכו'.

P - פעולות לא-תרופתיות בלבד:
  תאריך הסרת סיכות. התייעצויות (rheum/endo/neuro/nephro). מעבדות
  להוסיף (PTH, 25-OH-D, ESR, תרביות דם/פצע, ACR). הדמיה. פרוצדורות.

תוכנית טיפול: זהה ל-FIRST-DAY format.

ביקורת תרופות HD/ESRD מנדטורית ביום-1 - העבר/י את רשימת התרופות-בית
מול הטבלה הזו ופעל/י בבולטי A:
  • Methotrexate - הוראת-נגד מוחלטת. STOP. התייעצות rheum.
  • Duloxetine - הוראת-נגד CrCl <30. החלף ל-mirtazapine 7.5-15mg HS
    או sertraline 25-50mg.
  • Dipyrone (Optalgin) - סיכון אנמיה אפלסטית ב-G6PD deficiency.
    הסר אם G6PD def. PARACETAMOL + אופיואיד PRN.
  • NSAIDs - הוראת-נגד מוחלטת. הסר.
  • Enoxaparin - 40mg מצטבר. 20mg SC יומי לפרופילקסיה (CrCl <30 או HD).
  • Levetiracetam - 1000 BID גבוה ב-HD. 500 BID + תוספת 250-500mg post-HD.
  • Bisphosphonates - לא סטנדרט eGFR <30. HOLD. עיבוד CKD-MBD ראשית.
  • Gabapentin/Pregabalin - מצטבר. הפחת ≥75% או החלף.
  • Metformin - הוראת-נגד eGFR <30. הסר. Insulin או DPP4i.
  • Digoxin - הפחת ≥50%. ניטור trough.
  • Allopurinol - 100mg/day max ב-ESRD.
  • Vancomycin - דוז-לפי-רמה. trough לפני כל HD.

אם רשימת תרופות-בית מכילה תרופה מהטבלה ללא התאמה מתועדת,
העלה אותה כ-bullet *תרופתית עצמאי ביום-1 עם תוכנית מוצעת.
`;

// ─── STABLE ──────────────────────────────────────────────────────────

const REHAB_STABLE = `
דפוס STABLE (סבב המשך, יציב):

בחירת variant לפי **איפה את/ה מוצא/ת את החולה**, לא לפי חריפות.
הצהר מיקום ב-S כדי שה-O יהיה הגיוני בקריאה עתידית.

Variant A - באולם פיזי (במהלך טיפול PT):
  S - דיווח המטופל/ת:
    מרגיש/ה טוב
    [כאב בשליטה / אזכור של נושא תרופתי שדנו בו]
    ביקור באולם פיזי
  O - O תפקודי/PT:
    ניידות במיטה - [עצמאי / בהשגחה / בעזרה קלה]
    מעבר משכיבה לישיבה ב[level of assist]
    מעבר מישיבה לעמידה ב[level]
    שיווי משקל סטטי [תקין / לקוי]
    דינמי [תקין / לקוי - level of assist]
    הליכה עם [הליכון / מקל / 2 קביים] [+ qualifier: אנטאלגית, רחבת בסיס]
    [מדרגות אם נוסה: רצפרוקלית עם עזרה X, STEP-2 עם עזרה X]
    [TUG אם נמדד]
  A - מסקנה:
    [משתקם/ת היטב לאחר {procedure}] / [מתקדם/ת בקצב טוב] / [יציב/ה]
  P:
    המשך שיקום [/ שוחחתי על שחרור ב-DD/MM, נעקוב]
  תוכנית טיפול: carry forward מיום 1.

Variant B - לצד מיטה / במחלקה:
  S:
    מרגיש/ה טוב
    ישן/ה בלילה
    פעמ"ם [היום / אתמול / שלשום]
    [pain status, BM, appetite אם משהו לציין]
  O - O רפואי סטנדרטי:
    ל"ד, ד, חום, סטורציה
    קולות לב סדירים
    כניסת אוויר טובה לריאות
    בטן רכה
    גפיים ללא בצקת
    [wound check / fistula thrill+bruit אם רלוונטי]
    [ממצא ממוקד קשור לבעיה פעילה]
  A:
    בשיקום לאחר [event] - [מתקדם / יציב / החמרה ב-X]
  P:
    המשך שיקום
  תוכנית טיפול: carry forward מיום 1.

חשוב: אל תזייף אף variant. אם לא ביקרת באולם פיזי - אל תכתוב O תפקודי.
אם לא הקשבת ללב - אל תכתוב "קולות לב סדירים".
`;

// ─── COMPLEX ─────────────────────────────────────────────────────────

const REHAB_COMPLEX = `
דפוס COMPLEX (סבב המשך, פעיל):

הופעל כאשר ≥2 טריגרים פעילים:
  • IV ABX עם רמות תרופה
  • פצע פוסט-ניתוחי, ניקוז, VAC
  • דיורזיס פעיל עם משקלים משתנים
  • ל"ד / סוכר בטיטרציה
  • AKI מתפתח
  • פרוצדורה ממתינה (אקו, החלטת ניתוח, התייעצות אורתו)
  • מעבדות חריגות מתפתחות

S - דיווח המטופל/ת (1-3 שורות):
  כאב, שינה, פעמ"ם, מצב רוח, שיתוף פעולה.

O - בדיקה גופנית וממצאי עזר:
  חום, ד, ל"ד, סטורציה.
  קולות הלב, אושה אם קיימת.
  כניסת אוויר.
  בטן.
  גפיים - בצקת, פצע.
  [נירו אם רלוונטי]
  [מעבדות inline: קראטינין, BUN, רמת VANCO וכו']

A - סינתזה במשפט אחד + bullets רק לבעיות שזזו היום:
  [one-line synthesis]
  *[domain] - [סטטוס]. [החלטה/תוכנית]
  *[domain] - [סטטוס]. [החלטה/תוכנית]
  *[domain] - [סטטוס]. [החלטה/תוכנית]

P - לביצוע:
  [פעולה 1 + תזמון]
  [פעולה 2 + תזמון]
  [פעולה 3 + תזמון]

תוכנית טיפול: carry forward.

הבדל מ-HD-COMPLEX: כאן O הוא בודק רגיל (לא דורש פיסטולה ופריטי HD).
A הוא bullet אחד לכל בעיה פעילה (לא bullet אחד לכל drug-disease conflict).
`;

// ─── Mode → augmentation map ─────────────────────────────────────────

export const REHAB_AUGMENTATIONS: Record<SoapMode, string> = {
  'general':           '',
  'rehab-FIRST':       REHAB_UNIVERSAL + REHAB_FIRST_DAY,
  'rehab-STABLE':      REHAB_UNIVERSAL + REHAB_STABLE,
  'rehab-COMPLEX':     REHAB_UNIVERSAL + REHAB_COMPLEX,
  'rehab-HD-COMPLEX':  REHAB_UNIVERSAL + REHAB_HD_COMPLEX,
};

/**
 * Append the mode-specific augmentation to the base SOAP_STYLE prompt.
 * `general` returns empty string — caller falls through to existing SOAP_STYLE.
 */
export function rehabAugmentation(mode: SoapMode): string {
  return REHAB_AUGMENTATIONS[mode] ?? '';
}
