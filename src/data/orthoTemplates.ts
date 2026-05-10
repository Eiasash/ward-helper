// src/data/orthoTemplates.ts
//
// Hebrew SOAP templates for the SZMC ortho-rehab cohort (post-hip, post-knee,
// post-spine). Source-of-truth: ~/.claude/skills/rehab-quickref/ +
// ~/.claude/skills/ortho-reference/. Generated from
// WARD_HELPER_ORTHO_REHAB_BRIEF v2 (2026-05-10).
//
// Note: domainPrefixes here mirrors src/notes/rehabPrompts.ts (REHAB_UNIVERSAL).
// rehabPrompts.ts is the canonical LLM-directive copy. This file's domainPrefixes
// is for UI lookup only (e.g. autocomplete). Keep them in sync; if conflict,
// rehabPrompts.ts wins.
//
// Chameleon paste hygiene: no Unicode arrows, no markdown bold, no `--` dividers,
// no `q8h`/`bid` shorthand, no `>N`/`<N`. Drug names are English UPPERCASE.

export interface SoapTemplate {
  readonly label: string;
  readonly template?: string;
  readonly templateS?: string;
  readonly templateO?: string;
  readonly templateA?: string;
  readonly templateP?: string;
  readonly slots?: Readonly<Record<string, string>>;
  readonly rule?: string;
}

export interface DomainPrefix {
  readonly prefix: string;
  readonly description: string;
}

