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
- Lab trends in discharge: **PROSE ONLY, NO ARROWS** — `CRP בקבלה 7.72, חלף במהלך האשפוז ל-1.35 בשחרור`. Single `>` is reserved for med tapers (`Lantus 22 > 10-12`), NOT lab trends — Chameleon mangles arrow chains in lab section.
- Medications: one per line in SZMC format
- Problem headers use `#` as plain text (ward notes only, not ED discharge or consults)
- # headers should be **short and disease-focused**: `# עיניים` not `# MGD Blepharitis עם יובש`
- תוכנית is a bare verb list — no bullets, no numbers
- Lab values: pull exact numbers, never round
- המלצות בשחרור and המשך טיפול תרופתי = **DASH list (-)** (Eias 28/04/26 — easier to delete items without renumbering; EMR auto-numbers drug list anyway)
- L/H suffixes from lab printouts: **NEVER carry over** — write `(מעל הנורמה)` / `(מתחת לנורמה)` in parens instead

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

### Approved transition syntax — CONTEXT-DEPENDENT

**Med tapers / regimen changes (NARRATIVE prose):** Single `>` with spaces:
```
Lantus 22 > 10-12 יחידות
Furosemide IV 20 מ"ג פעמיים ביום > 40 מ"ג כל 8 שעות
Haloperidol PRN 2.5 מ"ג > 0.5 מ"ג מקסימום
```

**Lab section trends (CRITICAL — no arrows, not even `>`):** Use full Hebrew prose:
```
✅ קראטינין בקבלה היה 0.72, יציב במהלך האשפוז.
✅ סידן בקבלה 11.7, במהלך האשפוז 11.0-11.3, בשחרור 11.2.
✅ CRP בקבלה 7.72, חלף במהלך האשפוז ועמד על 1.35 בשחרור.

❌ סידן: 12.3 > 11.6 > 9.8 (20/04)        ← arrows corrupt in lab paste field
❌ קראטינין: 1.55 > 1.42 > 1.03            ← same
❌ Hb 10.8 → 10.9                          ← Unicode arrows always forbidden
```

The lab paste field in Chameleon is more sensitive to non-Hebrew formatting than the narrative. Use prose only.

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

### Admission תפקוד subsection format — **VERIFIED Salaymeh 29/04/26 print**

The admission תפקוד field is a **structured subsection**, not free prose. Use these labels in this order:

```
מגורים: מתגורר בבית / בבית אבות / מוסד סיעודי
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
```

**Key rules:**
- ADL items use a fixed **3-tier grading**: עצמאי / עזרה חלקית / עזרה מלאה. No other terms.
- **Do NOT use the MRS (Modified Rankin Scale) in admission notes** — it is not part of the standard SZMC admission ADL section. If functional severity needs a one-liner summary in מהלך ודיון or in הצגת החולה, use plain Hebrew (`סיעודי`, `מרותק למיטה`, `תלוי לחלוטין`) not "MRS 5".
- Each line is `label: value` — no commentary, no qualifiers like "כנראה" or "מדווח".
- The ADL subsection IS the source of truth for all downstream `# תפקוד` summaries (in מהלך ודיון and in discharge notes). Don't restate; reference.
- All items per ADL: include even if עצמאי for everything — completeness signals you actually assessed.

### Discharge (סיכום אשפוז) — **REVISED per Bloch 28/04/26 print**

This is the **printed output order** as it appears on the SZMC letterhead. Each section below maps to a paste field; the system assembles it in this sequence:

