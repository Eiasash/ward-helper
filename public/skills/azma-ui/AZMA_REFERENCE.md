# AZMA EMR — Interface Reference (SZMC)

Extracted from the official SZMC AZMA familiarization e-learning (Blossom assignment 79, "familiaritywithazma", Articulate Storyline 3.5 SCORM package), supplemented by Eias's clinical observation of the live medication-orders grid and the canonical icon legend he supplied 2026-05-02. This is the ground-truth reference for what every UI element in the AZMA department-management screen and order grid means.

Use this document (and `azma_reference.json` next to it for programmatic lookup) whenever you're looking at a photo of the AZMA interface and need to know what a column, icon, color, or indicator means.

> **R4 (2026-05-02):**
> 1. §7.3 expanded from a 2-icon to a **7-icon canonical legend** (pen / red circle / blue circle / blue info / Rx / red speech bubble / grey speech bubble), per Eias's reference table. R3's collapse of "blue ℞" into a single approval marker was wrong — blue circle (order finished) and Rx clipboard (protocol attached) are separate icons.
> 2. Quiz evidence upgraded to **manifest-grade** for Q1, Q2, Q4 (was feedback-string-grade in R2/R3). Q4 reclassified as picture-pick (correct = `Picture 13` = the חיידק עמיד column icon). Q5 reclassified as picture-pick (correct = `Picture 7`); blue-pen conclusion held but provenance now downgraded to "manifest + DOM-order convention + feedback-revealer triangulation".
> 3. The 20 PNGs in the bundle are **slide-background art** (logo, stock photos, geometric decorations, a few EMR-adjacent dialogs) — **NOT AZMA EMR screen captures** as R1 claimed. The actual EMR screens are composited inside slide JS files in the source SCORM.

---

## 1. What AZMA is

AZMA is SZMC's central inpatient EMR. It aggregates, in one interface:

- The inpatient medical record ("תיק מטופל באשפוז")
- The maternity/labor record ("תיק יולדת בחדרי לידה")
- The ambulatory outpatient record ("תיק מטופל אמבולטורי")
- An interface to **Ofek / Eitan** for cross-institutional records
- Lab results feeds ("מעבדות")
- Imaging/PACS feed ("מערך הדימות")
- Medical device feeds — monitors, gluco-check, BP cuffs ("מכשור רפואי")
- BI reports

## 2. Getting access (onboarding)

Three-step process; the course makes this explicit because it's the #1 support ticket:

1. Fill the request form from the HR welcome packet. Include a mobile number for callback.
2. Submit the form and have your department head (הממונה / מנהל מחלקה) sign it.
3. HR forwards the form to IT ("אגף מערכות מידע"). After provisioning, IT calls you with login credentials.

**Login:** shortcut on desktop → username + password. Username format: `P` followed by the first 5 digits of your employee number. Click "אשר".

## 3. Department Management screen — main toolbar (top-left, 6 icons)

| # | Icon / Label (HE) | Meaning |
|---|---|---|
| 1 | ניהול מחלקה | Shows the patient census of your primary ward. You can switch to any other ward you have permission for. |
| 2 | תיק מטופל | The full hospital-wide patient chart: tests, visits, imaging, institutes, everything. |
| 3 | דוחות ניתוח (למנתחים) | Surgeon-only: write operative notes. |
| 4 | inbox | Shows abnormal/critical lab results **and** unsigned reports. |
| 5 | נעילת מסך | Lock the screen; when you return you land back in the same place. Use at end of every session. |
| 6 | כפתור יציאה | Exit the system. |

## 4. Department Management screen — the patient list (the main grid, columns 1–21)

Every column has a specific meaning, and most have double-click behavior. Columns are numbered in course order and this matches the visual left-to-right flow.