export const ORTHO_TEMPLATES = {
  version: '1.0.0',
  lastUpdated: '2026-05-10',

  day1OrthoCapsule: {
    label: '*אורתופדית - 6 חובה ביום 1',
    template:
      '*אורתופדית - לאחר {{procedureName}} צד {{side}} (גישה: {{approach}}) בתאריך {{surgeryDate}}. POD {{podToday}} היום.\nסיכות {{sutureStatus}}{{sutureRemovalLine}}.\n{{dvtLine}}.\nפצע ניתוחי {{woundDescription}}.',
    slots: {
      procedureName: 'Hemiarthroplasty / THA / DHS / IM nail PFNA / IM nail Gamma / cannulated screws / ORIF / CRIF (+ hardware specs)',
      side: 'שמאל / ימין',
      approach: 'אנטרו-לטרל / פוסטריור / מדיאל / direct anterior',
      surgeryDate: 'DD/MM/YY',
      podToday: 'calculated, see orthoCalc.calculatePOD',
      sutureStatus: 'במקום / הוסרו',
      sutureRemovalLine: "if 'במקום' use ' - להוצאה מתוכננת בתאריך DD/MM/YY (POD __)'; else ''",
      dvtLine: 'ENOXAPARIN 40mg SC פעם ביום עד DD/MM/YY (default 35d post-op)  /  ENOXAPARIN 20mg SC פעם ביום (CrCl נמוך מ-30 או המודיאליזה) עד DD/MM/YY  /  UFH 5000 יחידות SC פעמיים-שלוש ביום',
      woundDescription: 'יבש, ללא הפרשה / עם הפרשה X / סימני זיהום: ___',
    },
    rule: 'All six elements mandatory. Missing any one = chart corruption that propagates for the entire admission.',
  },

  day1SoapPostHip: {
    label: 'FIRST-DAY SOAP - שבר ירך / החלפת מפרק',
    templateS:
      'S דיווח המטופל:\n{{sleepFirstNight}}\n{{painControl}}\n{{recentEvents}}\n{{dischargeConcerns}}\n{{moodMotivation}}',
    templateO:
      'O בדיקה גופנית וממצאי עזר:\nל"ד {{bp}}, ד {{pulse}}, חום {{temp}}, סטורציה {{sat}}%\n{{orthoIfNeeded}}\n[General + cooperation + cognition]\nפצע ניתוחי: {{woundDescription}}\nQUAD צד מנותח {{quadOp}}/5, צד נגדי {{quadOther}}/5\nכיפוף ירך פעיל {{hipFlex}}\nDP bilateral {{dpStatus}}\nתחושה {{sensation}}\n[Admission labs inline]\n[ECG findings if abnormal]',
    templateA:
      'A מסקנה והערכה:\nבן/בת {{age}} {{marital}} {{parents}}, {{living}}. רקע: {{chronicDx}}. בבסיס {{baselineFunction}}. כעת לאחר {{acuteEvent}} בתאריך {{surgeryDate}}. הועבר/ה לשיקום ביום {{podToday}}.\n\nבעיות:\n{{orthoCapsule}}\n*תפקודית - {{functionalStatus}}\n*כאב - {{painPlan}}\n*זיהומית - {{infectionStatus}}\n[additional domains as needed]',
    templateP:
      'P לביצוע:\n[Suture removal date]\n[Consults to request]\n[Labs to add]\n[Imaging follow-up if needed]\n\nתוכנית טיפול (יעדי טיפול):\nבן/בת {{age}} לאחר {{procedureName}}. מטרה לעצמאות בניידות ובשרותים.',
  },

  day1SoapPostSpine: {
    label: 'FIRST-DAY SOAP - לאחר ניתוח עמוד שדרה',
    templateS:
      'S דיווח המטופל:\n{{sleepFirstNight}}\n{{painControl}} - כולל כאב גב ניתוחי\n{{recentEvents}}\n{{dischargeConcerns}}\n{{moodMotivation}}',
    templateO:
      'O בדיקה גופנית וממצאי עזר:\nל"ד {{bp}}, ד {{pulse}}, חום {{temp}}, סטורציה {{sat}}%\n[General + cooperation + cognition]\nפצע ניתוחי גב: {{woundDescription}}\nIP {{ipBilateral}}, QUAD {{quadBilateral}}, dorsiflexion {{dorsiflexion}}, plantarflexion {{plantarflexion}}\nתחושה {{sensation}}\nתפקוד סוגרים {{sphincter}}\n[Admission labs inline]',
    templateA:
      'A מסקנה והערכה:\nבן/בת {{age}} {{marital}} {{parents}}, {{living}}. רקע: {{chronicDx}}. בבסיס {{baselineFunction}}. כעת לאחר {{procedureName}} בתאריך {{surgeryDate}}. הועבר/ה לשיקום ביום {{podToday}}.\n\nבעיות:\n*אורתופדית - לאחר {{procedureName}} בתאריך {{surgeryDate}}, POD {{podToday}}. סיכות במקום, להוצאה {{sutureRemovalDate}} (POD 14). {{dvtLine}}. פצע גב {{woundDescription}}.\n*תפקודית - {{functionalStatus}}\n*כאב - {{painPlan}}\n*נירולוגית - {{neuroStatus}}',
    templateP:
      'P לביצוע:\n[Suture removal POD 14]\n[Neuro reassessment if any deficit]\n[Imaging follow-up per ortho]\n\nתוכנית טיפול (יעדי טיפול):\nבן/בת {{age}} לאחר {{procedureName}}. מטרה לעצמאות במעברים והליכה עם עזרים.',
  },

  dailyStableGym: {
    label: 'STABLE - נמצא באולם פיזי',
    template:
      'S דיווח המטופל:\nמרגיש/ה טוב\n{{painOrTopic}}\nביקור באולם פיזי\n\nO בדיקה גופנית וממצאי עזר:\nניידות במיטה - {{bedMobility}}\nמעבר משכיבה לישיבה ב{{supineToSit}}\nמעבר מישיבה לשכיבה ב{{sitToSupine}}\nמעבר מישיבה לעמידה ב{{sitToStand}}\nשיווי משקל סטטי {{balanceStatic}}\nדינמי {{balanceDynamic}}\nהליכה עם {{gaitAid}} {{gaitQualifier}}\n{{stairs}}\n{{tug}}\n\nA מסקנה והערכה:\n{{synthesis}}\n\nP לביצוע:\nהמשך שיקום\n{{dischargeMention}}\n\nתוכנית טיפול (יעדי טיפול):\n{{carryForward}}',
    rule: "Pick by where you find the patient, not by acuity. Bedside = medical O; gym = functional O. Don't fake either.",
  },

  dailyStableBedside: {
    label: 'STABLE - נמצא במחלקה / ליד המיטה',
    template:
      'S דיווח המטופל:\nמרגיש/ה טוב\nישן/ה בלילה\nפעמ"ם {{bm}}\n{{painSleepAppetite}}\n\nO בדיקה גופנית וממצאי עזר:\nל"ד {{bp}}, ד {{pulse}}, חום {{temp}}, סטורציה {{sat}}%\nקולות לב סדירים\nכניסת אוויר טובה לריאות\nבטן רכה\nגפיים ללא בצקת\n{{wundOrFistula}}\n{{focusedFinding}}\n\nA מסקנה והערכה:\nבשיקום לאחר {{event}} - {{trajectory}}\n\nP לביצוע:\nהמשך שיקום\n\nתוכנית טיפול (יעדי טיפול):\n{{carryForward}}',
  },

  domainPrefixes: {
    '*אורתופדית': 'Post-op spine/joint, fixation, wound, drain, VAC',
    '*זיהומית': 'Active ABX, drug levels, source control, cultures',
    '*תפקודית': 'Functional progress/regress, transfers, ADL gains',
    '*כלייתי': 'AKI/CKD trajectory, drug toxicity, hydration, HD',
    '*לבבי': 'HF, arrhythmia, pre-op cardiac, valve',
    '*לחץ דם': 'HTN management, drug titration',
    '*בצקת': 'Volume status, diuretic titration',
    '*נשימתי': 'O2, pneumonia, OSA, secretions',
    '*נוירולוגית': 'Post-stroke deficits, cognition, spasticity',
    '*כאב': 'Pain control, opiates, scheduled paracetamol',
    '*שתן': 'Retention, catheter, UTI, voiding trial',
    '*מטבולית': 'Electrolytes, glucose, nutrition labs',
    '*פצע': 'Wound, VAC, dressing, healing',
    '*עצירות': 'Constipation, BM, laxative',
    '*שינה': 'Sleep, delirium, agitation',
    '*תזונתי': 'Intake, weight, supplements',
    '*פסיכולוגית': 'Mood, motivation, family',
    '*עצמות': 'Fragility fracture, osteoporosis vs CKD-MBD',
    '*תרופתית': 'Drug-disease conflicts (one bullet per conflict in HD/multi-comorbid)',
  },
} as const;

export type OrthoTemplates = typeof ORTHO_TEMPLATES;
