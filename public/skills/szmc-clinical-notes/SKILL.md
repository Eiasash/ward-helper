---
name: szmc-clinical-notes
description: >
  Generate professional SZMC ward clinical notes in exact institutional format.
  PRIMARY: geriatric/internal medicine admission (קבלה רפואית), discharge
  (סיכום שחרור / סיכום אשפוז), and consultation letters (ייעוץ). Secondary: ED
  discharge. Trigger on: "כתוב לי קבלה", "כתוב סיכום שחרור", "ייעוץ", "draft a
  note", or patient data upload. Auto-runs geriatric pharm analysis for ward
  notes. Generates HTML export for Chameleon EMR paste.
---

# SZMC Clinical Notes Skill

## OUTPUT FORMAT — CRITICAL

**Plain text only. No HTML, no tables, no markdown in the note itself.**
User copies each section into Chameleon EMR fields. Hospital system generates the printout.
- Labs inline prose: `נתרן 136, אשלגן 4.8, CRP 18.4.`
- Lab trends in discharge: `סידן: 12.3 > 9.8 (20/04)`, `נתרן: 128 > 140`
- Medications: one per line in SZMC format
- Problem headers use `#` as plain text (ward notes only, not ED discharge or consults)
- # headers should be **short and disease-focused**: `# עיניים` not `# MGD Blepharitis עם יובש`
- תוכנית is a bare verb list — no bullets, no numbers
- Lab values: pull exact numbers, never round
- המלצות בשחרור and המשך טיפול תרופתי = **numbered lists 1-N** (not bullets, not dashes)

---

## CHAMELEON EMR PASTE RULES — CRITICAL

Validated against actual Chameleon rendering. **Violations corrupt the note.**

### Forbidden

| ❌ Never use | Why | ✅ Use |
|---|---|---|
| `→` `←` `↑` `↓` (Unicode arrows) | Render as `?` | Single `>` for transitions |
| `**bold**` | Renders literally | Plain text, no bold |
| `--` (double dash) | Encoding artifact | Single `-` or new line |
| `>>>>` (multiple >) | Visual noise | Single `>` |
| `>200` `<50` | Flip in RTL | `מעל 200`, `מתחת 50` |
| `q8h` `q6h` `qd` `bid` | Confusing in Hebrew | `כל 8 שעות`, `פעם ביום` |
| Trailing `?` after statement | Looks like encoding error | Rewrite or remove |

### Approved transition syntax

Single `>` with spaces for dose/regimen changes and lab trends:
```
Lantus 22 > 10-12 יחידות
Furosemide IV 20 מ"ג פעמיים ביום > 40 מ"ג כל 8 שעות
Haloperidol PRN 2.5 מ"ג > 0.5 מ"ג מקסימום
סידן: 12.3 > 11.6 > 9.8 (20/04)
קראטינין: 1.55 > 1.42 > 1.03
```

### Section headers

Plain Hebrew word + colon. No asterisks, no decoration:
```
תרופות להפסיק היום:
Clonazepam 0.5 מ"ג - לא מומלצת בקשישים
```

---

## MIXED-LANGUAGE BIDI RULES — BATTLE-TESTED

### The drug card pattern — USE THIS

For any medication recommendation, structure as 2-3 line "drug card". Always safe:

```
Clonazepam 0.5 מ"ג
תרופת הרגעה לא מומלצת בקשישים עם מחלת ריאות
```

```
Pregabalin 150 מ"ג
להפחית עד 75 מ"ג למשך 3 ימים ואז להפסיק לחלוטין
```

```
Paracetamol
1 גרם דרך הווריד כל 6 שעות קבוע
במקום לפי צורך, למשכך כאב בטוח ולהפחתת אופיאטים
```

Line 1: drug name (+ dose if short). Line 2+: pure Hebrew instruction.

### Safe patterns confirmed

✅ One English word per line, at start OR end (not both)
✅ Drug name + pure Hebrew description on next line
✅ Taper as `להפחית עד N מ"ג למשך X ימים` (no `מ-X ל-Y` with English)
✅ Dates `DD/MM/YY` stable in Hebrew sentence
✅ Numeric range pure Hebrew: `מ-60 עד 514` stable
✅ English terms in comma list: `TSH, B12, חומצה פולית` stable