| # | Column (HE) | Meaning | Double-click |
|---|---|---|---|
| 1 | מחלקה | Department's patient roster | — |
| 2 | חיידק עמיד | Flag: patient has a resistant organism | **Double-click → window with details of the organism and isolation info** |
| 3 | (antibiotic icon) | Antibiotic order requiring Infection Control approval | — |
| 4 | case manager | The attending (senior physician) responsible | — |
| 5 | צד | Internal division (side) of the ward | — |
| 6 | חדר | Room number. **First digit = floor.** | — |
| 7 | (bottom bar) | Ward status: # admitted, free beds, waiting for bed assignment | — |
| 8 | גיל | Patient's age | **Double-click → order tests** |
| 9 | אבחנה | Primary diagnosis from the admission note. **Red text = isolation.** | **Double-click on a red diagnosis → isolation details window** |
| 10 | (vent status / "מ") | Mechanical ventilation status | — |
| 11 | דם | Blood type | — |
| 12 | מספר (blood bank units) | # of units in the blood bank — with color coding: **green = valid sample, units issuable**; **purple = patient known to blood bank**; **yellow = sample is 4–7 days old** | — |
| 13 | בדיקות | Tests ordered for this patient | **Double-click → order-tests screen** |
| 14 | יעוץ | Consults ordered | **Double-click → order-consult screen** |
| 15 | **רפואי — קבלה** (Medical Admission) | Admission-note status. Three states: **done and signed**, **done but unsigned**, **not done**. Unsigned indicator = blue pen (see §6). | — |
| 16 | רפואי — ביקור | Flags absence of the daily morning round | — |
| 17 | רפואי — סיכום | Discharge summary (only visible once one is started). States: **written but unsigned**, **no signed summary exists yet** | — |
| 18 | סיעוד — קבלה סיעודית | Nursing admission status: **not done / done-unsigned / done-signed** | — |
| 19 | סיעוד — מעקב | Nursing handoff tracking. **Green circle 2h before shift-end** = no signed shift summary yet | — |
| 20 | סיעוד — חדש | New physician order that the nurse hasn't yet extracted/actioned. Hover reveals the specific order list. | Hover, not click |
| 21 | סיעוד — איחור | Bell icon reminding nurses of overdue tasks | — |
| — | רקע | Social work involvement indicator: **red = current admission**, **gray = prior admissions** | — |
| — | תנועה אחרונה | The patient's admission date to this ward | — |

## 5. Global toolbar icons (appear across AZMA screens)

| Icon | Action |
|---|---|
| חץ ירוק (green arrow) | Refresh — fetch new data after changing a filter/query |
| מדפסת | Print |
| חדש (new) | Open a new row / field / window |
| מחק (delete) | Cancel/delete current row / field / window |
| יציאה (exit) | Close the current window |
| זכוכית מגדלת (magnifier) | Search/lookup |
| שמירה (save) | Save data |
| תיק אשפוז | Open the inpatient chart. **Shortcut: double-click the patient's name in the grid** |
| קליק שמאלי בשדה טקסט | Opens the templates window for that field |
| תפריט "המבורגר" | Topic/chapter menu |

## 6. Status indicators in the patient-list grid — color codes

- **Red diagnosis text** → patient is on isolation. Double-click → isolation window.
- **Blue pen** on the medical-admission column (col 15) → admission started but **not signed**. (Verified — see §8 Q5.)
- **Green circle** (nursing follow-up, 2h pre-shift-end) → no signed shift summary exists yet.
- **Green / purple / yellow** on the blood bank "מספר" column → sample validity status (see §4 row 12).
- **Red / gray** on "רקע" column → current vs. prior social-work involvement.

## 7. הוראות תרופתיות — order-grid row states (4-axis read)

The medication-orders grid (and the parallel נזלים / לוינים-ונקזים sections) uses **four orthogonal visual axes** to encode an order's state. Read them together; misreading any one of them flips the clinical meaning.

### 7.1 Axis 1 — text color (medication name)

| Color | Meaning |
|---|---|
| **Black** | New or current order (active in the present admission) |
| **Gray** | Old / historical order (audit-trail entry) |

### 7.2 Axis 2 — strikethrough (blue line through the row)

| Display | Meaning |
|---|---|
| **No strikethrough** | The order is still in force |
| **Strikethrough (blue line through name + columns)** | The order is **finished** — its prescription period has ended (the medication ran its course, was cancelled, or was replaced by a new order). **Past tense, not "currently held."** |

### 7.3 Axis 3 — row icon strip (CANONICAL 7-icon legend)

> Source: Eias's reference table 2026-05-02. Each row carries one administration-status icon plus contextual icons.

