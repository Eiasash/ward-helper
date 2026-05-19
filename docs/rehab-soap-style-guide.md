# SZMC Geriatric-Rehab SOAP — Style Guide

**PHI-free.** Calibration reference for generating ביקור רופא (rehab daily-round)
notes in the house style. The two worked examples below are genuine signed
notes with patient identifiers removed — the S/O/A/P bodies carry no names or
MRNs, so anonymisation is just the header. This file is safe to commit to a
repo, embed in a skill, or add to project knowledge.

Source: distilled from a 4-note gold corpus of genuine signed notes
(ESRD/HD wound, ESRD/HD ortho, SCI + endocarditis, post-op UTI). The named
master corpus stays off any repo and out of cloud storage.

**Rev 2 (2026-05-19):** patterns 2 and 3 sharpened — the capsule is now scoped
to the first rehab SOAP (follow-up rounds omit it), and the lab rule
distinguishes serum / central-lab results (A bullets) from bedside
point-of-care readings (may sit in O). Fixes the two review findings on
ward-helper PR #207.

---

## The 8 style patterns

Encode these into any SOAP-generation prompt.

1. **S = a checklist of short patient-reported lines, not prose.** One item per
   line, sentence fragments. Covers, in roughly this order: chief
   symptom + its control, sleep (`ישן בלילה`), urine + stool, appetite
   (`תאבון סביר` / `שמור`), mood + cooperation/motivation. **Ends with the
   literal encounter-location line** — `ביקור ליד המיטה` or `באולם פיזי`.
2. **O = bedside exam, short lines.** Opens `מצב כללי טוב` / alertness, then
   system findings (לב / ריאות / בטן / גפיים), then the patient-specific
   finding the case turns on (the wound + drain, the fistula thrill/bruit, the
   unilateral edema). Vitals fold into one line, and bedside point-of-care
   readings — fingerstick glucose — may sit in O; they are bedside findings.
   **Serum / central-lab results — Hgb, CRP, creatinine, electrolytes, drug
   levels — do NOT go in O; they belong inline in the relevant A bullet.**
3. **A — capsule (first SOAP only) then problem list.** On the **first rehab
   SOAP** for a patient, A opens with a one-line capsule — age + sex + key
   diagnosis + the acute event/date + day-of-rehab or POD. On **follow-up
   rounds there is no capsule** — A goes straight into the problem list as
   delta updates (this is the STEPDOWN format; do not fight it). The problem
   list is `#domain:` bullets; each bullet = domain + current status + drugs +
   the decision. Serum lab values and drug levels go **inline in the relevant
   `#` bullet** (see pattern 2). Both worked examples below are first-type
   notes (capsule present); a follow-up note drops the capsule.
4. **P = an action list**, one action per line, telegraphic: `מעקב…`, `ייעוץ…`,
   `בדיקות דם חוזרות…`, `המשך…`, `החלטה לגבי…`. Drug-level monitoring,
   consults, labs, follow-up. Non-drug actions; med changes live in the A bullet.
5. **תוכנית טיפול = one short paragraph** — restates the capsule, then the
   concrete rehab goal by indication. Can be as short as a single line.
6. **Drug names are English UPPERCASE always** — VANCOMYCIN, DAPTOMYCIN,
   ENOXAPARIN, CEFTAZIDIME — inside otherwise-Hebrew text.
7. **Register is telegraphic.** S / O / P are fragments, not grammatical
   sentences. The A `#` bullets are denser but still compressed. No filler,
   no hedging, no skeleton/topic-word lines, no `[...]` placeholders.
8. **Abbreviations are kept as written** — `כ"א` (כניסת אוויר), `דו"צ` / `דוץ`
   (דו-צדדי), `פעמ"ם` (פעולת מעיים), `ל"ד` — part of the house register.

---

## Worked example A — ESRD/HD on dialysis, infected hip wound, DM (62 M)

Genuine signed rehab daily-round note (ביקור רופא), identifiers removed.
A dense, multi-`#` complex case — the upper end of the range.