1. **כותרת** (auto: letterhead, demographics, תנועות table)
2. **אבחנות פעילות** — **ACUTE ADMIT REASON ONLY** (chronic conditions go to ברקע). Add `BLOOD TRANSFUSION X N units` if patient received any units during stay. English UPPERCASE optionally with Hebrew label `(Hebrew)`. Modifiers: `- Resolved`, `- Resolving`, `, Recurrent`, `M/P`. Always check Type 2 MI in elderly with sepsis/shock.
3. **ניתוחים באשפוז** — **NGT / urinary catheter / PEG** insert/remove events from the AZMA tube icon (hover shows dates). **SKIP peripheral IV** (gets stripped, not clinically tracked). If no tube events during admission, leave blank.
4. **אבחנות ברקע** — chronic conditions, English UPPERCASE. **EMR auto-merges "אבחנות בעבר" entries here** — audit pre-populated entries for staleness/duplicates but don't auto-delete (they were entered by prior admissions for a reason).
5. **הצגת החולה** — *single line* (e.g., `בת 90, נשואה, הגיעה מרפואה דחופה-מיון, מתגוררת בבית עם המטפלת`)
6. **תלונה עיקרית** — 1-2 lines
7. **מחלה נוכחית** — **CAUTION: This field APPENDS to the admission text in the EMR**, it does not replace. Approach: **read the existing admission paragraph, audit for typos/voice-rec errors/missing info, output a cleaned version** for retro paste-over. The doctor manually clears the old text and pastes the audited version while writing the discharge.
8. **רקע רפואי** — `פרוט מחלות:` (organ-system dash format) + `אבחנות בעבר:` (English UPPERCASE list) + `פרוט ניתוחים/פעולות` + `ניתוחים בעבר`
9. **רגישויות** — list with reactions (or `לא ידוע` / `לא התקבל מידע`)
10. **הרגלים** — `מעשן: לא / שימוש באלכוהול: לא / שימוש בסמים: לא`
11. **בדיקה גופנית בקבלה** — vitals + system exam from admission
12. **תרופות בבית** (auto sidebar from Chameleon DB) — Title Case format. Inherits Chameleon's casing — do NOT force ALL-CAPS here.
13. **בדיקות עזר (פירוט)** — discrete section, BEFORE labs: cultures FIRST (with full sensitivity panel), then imaging reports verbatim, then procedures. NEVER labs. **Date OK; STRIP all of: reporting doctor names (radiologist/pathologist), accession numbers, vial IDs, מספר בדיקה.**
14. **בדיקות מעבדה** — **CATEGORIZED PROSE TRENDS, NO ARROWS** (Eias 28/04/26):
    - **Categories**: ביוכימיה / מדדי דלקת / ספירת דם / גזים (separate paragraphs)
    - **Format**: `<param> בקבלה X, במהלך Y, בשחרור Z`
    - **Max 2-3 numbers** per parameter — do not list 5 timepoints of the same lab
    - **Drop redundant**: if Cr listed, **omit eGFR and BUN** (covered)
    - **Total Ca → correct for albumin** if same-day specimen has both. Formula: `Corrected Ca = measured + 0.8 × (4.0 − albumin)`. Cite the corrected value when albumin <4.0. Ionized Ca needs no correction.
    - **NO L/H suffix** — use `(מעל הנורמה)` / `(מתחת לנורמה)` in parens
    - Full lab table auto-appends from EMR after this section anyway — keep curated section focused on clinically relevant moves