| Icon | Meaning |
|---|---|
| 🖊 **pen** | Order written by physician, **nurse has not yet given today's dose** (or new order awaiting first administration). |
| 🔴 **red circle / stop** | **Dose given by nurse today** (administration confirmed). For non-medication items in נזלים / לוינים (Foley, peripheral IV, diet order), this means action performed / device in place. |
| 🔵 **blue circle / stop** | **Order finished / course completed** — naturally ended, all doses given, or superseded. **Typically appears on struck-through rows.** This is the icon that confirms an order has fully completed its lifecycle (vs. just being temporarily paused). |
| ℹ️ **blue info** | Linked instructions — typically the insulin sliding-scale protocol or an Rx note. Click to see the linked instruction set. |
| 📋 **Rx (clipboard)** | Prescription / protocol attached to this order (e.g., antibiotic protocol). Distinct from blue info: this is the formal prescription document, not free-form instructions. |
| 💬 **red speech bubble** | **Active nurse comment** on this row — read it on round, it carries clinical context (administration timing, patient response, observed issue, etc.). |
| 💬 **grey speech bubble** | Empty comment slot — nurse has logged nothing on this row. |

> **Canonical-table caveat:** the source table shows these 7 icons with a "more below" scroll arrow. Additional icons may exist below the visible portion (drag-handle, alarm bell, attention flag, etc.) — confirm with Eias if a screenshot ever shows an icon outside this set.

### 7.4 Axis 4 — view filter (top-of-grid)

| Filter | Effect |
|---|---|
| `הצג הוראות` → **בתוקף** | Default — hides strikethrough/finished rows. You see only active orders. |
| `הצג הוראות` → **הכל** | Shows the full audit log including finished / replaced / superseded orders. Use this when you need to reconstruct what's been given through this admission. |

### 7.5 Putting it together — the practical 3×3

When the filter is set to "הכל", the most clinically useful read collapses to:

|  | 🖊 pen | 🔴 red circle | 🔵 blue circle |
|---|---|---|---|
| **Black, no strike** | Active order, **dose still due today** | Active order, **dose already given today** | (Rare) Active order in the process of completing — verify there's no replacement order |
| **Gray + strike** | (Rare) Historical pending — old draft never administered | **Historical, was administered** — audit-log entry | **Historical, course completed** — the typical retired-order signature |

Two ambiguities to resolve at the screen, not from a photo:

1. **Strikethrough on a black-text row** = an order that was just finished today (the period elapsed minutes ago). Rare but possible — confirm by checking whether a black, non-struck replacement order exists below it.
2. **Selection-row blue border** (the highlight when you click a row) is **not** strikethrough. The blue strikethrough always cuts through both the medication name *and* the dose/freq columns — the selection border only outlines the row.

### 7.6 Common workflows that depend on this read