```
S דיווח המטופל:
יום 3 מניתוח NONEXCISIONAL DEBRIDEMENT OF WOUND, INFE Left
יש PSEUDOMONAS רגיש
מקבל VANCO לפי רמות (בדיקה היום) ופורטום מותאם דיאליזה
היום יותר טוב וערני מאתמול, יש VAC 50-100 מל דם (400 ב-24 שעות אחרונות)
מרגיש סביר
ישן בלילה
כאב בשליטה עם משככי כאבים קבוע
שתן וצואה - יציאה העביר, שתן מעט (דיאליזה)
תאבון סביר
ביקור ליד המיטה

O בדיקה גופנית וממצאי עזר:
יציב המודינמית ונשימתית
בהכרה מלאה
ללא חום
לב סדיר
בטן רכה
ריאות כניסת אוויר טובה דו צדדית
גפיים בצקת ברגל מנותחת 1+ שמאל עם נקז MINIVAC, בזמן ביקור 50 מל דמי, לא מדמם פעיל אך חבישה על הפצע ספוגה בצבע דם

A מסקנה והערכה:
בן 62, ESRD על המודיאליזה כרונית, סוכרת. מצב לאחר קיבוע שבר סאב-טרוכנטרי, כעת לאחר הטריית פצע ניתוחי מזוהם בירך שמאל (16/05).

#זיהומית: זיהום פולימיקרוביאלי - MRSA + PSEUDOMONAS AERUGINOSA (צמח בשתי תרביות פצע). ייעוץ VANCOMYCIN 1000 מ"ג תוך-ורידי, מינון לפי רמות סביב דיאליזה, יעד 15 עד 20 (רמה אחרונה 18/05 = 11.5, תת-טיפולית). CEFTAZIDIME (FORTUM) 2 גרם תוך-ורידי פעם ביום, הטרייה + MUPIROCIN + VAC מקומי.

תרבית רקמה מפצע ניתוחי 16/05/26:
1 צמיחה בינונית: STAPHYLOCOCCUS AUREUS MRSA - הרגישות אינה בדוח זה, מפנה לדגימה קודמת.
2) רגישות PSEUDOMONAS חזרה - רגיש ל-CEFTAZIDIME צמיחה דלה

#פצע: פצע ירך שמאל עם VAC, יציב, ניקוז כ-400 מ"ל. נקזי Minivac. חשד שכעת בחוץ - הוזמנו אורתופדים בשאלה של VAC לא במקום, היום יש 50 מל דמי בVAC, 24 שעות אחרונות 400 מל דמי.

#כאב: מדבקת BUPRENORPHINE שבועית, PARACETAMOL, DIPYRONE, OXYCODONE לפי צורך.
#סוכרת: ערכי סוכר 200 עד 360, INSULIN GLARGINE 10 יחידות + ASPART פרוטוקול.
#כלייתי: ESRD על המודיאליזה, פיסטולה זרוע שמאל.

P לביצוע:
ייעוץ אורתו בשל חשד ל-VAC DRAIN בחוץ
מעקב רמת VANCOMYCIN וקביעת מינון, יעד 15 עד 20
המשך טיפול אנטיביוטי, נסיון צמצום ה-ABX לפי רגישות - FORTUM ו-VANCO מותאמים לדיאליזה ולרמות כעת
בדיקות דם חוזרות - ספירת דם, כימיה, CRP. מעקב המוגלובין
מעקב לחץ דם
החלטה לגבי חידוש ENOXAPARIN בהתאם לנפרולוגיה בהמשך

תוכנית טיפול (יעדי טיפול):
בן 62 עם ESRD בהמודיאליזה וסוכרת, לאחר הטריית פצע ניתוחי מזוהם בירך שמאל. מטרה לבקרת הזיהום, ריפוי הפצע, ייצוב המודינמי ומטבולי, וחזרה הדרגתית לניידות עם הליכון.
```

---

## Worked example B — ESRD/HD on dialysis, post-CRIF intertrochanteric hip (75 M)

Genuine signed rehab daily-round note (ביקור רופא), identifiers removed.
A clean, stable case — the lower end of the range. Together A and B span the
ward without redundancy.

```
S דיווח המטופל:
מרגיש סביר
ישן בלילה
כאב מאוזן על מדבקות ונוזל אוקסיקוד
שתן מועט (דיאליזה), יציאה אחרונה 16/5
תאבון שמור
מצב רוח ושיתוף פעולה שמור, יש מוטיבציה
ביקור ליד המיטה

O בדיקה גופנית וממצאי עזר:
מצב כללי טוב
ערני
ללא מצוקה נשימתית או המודינמית
בבדיקה גופנית ללא ממצא ראוי לציון
ל"ד דופק חום סטורציה בנורמה, 150/70 ל"ד
סוכרים בבוקר סביב 140, אחרי אוכל בבדיקות 100-140
פיסטולה - thrill ו-bruit, זרוע שמאלית תקינה

A מסקנה והערכה:
בן 75, ESRD על המודיאליזה כרונית. מצב לאחר CRIF מסמר GAMMA בירך שמאל 28/04/26 (שבר אינטרטרוכנטרי).
#אורתופדי: פצע תקין, סיכות הוסרו, דורך לפי סבילות.
#כלייתי: ENOXAPARIN 20 מ"ג, ALFACALCIDOL, LANTHANUM. בדיקות דם היום.
#סוכרת: LANTUS 6 פרוטוקול, LINAGLIPTIN. ב-ESRD דרישת אינסולין יורדת, סיכון להיפוגליקמיה. מעקב סוכרים.
#לחץ דם: METOPROLOL 25 מ"ג, נחזיר VASODIP. כעת ל"ד 150/70.
#עצמות: אוסטאופורוזיס ושבר שביר ב-ESRD. אין להתחיל ביספוספונט ללא הערכת מחלת עצם כלייתית מלאה וייעוץ נפרו ואנדו.
#נוירולוגית: LEVETIRACETAM 500 מ"ג פעמיים ביום, מותאם המודיאליזה. ללא אירועים.
#כאב: מדבקת BUPRENORPHINE שבועית, PARACETAMOL, OXYCODONE הצלה. G6PD עם ESRD-HD, נמנע DIPYRONE.

P לביצוע:
מעקב דיאליזה ותוצאות מעבדה (ספירת דם, אלקטרוליטים, סידן, זרחן, PTH).
ייעוץ נפרולוגי ואנדוקריני לתכנון טיפול אנטי אוסטאופורוטי.
תיאום שחרור מתוכנן סביב 21/05, וידוא רציפות דיאליזה במסגרת חוץ.

תוכנית טיפול (יעדי טיפול):
בן 75 לאחר CRIF Gamma nail צד שמאל ב-28/04/26 על רקע שבר אינטרטרוכנטרי לאחר נפילה. ESRD על המודיאליזה כרונית. מטרה לעצמאות בניידות ובמעברים ובשירותים, מיועד לשיקום עד חמישי 21/05.
```