### Unsafe patterns — will flip

❌ `Melatonin 3 מ"ג לפני שינה במקום Trazodone` — English at both ends
❌ `לטייפר Pregabalin מ-150 ל-75 מ"ג` — taper range with English drug
❌ `להעביר Paracetamol 1 גרם דרך הווריד כל 6 שעות` — English mid-sentence

### Fix: two short lines

Instead of `Melatonin 3 מ"ג לפני שינה במקום Trazodone`:
```
להפסיק Trazodone
להתחיל Melatonin 3 מ"ג לפני שינה
```

---

## GERIATRIC CONSULT SCOPE — STAY IN LANE

### IN-LANE — specific recommendations OK

- **HAP/CAP/UTI/SSTI/C. diff**: specific empiric ABX per SZMC DAG (always `project_knowledge_search` first)
- **Deprescribing**: specific drugs to stop/taper
- **Delirium pharm**: Haloperidol 0.25-0.5 mg PRN, Quetiapine 12.5-25 mg bedtime
- **Delirium non-pharm**: reorientation, sleep, mobility, sensory aids
- **CHF basics**: diuretic titration, K monitoring, spironolactone
- **Electrolytes**: specific correction protocols
- **Renal dose adjustment**: for all recommended drugs
- **VTE prophylaxis**: Padua, pharm vs mechanical
- **Pain**: Paracetamol scheduled, opioid titration
- **Glycemic de-intensification** in frailty
- **Functional/cognitive assessment**
- **Israeli legal framework**: capacity, surrogate decision-maker

### OUT-OF-LANE — refer generally