- **Morning ward round:** scan 🖊 rows = "what's still pending for today." Scan 🔴 rows on this morning's date = "what's already on board." For each row also scan the speech-bubble icon — 💬red rows have a nursing comment worth reading.
- **Reconstructing the AC story:** flip filter to הכל. Read all anticoagulant rows top-to-bottom. Black/no-strike = current AC; gray+strike+🔵 = course completed (deliberate transition); gray+strike+🔴 = was administered then ended.
- **Discharge-letter drug rec:** the home-meds list is the union of (gray+struck+🔵 rows representing the patient's pre-admission regimen) ∪ (black, no-strike rows that were started in admission and are intended to continue). Each membership decision is a clinical judgment, not a UI artifact.
- **Insulin sliding-scale lookup:** find the insulin row → click the ℹ️ blue info → read the linked sliding-scale protocol.
- **Antibiotic protocol verification:** find the antibiotic row → click the 📋 Rx clipboard → review the attached prescription/protocol document.

## 8. The 5 assessment questions — questions, options, correct answers

> **Evidence sources:**
> - **Manifest-grade** = explicit `"status":"correct"` marker in `manifest.json` linking the answer record to a `choices.choice_<id>`. This is the canonical SCORM answer key authored by the course creators. Highest reliability.
> - **Feedback-revealer convention** = the wrong-answer feedback string follows the pattern `"לא נכון\n<correct answer text>"` — i.e. wrong-message reveals the right answer. Verified against Q1 and Q2 (where manifest-grade and feedback-revealer agree). Used as a fallback evidence layer.

**Q1.** מה המשמעות של אבחנה המסומנת בצבע אדום?
- מציג תוצאות של חיידק עמיד
- מציג מעורבות של עובדת סוציאלית מעורבת בתיק
- ממתין לביצוע משימה
- ✅ **מעיד על בידוד — בלחיצה כפולה מוצג חלון בידוד**

> **Evidence:** Manifest-grade. `choice_6BQ9pqhHktb` carries `"status":"correct","points":10` in interaction `69QN0fmRaw3`. lmstext = `"מעיד על בידוד - בלחיצה כפולה מוצג חלון בידוד"`. Cross-verified by feedback-revealer.

**Q2.** מהי המשמעות של העמודה "מ"?
- מציג סטטוס מעקב רפואי
- מציג תוצאות מעבדה
- מציג סוג דם של חולה
- ✅ **מציג סטטוס חולה מונשם** (ventilation status)

> **Evidence:** Manifest-grade. `choice_5matUQID1Cs` carries `"status":"correct"` in interaction `5pxqeRCXm84`. lmstext = `"מציג סטטוס חולה מונשם"`. Cross-verified by feedback-revealer.

**Q3.** לחץ על האזור בצילום המסך שלפניך בו ניתן למצוא מטופלים ששהו במחלקה בעבר.

> **Evidence:** Hotspot — no `"status":"correct"` marker in manifest (coordinate-based interaction, not choice-based). Answer not extractable from this bundle. Per the original course content, the answer is the ward-selector dropdown (which exposes past patients alongside current census).

**Q4.** על איזה אייקון תלחץ לחיצה כפולה לקבלת מידע על סוג ומהות חיידק עמיד?

✅ **The "חיידק עמיד" column icon** (column 2 in §4), encoded in the manifest as **`Picture 13`** of a 4-picture choice set (Pictures 10/13/14/15).

> **Evidence:** Manifest-grade. `choice_6ZECgvVmdpT` (lmstext `"Picture 13"`) carries `"status":"correct"` in interaction `6j5rpBF44eW`. The semantic meaning of Picture 13 is identified by cross-reference to slide-content extract Scene 1 / Slide 7 ("חיידק עמיד — מעיד על הימצאות חיידק עמיד אצל מטופל. בלחיצה כפולה יוצג חלון מידע").

**Q5.** איזה חיווי יופיע כאשר יש קבלה רפואית שאינה חתומה?

The slide presents 4 picture choices (each picture shows a pen icon in a different color) with Hebrew captions: עט אדום / עט ירוק / עט כחול / ללא סימון.

✅ **`Picture 7` is the manifest-grade correct answer.** Mapping `Picture 7` → "עט כחול" (**blue pen**) requires Storyline's standard convention that picture choices are laid out in DOM order matching their captions. With that convention, Picture 7 (3rd of 4 pictures, after 5 and 6) maps to the 3rd caption "עט כחול".

> **Evidence:** Manifest-grade for the picture identity. `choice_5pqStZzuY19` (lmstext `"Picture 7"`) carries `"status":"correct"` in interaction `6nXp9KUYDZU`. The picture→caption mapping is **inference by DOM-order convention**; corroborated by the feedback-revealer convention which independently yields blue pen (`"לא נכון\nעט כחול"` parsed as wrong-revealer).
>
> Caveat: definitive confirmation requires the rendered slide JS (`6LAZnfEUaB4.js`) or a live screenshot of the Q5 slide. Until then, this is **manifest + DOM-order + feedback-revealer triangulation** — strong but not screenshot-confirmed.

## 9. Support

24/7 phone support is available at **02-6555990 extension 2 or 5**.

---

## Quick lookup table — when a user sends a screenshot, look here first

| If user points to… | It's most likely… |
|---|---|
| A column header with Hebrew single letter ("מ", "ג", "ד") | One of the patient-list columns — check §4 |
| Red text in a diagnosis cell | Isolation flag (§6) |
| A pen icon on a row | **In the patient grid:** admission-note status (blue pen = unsigned, §6). **In the orders grid:** order pending nursing administration (§7.3). |
| 🔴 in the orders/fluids grid | Dose given by nurse today / device in place (§7.3) |
| 🔵 in the orders/fluids grid | **Order finished / course completed.** Typically on struck rows. (§7.3) |
| ℹ️ on an order row | Linked instructions — usually insulin protocol or Rx note (§7.3) |
| 📋 on an order row | Prescription / protocol attached (§7.3) |
| 💬 red speech bubble | Active nurse comment — read it (§7.3) |
| 💬 grey speech bubble | Empty comment slot (§7.3) |
| Gray name + strikethrough in the orders grid | Finished historical order (§7.1, §7.2) |
| Black name + no strikethrough in the orders grid | Active current order (§7.1, §7.2) |
| Green circle near shift change | Unsigned nursing shift summary |
| Color on the blood bank "מספר" column | Sample validity (§4 row 12) |
| Icons at top of screen | Toolbar — §3 or §5 |
| Bell icon on row | Overdue nursing task |
| Red vs gray "רקע" | Current vs prior social-work involvement |

## Files in this bundle

- `AZMA_REFERENCE.md` — this document (R4)
- `azma_reference.json` — programmatic lookup with `medGridRowStates.icons` (7 entries) plus quiz items carrying explicit `manifestEvidence` and `provenance` fields. Original Storyline slide-content dump preserved under `_source.scenes`.
- `manifest.json` — the complete Articulate Storyline 3.5 SCORM manifest (`projectId 66MVezv2vF7`). Canonical source for the explicit answer key (look for `"status":"correct"` markers).
- `slide_art/` — 20 background images from the course slides. **These are slide decorations, NOT AZMA EMR captures.** Content includes: SZMC institutional logo, geometric blue shapes, stock photos (doctors, lab equipment, laptop+stethoscope), a few unrelated EMR-adjacent dialogs (password change, comment dialog). The actual AZMA patient-list grid screens shown in the course are composited inside slide JS files in the original SCORM zip, not exported as standalone PNGs.

> **Missing from current bundle (would help if produced):**
> - standalone screen-capture of the Q5 4-pen-picture layout (to definitively confirm Picture 7 = blue pen)
> - standalone screen-capture of the Q4 4-icon layout (to confirm Picture 13 = the specific חיידק עמיד icon)
> - live AZMA patient-list-grid captures for matching against real-world AZMA photos
> - a screenshot showing any **additional row icons** below the 7 documented in §7.3 (the source table had a "more below" scroll arrow)

## Revision history

- **R4 — 2026-05-02:**
  - §7.3 expanded from 2-icon to **7-icon canonical legend** per Eias's reference table (pen / 🔴 / 🔵 / ℹ️ / 📋 / 💬red / 💬grey). Previous R3 collapse of "blue ℞" into a single approval marker corrected: **blue circle (order finished)** and **Rx clipboard (protocol attached)** are separate icons. Added speech-bubble pair (active nursing comment / empty slot).
  - §7.5 collapsed grid expanded from 2×2 to **3×3** to incorporate 🔵 column.
  - §7.6 workflows expanded with insulin-protocol and antibiotic-protocol lookup paths.
  - Quiz evidence upgraded to manifest-grade for Q1, Q2, Q4 (was feedback-string-grade in R2/R3).
  - Q4 reclassified as picture-pick (correct = `Picture 13`).
  - Q5 reclassified as picture-pick (correct = `Picture 7`, inferred = blue pen via DOM-order convention).
  - "Files in this bundle" rewritten: 20 PNGs are slide-art decorations, not EMR screen captures. R1's claim was misleading.
  - `manifest.json` now bundled.
- **R3 — 2026-05-02:** added §7 — order-grid row-state legend (4-axis read). Quiz numbering bumped (was §7) → §8. Support: §8 → §9.
- **R2 — 2026-05-02:** decoded the Storyline wrong-feedback convention from JSON (Q1/Q2 cross-check) → Q5 (blue pen) verified. §6 — removed contradictory "red pen" claim. §7 Q3 — corrected attribution. JSON restructured from raw slide dump to programmatic lookup.
- **R1 — initial release:** authored from Storyline SCORM extraction.