15. **מהלך ודיון** — **MUST OPEN with the patient summary template** (Eias 28/04/26):
    ```
    בת X סיעודית עם דמנציה, מרותקת למיטה, מוזנת דרך PEG... [demographics + functional + key chronic conditions] עם הרקע הנ"ל -

    התקבלה בשל [acute presentation]
    במיון בבדיקת [vitals + exam]
    במעבדה (כולל בדיקות עזר) [labs + imaging summary]
    [ייעוצים במיון אם היו]
    אושפזה בשל [reason] במחלקתנו [purpose]
    בקבלתה למחלקה [exam + labs comparison to ED]

    במהלך אשפוז הציגה את הבעיות הבאות להתייחסות:
    ```
    THEN `# headers` per problem (disease-focused & short). `# טיפול יעדי` **only if a documented decision was made** (don't auto-add for speculative GOC). `# תפקוד` always last.
16. **המלצות בשחרור** — **DASH list (-)** (Eias 28/04/26 — easier to delete items without renumbering). Brief references to PT/OT/dietician (`הפניה לפיזיותרפיה בבית`, `הפניה לריפוי בעיסוק בקהילה`). **WARNING: each bullet must be ≤ ~180 chars** or Chameleon truncates mid-word. **Drop generic boilerplate**: skip `במקרה של החמרה - פנייה למיון` and `להביא סיכום אשפוז זה לכל פנייה רפואית עתידית`. Skip generic dietician follow-up if dietician already saw inpatient. Keep clinically actionable items only.
17. **המשך טיפול תרופתי** — **DASH list (-)** (EMR auto-numbers anyway — system overrides our format). Title Case auto-format from Chameleon DB. **For PEG patients, ALWAYS add `Water ( Water ) per gastrostomy 400 ml X 3 / d לפי צורך`**. **Borderline home meds (Furosemide etc.) → keep on PRN with `מינון לפי צורך, לפי החלטת רופא מטפל`** rather than deprescribing in the discharge print (defer that decision to outpatient clinic).
18. **(auto-appended)** — full lab table + cultures table + PT functional assessment block (signed by PT herself)
19. **חתימה** — see signature section

### Drug name casing — narrative vs. drug-list sections

| Section type | Casing | Example |
|---|---|---|
| Narrative prose (מחלה נוכחית, מהלך ודיון, # headers) | **ALL-CAPS English** | `בטיפול ב-CEFTRIAXONE ( ROCEPHIN )`, `החל NORADRENALINE`, `הוחלף ל-PIPERACILLIN-TAZOBACTAM ( TAZOCIN )` |
| תרופות בבית (auto sidebar) | Title Case (Chameleon DB) | `Bisoprolol fumarate ( Concor )` |
| המשך טיפול תרופתי (auto from continued meds) | Title Case (Chameleon DB) | `Olanzapine ( Olanzapine -teva )` |

Don't fight Chameleon's auto-format on the drug-list sections. Only force ALL-CAPS where you're typing free narrative.

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
- **DASH list (-)** as a list — EMR auto-numbers anyway in the print output
- **PEG patients**: ALWAYS include `Water ( Water ) per gastrostomy 400 ml X 3 / d לפי צורך` (flush water)
- **NGT patients**: same flush pattern with `per NG tube`
- **Free water for PZ**: `Water ( Water ) per NG tube 350 ml X 3 / d`
- **PRN with indication + duration**: `Loratadine ( Loratadim ) P.O. 10 mg X 1 / d למשך 20 ימים — גירוד מפושט`
- **Time-limited** (e.g., eye drops post-procedure): include `למשך X ימים`
- **Side-specific** (eye drops): `עין שמאל` or `עין ימין` or `דו"צ`
- **Formula**: `NUTREN 2 per PZ 660 ml / d (30 ml/hr X 22h)`
- **Completed ABX** → omit from discharge Rx
- **Suspended/conditional drugs** (e.g., prophylactic ABX paused during active treatment) → keep in list with explanatory note in parens about restart conditions
- **Borderline home meds with unclear indication** (Furosemide without clear HF/CHF, etc.) → **DO NOT deprescribe in the discharge print**. Keep on PRN with `מינון לפי צורך, לפי החלטת רופא מטפל` and defer the decision to outpatient clinic. Eias's standing rule: discharge isn't the place to make controversial deprescribing calls; flag and defer.
- Each line ends `קבוע` or `לפי צורך`

---

## KEY STRUCTURAL RULES

### Problem headers (ward discharge notes)
**Always `#` headers, disease-focused, short:**
- ✅ `# עיניים` / `# היפרקלצמיה` / `# בקטריוריה אסימפטומטית` / `# שברי דחיסה T12 ו-L1` / `# בלבול` / `# היפונתרמיה` / `# AKI על CKD - חלפה` / `# אלקלוזה נשימתית` / `# טיפול יעדי` / `# תפקוד`
- ❌ `# MGD Blepharitis עם יובש בעיניים` (too long)
- ❌ `# Issue: Hypercalcemia of malignancy with secondary AKI` (English narrative)

**Header sequencing in מהלך ודיון:**

**Open with patient summary narrative** (before any `#` header):
```
בת X סיעודית [+functional status] עם הרקע הנ"ל -

התקבלה בשל [acute presentation]
במיון בבדיקת [vitals + exam findings]
במעבדה (כולל בדיקות עזר) [labs + imaging summary]
[ייעוצים במיון אם היו]
אושפזה בשל [admit reason] במחלקתנו [purpose]
בקבלתה למחלקה [exam + labs comparison to ED]

במהלך אשפוז הציגה את הבעיות הבאות להתייחסות:
```

THEN `# headers` in this order:
1. Acute injury / chief presenting problem first
2. Cardinal metabolic/medical problem
3. Infection or culture-related items
4. Neuro (delirium, etc.)
5. Resolving problems (hypoNa, AKI)
6. Minor lab findings (alkalosis, vit D, etc.)
7. Consult-driven items (eyes, derm, etc.)
8. `# טיפול יעדי` **only if a documented decision was made** with patient/family/אפוטרופוס. Don't auto-add for speculative GOC discussions — that's premature and gets cut.
9. `# תפקוד` at the very end (always)

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
Bare verbs. `HOLD [DRUG]` / `[TEST] (?)` / `לשקול [ACTION]`. Discharge המלצות בשחרור use **DASH list (-)**.

---

## LAB SECTION RULES — VERIFIED 28/04/26

### Categorization (REQUIRED)

Group labs by category in the מעבדה section. Each category is its own paragraph:

```
ביוכימיה:
[creatinine, calcium, phosphate, albumin, glucose, etc.]

מדדי דלקת:
[CRP, procalcitonin if measured]

ספירת דם:
[Hb, WBC differential summary, platelets if abnormal]

גזים בקבלה (וריד / עורקי):
[PH, PCO2, HCO3, lactate, ionized Ca]

וירוסים / תרביות:
[goes in בדיקות עזר section, not here]
```

### Prose, not arrows

**Format**: `<param> בקבלה X, במהלך האשפוז Y, בשחרור Z [— interpretation]`

Examples:
- `קראטינין בקבלה היה 0.72, יציב במהלך האשפוז.`
- `סידן בקבלה 11.7, במהלך האשפוז בטווח 11.0-11.3, בשחרור 11.2.`
- `CRP בקבלה 7.72, חלף במהלך האשפוז ועמד על 1.35 בשחרור.`

### Max 3 numbers per parameter

Don't list 5 timepoints of the same lab. Pick: admission, mid-course (or extreme), discharge.

### Drop redundant parameters

If you list **creatinine**, do NOT also list:
- eGFR (calculated from creatinine — redundant)
- BUN (usually moves with Cr — redundant unless clinically distinct)

### Corrected calcium for total Ca

When reporting **total** calcium, calculate **corrected Ca** if a same-day albumin is available:

```
Corrected Ca = measured Ca + 0.8 × (4.0 − albumin)
```

- Cite the corrected value when albumin <4.0 g/dL
- **Ionized Ca needs no correction** — it's already the "true" value
- Worked example: Ca 11.2, Albumin 3.0 → Corrected = 11.2 + 0.8×(4.0−3.0) = **12.0**
- Always show the math impact when the corrected value crosses a clinically meaningful threshold (e.g., raw appears stable but corrected is rising)

### NO L/H suffixes

Lab printouts use `H` and `L` suffixes (`11.3 H`, `3.0 L`). **Strip these.** Use Hebrew parens instead:

| ❌ NEVER | ✅ Always |
|---|---|
| `Ca 11.3 H` | `Ca 11.3 (מעל הנורמה)` |
| `Albumin 3.0 L` | `אלבומין 3.0 (מתחת לנורמה)` |
| `eGFR 68 L` | (omit eGFR — covered by Cr) |
| `↑` `↓` arrows | spell out `מעל / מתחת לנורמה` |

### בדיקות עזר section — what to strip

When pulling imaging/cultures into the discharge בדיקות עזר section:

| Strip | Keep |
|---|---|
| Reporting radiologist name (`ד"ר סדיקוב פבל`) | Date (`21/04/26`) |
| Pathologist signature | Modality (`צילום חזה`, `CT בטן`) |
| Accession numbers (`C089381`) | Findings prose |
| Specimen IDs (`K04211221`) | Sensitivity panel for cultures |
| `מספר בדיקה: 264056` | `נשאות ל-CRE: שלילי` |

The receiving GP doesn't need provenance metadata — they need the finding.

---

## RECOMMENDATION LENGTH GUARD — CRITICAL

**Verified failure (Sandrowicz + Kazkevich finalized 27/04/26):** Chameleon's המלצות בשחרור field truncates long bullets mid-word in the printed output. Both finalized notes lost text. This means the patient/family copy did NOT contain the full recommendation.

### Hard rule
- **Each המלצה bullet must be ≤ 180 characters** (Hebrew chars count, including spaces and punctuation).
- Before producing the המלצות section, scan each bullet. If any bullet exceeds ~180 chars, **split it into two consecutive dashed items** rather than letting it get cut.

### Self-check pseudo-rule
For each bullet:
```
if len(bullet) > 180:
   split at the most logical boundary (period, "ו-", ":", or change of subject)
   add a new dash line — no renumbering needed (it's a dash list)
```

### Example — too long, will truncate
```
- במידה ויש נפילה חוזרת או החמרה במצב הקליני (תלונות חדשות, החמרה בקוצר נשימה, תלונות חזה, או חולשה משמעותית) יש לפנות בהקדם לרפואה דחופה ולהביא את סיכום השחרור מה אשפוז הנוכחי
```
**216 chars → cuts mid-sentence in printout.**

### Fix — split into two
```
- במידה ויש נפילה חוזרת או החמרה במצב הקליני - פנייה למיון.
- להביא את סיכום השחרור מאשפוז זה לכל פנייה רפואית עתידית.
```

**However**: per Eias 28/04/26, **drop generic boilerplate altogether** — the two lines above are usually skipped from המלצות because they're useless redundancy. Print only clinically actionable items.

### Cardiology / SGLT2i pattern (HFmrEF / HFpEF on discharge)

When discharging with new HFmrEF or HFpEF and DM2 — and beta-blocker / ACE-i held due to comorbidity (e.g., active asthma, AKI) — **prompt the cardiologist for SGLT2i** in the recommendations rather than starting it yourself. Format:

```
לשקול תחילת SGLT2i (Empagliflozin / Dapagliflozin) במרפאה הקרדיולוגית
- אינדיקציה כפולה: HFmrEF + DM2 (HbA1c X)
- בכפוף לתפקוד כליות eGFR > 25
```

This protects you (you didn't initiate without echo + cardiology buy-in) while planting the prompt where it'll get acted on. Same pattern for SGLT2i in CKD (eGFR-based), GLP-1 in obesity-DM2, finerenone in DKD-HFpEF, MRA in HFrEF post-discharge — when the right next-line is owned by another specialty, **write the rec as "לשקול ... במרפאה ..."** rather than no rec at all.

### Active diagnosis discipline
- If you mention a problem only in דיון or in רקע פרוט מחלות, but it has follow-up implications, **also surface it in אבחנות פעילות**. Otherwise the next admission/family physician misses it.
- Common omissions to check before sending: Type 2 MI in any septic shock case, IDA workup status, new HF phenotype, new arrhythmia on telemetry, cancer surveillance findings, sinus opacification on incidental CT.

---

## GERIATRIC REQUIREMENTS (ward notes)

1. Functional baseline (pre-morbid AND current) — pulled from the structured admission תפקוד subsection (3-tier ADL grading, see "Admission תפקוד subsection format" above)
2. Mobility aid, cognitive status, caregiver, living situation
3. Padua score at end of מחלה נוכחית. CHADS2/VASc if AF.
4. Code status if discussed
5. PT/OT/dietician referrals in המלצות בשחרור (brief, numbered)
6. Delirium assessment if relevant
7. `# תפקוד` summary at end of מהלך ודיון (one-line distillation of the structured ADL section, NOT a restatement)

---

## AZMA EMR INTERPRETATION — when reading the patient list and med grid

The AZMA הוראות תרופתיות grid shows **active orders only**. This has two consequences for note-writing and clinical critique:

1. **Struck-through rows** = held or discontinued. These are explicit clinical decisions and should be respected as such — don't "restart" them by reflex when writing a continuation plan.
2. **Absent meds may be intentional clinical choices**, not omissions. Examples: a stroke + PE patient without atorvastatin may have it on hold for transaminitis, drug interaction, or a documented decision to deprescribe. Do NOT auto-flag missing meds as "you should add X" in the geriatric analysis without first confirming the absence is unintentional.
3. **Frailty changes the dosing math.** A bedbound MRS 5 demented patient with PUD and recurrent UGI bleed history on prophylactic-range Clexane (40 mg ×2) instead of weight-based therapeutic (60 mg ×2) is making a defensible **frailty-adjusted** choice — not an undertreatment error. Apply guideline-medicine lens only after asking whether frailty changes the risk-benefit calculation.

**When critiquing an active med list**, frame as **questions** ("is X intentionally held?", "did you consider Y given Z?") rather than directives ("you missed adding X"). The doctor managing the patient has context the grid does not show.

---

## GERIATRIC ANALYSIS (chat only, not HTML, ward notes only)

```
📋 ניתוח גריאטרי — [Patient]
🔴 Critical  🟠 Warning  🔵 Gap  💡 Pearl
```
Max 10-12 flags. Domains: Beers 2023, STOPP/START, renal dose, interactions, falls, delirium, missing workup (cognitive assessment, bone protection, VTE, code status, TSH, HbA1c).

**This section uses geriatric jargon — it's for the geriatrician, not for the consulting team or the discharge document.**

**Framing discipline (Salaymeh 29/04/26):**
- When the active med grid is in front of you (AZMA הוראות תרופתיות), absent meds may be intentional. Frame "missing" items as **questions** not directives.
- Frailty-adjusted dosing (sub-therapeutic anticoag in a bedbound demented patient with bleed history) is defensible — push back on it only if the frailty reasoning is genuinely absent, not just because the dose is below the guideline number.
- Trend data deserves its own flag category. A persistently abnormal Hb across multiple admissions (e.g., 2018→2022→2026 trajectory) is more diagnostic than the current admission's point value.

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
חתימת רופא/ה מתמחה: ד"ר Eias Ashhab מ.ר 000147224
תאריך חתימה: DD/MM/YY HH:MM
```
The senior cosignature line appears ABOVE the fellow's signature in the printed output, preceded by the warning line. If unsigned, print shows `סיכום לא חתום` × 3.

**Eias's license number: 000147224** — bake into all discharge signatures.

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
- [ ] In **lab section**: NO arrows at all — not even `>`. Prose only.
- [ ] Single `>` for med tapers in narrative (NOT in lab section)
- [ ] No `>200`/`<50` — spelled out as `מעל`/`מתחת`
- [ ] No `q8h`/`q6h` — spelled out `כל N שעות`
- [ ] No `H`/`L` lab suffixes — use `(מעל הנורמה)` / `(מתחת לנורמה)` parens
- [ ] No trailing `?` in prose — only `(?)` as plan uncertainty marker
- [ ] Drug recommendations as drug card (2-3 lines), no mixed English-Hebrew-English
- [ ] Dates as `DD/MM/YY`
- [ ] Lab values exact, not rounded

### Discharge — printed-order discipline (verified 28/04/26)
- [ ] **אבחנות פעילות = acute admit reason ONLY** (chronic → ברקע)
- [ ] **+ blood transfusion w/ unit count** if any units given during stay
- [ ] **ניתוחים באשפוז = NGT / urinary cath / PEG events only** (skip peripheral IV)
- [ ] אבחנות בעבר pre-populated — audit, don't auto-delete
- [ ] **מחלה נוכחית** = audited+fixed admission paragraph for retro paste-over (field APPENDS)
- [ ] הצגת החולה is a **single line**, not a paragraph
- [ ] תרופות בבית sits AFTER בדיקה גופנית (auto sidebar) — Title Case, don't force ALL-CAPS
- [ ] **בדיקות עזר** holds cultures FIRST, then imaging, then procedures — **NEVER labs**. **NO doctor names, NO accession numbers, NO vial IDs/מספר בדיקה**. Date OK.
- [ ] **בדיקות מעבדה** = categorized (ביוכימיה / מדדי דלקת / ספירת דם / גזים), prose trends ('בקבלה X, במהלך Y, בשחרור Z'), MAX 3 numbers/test, drop eGFR+BUN if Cr listed, **correct total Ca for albumin same-day**, NO L/H suffixes
- [ ] **מהלך ודיון opens with patient summary template** before any `#` header
- [ ] # headers are **short and disease-focused**
- [ ] **# טיפול יעדי only if documented decision** (not speculative)
- [ ] # תפקוד at end of מהלך ודיון
- [ ] **NO bullet > 180 chars** in המלצות בשחרור (Chameleon truncates) — split if needed
- [ ] **המלצות בשחרור = DASH list (-)**, no boilerplate ("פנייה למיון/הבא סיכום")
- [ ] **המשך טיפול תרופתי = DASH list (-)**, EMR auto-numbers
- [ ] **For PEG patients: include `Water per gastrostomy 400 ml X 3 / d לפי צורך`**
- [ ] **Borderline home meds → keep on PRN with `לפי החלטת רופא מטפל`**, never deprescribe in print
- [ ] Drug names in narrative (מחלה נוכחית / מהלך ודיון) = **ALL-CAPS English**
- [ ] **NO** glossary, **NO** תרופות באשפוז section, **NO** PT/OT/dietician prose blocks in body
- [ ] PT, OT, dietician referrals mentioned briefly in המלצות בשחרור only
- [ ] Completed ABX not in discharge Rx
- [ ] Attending cosignature; signature lines in correct order; **Eias lic 000147224**

### Discharge — active diagnosis completeness check
- [ ] Type 2 MI surfaced if troponin elevated during septic shock?
- [ ] IDA / new anemia phenotype in active dx if workup pending or deferred?
- [ ] New HF phenotype (HFmrEF / HFpEF) in active dx with EF + date?
- [ ] PHT / RV dysfunction in active dx if echo found?
- [ ] Incidental CT findings (sinus opacification, lung nodules) in active dx if follow-up needed?
- [ ] Chronic respiratory failure / O2 dependence in **background** if applicable?

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
- [ ] **תפקוד subsection uses 3-tier ADL grading** (עצמאי / עזרה חלקית / עזרה מלאה) for each of: הלבשה, רחצה, אכילה, הכנת אוכל, ניידות, ניידות בכ"ג, מעברים, שליטה על שתן, שליטה על יציאה
- [ ] **NO MRS scale in admission template** — use plain Hebrew (`סיעודי`, `מרותק למיטה`) for narrative severity descriptors
- [ ] Geriatric analysis in chat only
- [ ] Trend data (multi-admission Hb, Plt, BP) flagged when diagnostic — not just point-in-time numbers

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

- **2026-04-29**: Salaymeh case calibration. **Major changes**: (1) **Admission תפקוד subsection format** specified explicitly — structured key:value lines with **3-tier ADL grading** (עצמאי / עזרה חלקית / עזרה מלאה) for each of הלבשה, רחצה, אכילה, הכנת אוכל, ניידות, ניידות בכ"ג, מעברים, שליטה על שתן, שליטה על יציאה. Plus: מגורים, עזרה, התמצאות, הזנה. (2) **NO MRS (Modified Rankin Scale) in admission templates** — it's not part of the standard SZMC admission ADL section. Use plain Hebrew (`סיעודי`, `מרותק למיטה`) for narrative severity. (3) New **AZMA EMR INTERPRETATION** section: med grid shows ACTIVE orders only; struck-through = held/discontinued; absent meds may be intentional clinical choices, not omissions. Frame critique as questions, not directives. (4) **Frailty-adjusted dosing** is a defensible decision frame — sub-therapeutic anticoag in bedbound demented patient with PUD/UGI bleed history is not automatically wrong. Apply guideline lens only after asking if frailty changes the risk/benefit. (5) Geriatric analysis section now flags trend-data importance — multi-admission Hb/Plt/BP trajectories are diagnostic in their own right (today's case: Hb 8→11 in 2018-2019 → 15.6 in 2022 → 19.4 in Jan 2026 → 18.7 Apr 2026 = unmasked PV after PUD bleeding resolved). (6) Quality checklist for ward admission notes adds: 3-tier ADL items, NO MRS, trend flagging.
- **2026-04-28**: Print-verified discharge calibration on Bloch case. **Major changes**: (1) Recommendations + drug list switched from numbered 1-N to **DASH list (-)** — easier to delete items without renumbering, EMR auto-numbers drug list anyway. (2) Active dx narrowed to **acute admit reason ONLY** (chronic conditions all go to ברקע); add `BLOOD TRANSFUSION X N units` if any units given. (3) ניתוחים באשפוז = NGT/urinary cath/PEG events only (skip peripheral IV). (4) מחלה נוכחית: field APPENDS to admission text — provide AUDITED admission paragraph for retro paste-over. (5) **Lab section overhaul**: categorized (ביוכימיה / מדדי דלקת / ספירת דם / גזים), prose trends with NO arrows ('בקבלה X, במהלך Y, בשחרור Z'), MAX 3 numbers/test, drop eGFR+BUN if Cr listed, correct total Ca for albumin same-day (`Cor = Ca + 0.8×(4-Alb)`), strip H/L suffixes use `(מעל/מתחת לנורמה)` parens. (6) בדיקות עזר: keep curated section, strip doctor names/accession numbers/vial IDs. (7) **מהלך ודיון opens with patient summary template** before any `#` ('בת X+הרקע→התקבלה בשל→במיון→מעבדה→ייעוצים→אושפזה→בקבלתה→הציגה הבעיות:'). (8) `# טיפול יעדי` only if documented decision, not speculative. (9) המלצות drop boilerplate ("פנייה למיון/הבא סיכום"). (10) Tx: always add `Water 400ml X3/d לפי צורך` for PEG; borderline home meds → PRN with `לפי החלטת רופא מטפל`, never deprescribe in print. (11) Eias signature: lic 000147224 baked in.
- **2026-04-27**: Section order corrected based on Sandrowicz + Kazkevich finalized discharges. Order is אבחנות פעילות → ניתוחים באשפוז → ברקע → הצגה → תלונה → מחלה נוכחית → רקע (with פרוט+אבחנות בעבר+ניתוחים) → רגישויות → הרגלים → בדיקה → תרופות בבית (auto sidebar) → בדיקות עזר (cultures→imaging, NEVER labs) → מעבדה (typed trends) → דיון → המלצות → תרופתי → auto → חתימה. Drug name casing rule clarified: ALL-CAPS in narrative only, Title Case in auto drug-list sections (don't fight Chameleon DB). Added RECOMMENDATION LENGTH GUARD (≤180 chars per bullet to avoid Chameleon mid-word truncation — verified failure in both finalized notes). Added SGLT2i-pending-cardiology pattern + active-diagnosis completeness check (Type 2 MI in septic shock, new HF phenotype, IDA workup, incidental CT findings).
- **2026-04-20**: Major restructure based on חדד תמר 20/04/26 final discharge. New printed-order section sequence (18 steps); רגישויות + תרופות בבית moved before narrative; בדיקות עזר promoted to discrete pre-narrative section; בדיקות מעבדה reduced to prose trends; PT/OT/dietician removed from main body (handled by separate Chameleon sub-tabs and PT auto-attach); המלצות + טיפול תרופתי standardized as numbered lists; glossary section removed; signature ordering corrected; added discharge-specific geriatric red-flag checklist (benzos after delirium, Apixaban dosing, Vit D restart, Mirtazapine reassessment, prophylactic ABX restart logic, ABX-culture narrowing).