- Cholangitis/hepatobiliary workup (MRCP, ERCP, biopsy) → גסטרו
- Surgical candidacy → כירורגיה
- Quantitative oncology prognosis → אונקולוגיה (don't give numbers)
- Invasive cardiology (cath, TAVI) → קרדיולוגיה
- Specialty-specific imaging beyond routine

### Referral language

```
לדיון עם גסטרו לגבי המשך בירור כבדי
לשקול התייעצות כירורגית להערכת הקולקציה באגן
לשקול התייעצות אונקולוגית לגבי סטטוס המחלה
לבירור מול המחלקה האחרונה לגבי טיפולים קודמים
```

---

## JARGON RULES — WRITE AS TO A LAYPERSON

**Non-geriatric teams do NOT know geriatric terminology.** Imagine a family member or nurse reading the note.

### Forbidden in consults to non-geriatric teams

| ❌ Never use | ✅ Plain Hebrew |
|---|---|
| CFS, Clinical Frailty Scale | `מטופל סיעודי`, `תלוי לחלוטין בטיפול`, `מצב כללי חלש מאוד` |
| Frailty, פרגיליות | `מצב כללי חלש` |
| Deprescribing | `להפסיק תרופות מיותרות` |
| Beers, STOPP, START | (omit — just explain why drug inappropriate) |
| ACB, Anticholinergic burden | `תרופות שמחמירות בלבול בקשישים` |
| Polypharmacy | `ריבוי תרופות` |
| BPSD | `הפרעות התנהגות על רקע דמנציה` |
| CAM positive | `בלבול פעיל`, `דליריום פעיל` |
| PAINAD | `הערכת כאב במטופל שאינו מתקשר` |
| Sarcopenic obesity | `תת-תזונה למרות השמנה` |

### Goals of care — DO NOT raise proactively

**Do not include GOC recommendations in routine consults.** Treating team + oncology + family own that conversation.

Raise only if:
- Specifically asked by consulting team
- Imminent end-of-life (hours-days)
- Capacity/surrogate question (Israeli legal) — then refer to עו"ס
- **Discharge note where GOC was actually discussed with patient/family** — then it lives as `# טיפול יעדי (Goals of Care)` *inside* מהלך ודיון, not as a top-level section

When needed in a consult, frame indirectly:
```
לשקול בהתאם להעדפות המטופל והמשפחה
```

### Audience awareness

- To another geriatrician: jargon OK (rare)
- Internal ward tracking: jargon OK
- To non-geriatric team: plain Hebrew only

### NO glossary section

Never append a "מילון מונחים" / glossary to discharge notes. If a term needs explaining, expand it inline once: `ESBL (חיידק עמיד רחב טווח)`. The receiving GP doesn't need a vocab list.

---

## WORKFLOW

1. Collect patient data
2. Determine note type (ward admission / discharge / consult / ED)
3. Search project knowledge for drug dosing, DAG antibiotics, guidelines
4. Draft note in plain text, section by section in **printed-output order** (see below)
5. Run geriatric analysis (ward notes only, show in chat AFTER note, NOT in HTML)
6. Generate HTML export — RTL, David font, section divs with copy buttons
7. If empiric ABX needed: always search SZMC DAG first

---

## SECTIONS — PRINTED-OUTPUT ORDER (gold standard)

### Admission (קבלה)
כותרת → הצגת החולה → אבחנות פעילות → אבחנות ברקע → ניתוחים בעבר → תלונה עיקרית → רקע רפואי → מחלה נוכחית → רגישויות → תרופות בבית → הרגלים → תפקוד → בדיקה גופנית → בדיקות עזר → בדיקות מעבדה → דיון ותוכנית → חתימה

### Discharge (סיכום אשפוז) — **REVISED per חדד תמר 20/04/26 final**

This is the **printed output order** as it appears on the SZMC letterhead. Each section below maps to a paste field; the system assembles it in this sequence:

1. **כותרת** (auto: letterhead, demographics, תנועות table)
2. **אבחנות פעילות** — English UPPERCASE, modifier (`- Resolved`, `, Recurrent`, `M/P`) where applicable
3. **אבחנות ברקע** — chronic conditions
4. **רגישויות** — list with reactions (or `לא ידוע`)
5. **תרופות בבית** — pre-admission home medications in SZMC format
6. **הצגת החולה** — *single line* (e.g., `בת 90, נשואה, הגיעה מרפואה דחופה-מיון, מתגוררת בבית עם המטפלת`)
7. **תלונה עיקרית** — 1-2 lines
8. **מחלה נוכחית** — full narrative (this comes BEFORE רקע רפואי in discharge, opposite of admission)
9. **רקע רפואי** — `פרוט מחלות:` (organ-system dash format) + `אבחנות בעבר:` (English UPPERCASE list)
10. **הרגלים** — `מעשן: לא / שימוש באלכוהול: לא / שימוש בסמים: לא`
11. **בדיקה גופנית בקבלה** — vitals + system exam from admission
12. **בדיקות עזר (פירוט)** — **discrete section, BEFORE narrative**: raw cultures + imaging reports together. Cultures with sensitivity panel, imaging reports verbatim from radiology
13. **בדיקות מעבדה** — short prose trends only: `סידן: 12.3 > 9.8 (20/04)`, `נתרן: 128 > 140`, `קראטינין: 1.55 > 1.03`, `PTH: 7 (מדוכא)`. Full lab table auto-appends from EMR
14. **מהלך ודיון** — `# headers` per problem, disease-focused & short. Includes `# טיפול יעדי (Goals of Care)` if discussed and `# תפקוד` at end
15. **המלצות בשחרור** — **numbered 1-N**, each a single recommendation. Brief references to PT/OT/dietician (`הפניה לפיזיותרפיה בבית`, `הפניה לריפוי בעיסוק בקהילה`)
16. **המשך טיפול תרופתי** — **numbered 1-N**, SZMC format with Hebrew brand in parens
17. **(auto-appended)** — full lab table + cultures table + PT functional assessment block (signed by PT herself)
18. **חתימה** — see signature section

**REMOVED from discharge** (do not produce):
- ❌ `תרופות באשפוז` (in-hospital med list) — not in printout
- ❌ `מילון מונחים` (glossary) — not used
- ❌ Full PT/OT/dietician prose blocks in main body — these go elsewhere (see Allied Health below)
- ❌ Standalone `# AF, CHADS-VASc` style mini-sections unless management actually changed
- ❌ `# חסך ויטמין D קשה` as standalone — fold into the relevant problem (e.g., # היפרקלצמיה)

### Consult (ייעוץ)
כותרת (ייעוץ גריאטרי + תאריך + מטופל + מחלקה מפנה + יועץ) → סיבת הייעוץ → דיווח → הערכה → המלצות תרופתיות (להפסיק/להוסיף/לשנות מינונים) → טיפול לא-תרופתי → בדיקות להשלמה → הפניות → ביקור חוזר → חתימה

---

## ALLIED HEALTH (DISCHARGE) — **REVISED**

**PT, OT, and dietician do NOT belong in the doctor's narrative body.** Each is handled separately in the Chameleon system:

- **פיזיותרפיה (PT)** — auto-attaches to the end of the printout, written and signed by the PT herself (block titled `מצב תפקודי לפי הערכת הפיזיותרפיה`). Doctor does not write this.
- **ייעוץ תזונה (Dietician)** — pastes into its own sub-tab under המלצות בשחרור (the "ייעוץ תזונה" sub-button). Doctor does not write a full nutrition prose block.
- **ריפוי בעיסוק (OT)** — pastes into its own sub-tab under המלצות בשחרור (the "ריפוי בעיסוק" sub-button). Doctor does not write a full OT prose block.

**What the doctor DOES write:**
- A single-line `# תפקוד` summary inside מהלך ודיון describing functional status and that PT was involved
- 1-2 numbered items in המלצות בשחרור referring out: `הפניה לפיזיותרפיה במסגרת הבית (יט"ב)`, `הפניה לריפוי בעיסוק בקהילה להערכת סביבה ביתית`

If the user explicitly asks for a full PT/OT/dietician prose block (e.g., "give me text to paste into the dietician sub-tab"), then write it as a separate copyable section — but don't insert it into the main note.

---

## MEDICATION FORMAT

SZMC standard: `[Generic] ( [Brand Hebrew/English] ) [Route] [Dose] [Unit] X [Freq] / [Period]`

```
Furosemide ( פוסיד ) P.O. 40 mg X 1 / d
Apixaban ( Eliquis ) P.O. 2.5 mg X 2 / d
Hydroxyethylcellulose ( V-teers ) ocular 1 drop X 10 / d קבוע
```

### Discharge Rx rules
- **Numbered 1-N** as a list (not bullets, not dashes)
- **Free water for PZ**: `Water ( Water ) per NG tube 350 ml X 3 / d`
- **PRN with indication + duration**: `Loratadine ( Loratadim ) P.O. 10 mg X 1 / d למשך 20 ימים — גירוד מפושט`
- **Time-limited** (e.g., eye drops post-procedure): include `למשך X ימים`
- **Side-specific** (eye drops): `עין שמאל` or `עין ימין` or `דו"צ`
- **Formula**: `NUTREN 2 per PZ 660 ml / d (30 ml/hr X 22h)`
- **Completed ABX** → omit from discharge Rx
- **Suspended/conditional drugs** (e.g., prophylactic ABX paused during active treatment) → keep in list with explanatory note in parens about restart conditions
- Each line ends `קבוע` or `לפי צורך`

---

## KEY STRUCTURAL RULES

### Problem headers (ward discharge notes)
**Always `#` headers, disease-focused, short:**
- ✅ `# עיניים` / `# היפרקלצמיה` / `# בקטריוריה אסימפטומטית` / `# שברי דחיסה T12 ו-L1` / `# בלבול` / `# היפונתרמיה` / `# AKI על CKD - חלפה` / `# אלקלוזה נשימתית` / `# טיפול יעדי` / `# תפקוד`
- ❌ `# MGD Blepharitis עם יובש בעיניים` (too long)
- ❌ `# Issue: Hypercalcemia of malignancy with secondary AKI` (English narrative)

**Header sequencing in מהלך ודיון:**
1. Acute injury / chief presenting problem first
2. Cardinal metabolic/medical problem
3. Infection or culture-related items
4. Neuro (delirium, etc.)
5. Resolving problems (hypoNa, AKI)
6. Minor lab findings (alkalosis, vit D, etc.)
7. Consult-driven items (eyes, derm, etc.)
8. `# טיפול יעדי` if GOC discussed
9. `# תפקוד` at the very end

### רקע רפואי format (admission AND discharge)
Two-part structure:
```
פרוט מחלות:
לבבי - פרפור עליות, אי ספיקת לב עם תפקוד סיסטולי שמור
וסקולרי - יל"ד
כלייתי - אי ספיקת כליות כרונית
המטולוגי - לימפומה ידועה במעקב בהדסה
...

אבחנות בעבר:
PSEUDOPHAKIA - PROSTHETIC LENS - BE
```

### Diagnoses
**Active** (this admission): `DIAGNOSIS - Suspected` / `DIAGNOSIS, RESOLVING` / `PALLIATIVE CARE` / `M/P` (malignancy-related) / `- Resolved` / `, Recurrent`
**Background** (chronic): IDA and SUBCLINICAL HYPOTHYROIDISM → always background. Add EF and date for HFPEF (`HFPEF 60-65% EF 6/2024`). Add level for fractures (`FRACTURE OF VERTEBRAL COLUMN, T12/L1`).

### Plan patterns
Bare verbs. `HOLD [DRUG]` / `[TEST] (?)` / `לשקול [ACTION]`. Discharge המלצות בשחרור MUST be numbered 1-N.

---

## GERIATRIC REQUIREMENTS (ward notes)

1. Functional baseline (pre-morbid AND current)
2. Mobility aid, cognitive status, caregiver, living situation
3. Padua score at end of מחלה נוכחית. CHADS2/VASc if AF.
4. Code status if discussed
5. PT/OT/dietician referrals in המלצות בשחרור (brief, numbered)
6. Delirium assessment if relevant
7. `# תפקוד` summary at end of מהלך ודיון

---

## GERIATRIC ANALYSIS (chat only, not HTML, ward notes only)

```
📋 ניתוח גריאטרי — [Patient]
🔴 Critical  🟠 Warning  🔵 Gap  💡 Pearl
```
Max 10-12 flags. Domains: Beers 2023, STOPP/START, renal dose, interactions, falls, delirium, missing workup (cognitive assessment, bone protection, VTE, code status, TSH, HbA1c).

**This section uses geriatric jargon — it's for the geriatrician, not for the consulting team or the discharge document.**

**Specific flags to always check on discharge:**
- Carrying forward home benzos / Z-drugs (Brotizolam, Zolpidem, Clonazepam) after delirium episode → flag
- Apixaban dose reduction criteria — need ≥2 of 3 (age ≥80, weight ≤60 kg, Cr ≥1.5) to justify 2.5 mg BID; flag if downdosed without meeting criteria
- Vitamin D restart timing after hypercalcemia
- Mirtazapine carried at admission dose without reassessment
- Home prophylactic ABX (Nitrofurantoin, TMP-SMX) paused during treatment — restart logic documented?
- Empiric ABX narrowed to match culture sensitivity?

---

## SIGNATURE

Standard:
```
חתימת רופא: [שם]
```

**Discharge** — order matters in printout:
```
סיכום האשפוז סופי רק לאחר חתימת רופא בכיר
רופא בכיר: ד"ר [שם]
חתימת רופא/ה מתמחה: ד"ר [שם] [מ.ר.] תאריך חתימה: DD/MM/YY HH:MM
```
The senior cosignature line appears ABOVE the fellow's signature in the printed output, preceded by the warning line. If unsigned, print shows `סיכום לא חתום` × 3.

Consult:
```
חתימה: ד"ר Eias Ashhab
מתמחה גריאטריה
DD/MM/YY
```

---

## HTML EXPORT

- `dir="rtl"`, `David, Calibri, sans-serif`, `white-space: pre-wrap`
- Each EMR section as `<div class="section">` with copy button
- One copy button per Chameleon paste field (matches printed-order section list)
- English terms: `<span dir="ltr">`
- File: `kabala_{last}_{first}_{DDMMYY}.html`, `shichrur_{last}_{first}_{DDMMYY}.html`, or `yeutz_{last}_{first}_{DDMMYY}.html`

---

## QUALITY CHECKLIST

### All notes
- [ ] No Unicode arrows (→ ← ↑ ↓), no `**`, no `--`, no `>>>>`
- [ ] Only single `>` for transitions
- [ ] No `>200`/`<50` — spelled out as `מעל`/`מתחת`
- [ ] No `q8h`/`q6h` — spelled out `כל N שעות`
- [ ] No trailing `?` in prose — only `(?)` as plan uncertainty marker
- [ ] Drug recommendations as drug card (2-3 lines), no mixed English-Hebrew-English
- [ ] Dates as `DD/MM/YY`
- [ ] Lab values exact, not rounded

### Discharge — printed-order discipline
- [ ] Section sequence exactly matches the 18-step printed order above
- [ ] רגישויות + תרופות בבית come **before** narrative (not after)
- [ ] הצגת החולה is a **single line**, not a paragraph
- [ ] מחלה נוכחית comes **before** רקע רפואי (opposite of admission)
- [ ] רקע רפואי has both `פרוט מחלות:` and `אבחנות בעבר:`
- [ ] בדיקות עזר (פירוט) is a **discrete section** holding cultures + imaging together, BEFORE narrative
- [ ] בדיקות מעבדה is **short prose trends** only — no full table (auto-appends)
- [ ] # headers are **short and disease-focused**
- [ ] # טיפול יעדי lives **inside** מהלך ודיון (if GOC was discussed)
- [ ] # תפקוד at end of מהלך ודיון
- [ ] המלצות בשחרור = **numbered 1-N**
- [ ] המשך טיפול תרופתי = **numbered 1-N**, Hebrew brand in parens
- [ ] **NO** glossary, **NO** תרופות באשפוז section, **NO** PT/OT/dietician prose blocks in body
- [ ] PT referral, OT referral, dietician referral mentioned briefly in המלצות בשחרור only
- [ ] Completed ABX not in discharge Rx
- [ ] Attending cosignature; signature lines in correct order

### Discharge — geriatric red flags to verify
- [ ] Brotizolam/benzos/Z-drugs after delirium — justified or stopped?
- [ ] Apixaban dose meets reduction criteria (≥2 of 3)?
- [ ] Vitamin D status reassessed
- [ ] Mirtazapine dose reviewed
- [ ] Home prophylactic ABX — restart logic documented?
- [ ] Empiric ABX narrowed to culture sensitivities?

### Ward admission notes
- [ ] Diagnoses in English; IDA/hypothyroid in background
- [ ] רקע רפואי present
- [ ] Meds in SZMC format
- [ ] Padua score; CHADS2/VASc if AF
- [ ] Problem-based `#` discussion
- [ ] Functional status one value per field
- [ ] Geriatric analysis in chat only

### Consults
- [ ] Scope correct — in-lane items specific, out-of-lane referred generally
- [ ] No jargon — no CFS, Beers, STOPP/START, ACB, BPSD, CAM, PAINAD, deprescribing, polypharmacy
- [ ] No proactive GOC unless asked or imminent EOL
- [ ] Drug recommendations as drug cards
- [ ] Hebrew accessible to non-geriatric reader

---

## REFERENCE PATTERNS (compact)

**CHF triggers:** א. קרדיאלי ב. וסקולרי ג. שינוי אורחות חיים ד. זיהומי — each with evidence + counter-argument.

**LP:** `CT מוח ללא ממצא, ניקור מותני סטירילי, נוזל צלול, ל.פ. X ס"מ מים, Y מבחנות.`

**Culture results:** `סוג דגימה: [X] / חיידק: [X] / רגיש ל: [list] / עמיד ל: [list] / תאריך: DD/MM/YYYY`

**POCUS:** `בדיקת IVC, כ-X ס"מ, קריסה של כ-Y%.`

**Allergy:** `[Drug] - תגובה: [reaction]` or `[Drug] - תגובה: לא ידוע`

**Habits:** `מעשן: לא / שימוש באלכוהול: לא / שימוש בסמים: לא`

**ED discharge (no # headers):** Style 1: `במיון —` then `לסיכום —`. Style 2: bare lines.

**Departments:** `גריאטריה -מח` / `גריאטריה מוגבר` / `רפואה דחופה-מיון` / `רפואה פנימית` / `שיקום`

---

## CHANGELOG

- **2026-04-20**: Major restructure based on חדד תמר 20/04/26 final discharge. New printed-order section sequence (18 steps); רגישויות + תרופות בבית moved before narrative; בדיקות עזר promoted to discrete pre-narrative section; בדיקות מעבדה reduced to prose trends; PT/OT/dietician removed from main body (handled by separate Chameleon sub-tabs and PT auto-attach); המלצות + טיפול תרופתי standardized as numbered lists; glossary section removed; signature ordering corrected; added discharge-specific geriatric red-flag checklist (benzos after delirium, Apixaban dosing, Vit D restart, Mirtazapine reassessment, prophylactic ABX restart logic, ABX-culture narrowing).
