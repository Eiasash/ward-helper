# AZMA EMR — Interface Reference (SZMC)

Extracted from the official SZMC AZMA familiarization e-learning (Blossom assignment 79, "familiaritywithazma", Articulate Storyline 3.5 SCORM package), supplemented by Eias's clinical observation of the live medication-orders grid and the canonical icon legend he supplied 2026-05-02. This is the ground-truth reference for what every UI element in the AZMA department-management screen and order grid means.

Use this document (and `azma_reference.json` next to it for programmatic lookup) whenever you're looking at a photo of the AZMA interface and need to know what a column, icon, color, or indicator means.

> **R10 (2026-05-18) — current:**
> 1. §7.3 icon legend **reconciled with real de-identified captures** and confirmed by Eias. Admin-status icon has two states only: **pencil = pending, red round stop = active**. Speech bubbles are three-colour: **green = doctor's note, red = nurse's note, grey = empty**. The earlier "blue circle = order finished" icon is **retired** — inactivity is shown by row strikethrough (§7.2).
> 2. §7.0 added — the live AZMA order grid (layout, columns, section bands). The application window may be titled `Eitan 4`; that is the integrated build, not a separate EMR. **Eitan** proper is the cross-hospital shared record (the blue patient-name box) — see SKILL.md §0.3.
> 3. `Rx` icon (antibiotic rows) decoded — antibiotic Infectious-Diseases approval status, colour-coded (blue = approved, yellow = renew, red/dark-orange = rejected). Row tints decoded — drug-class grouping under `מיון לפי נושא`, cosmetic. `screenshots/` folder added (PHI-cropped). §7.7 fully reconciled — no open items.
> 4. **Census decoded** — §4.0 added (the `ניהול מחלקה` census is a **case-manager-filtered ward roster**; Eias's case managers — the rehab case manager for rehab, the side-B case manager for side B). §6 census status icons confirmed: red vial-on-yellow = bloods pending, yellow book = imaging/test awaited, red book = task/mission, blue book = consult awaited. De-identified census crop in `screenshots/`.
> 5. **Cross-skill contract added** (SKILL.md) — `azma-ui` is the single source of truth for AZMA decoding; consumer skills (`rehab-quickref`, `szmc-clinical-notes`, `szmc-interesting-cases`) point here and must not restate icon/column/colour facts. Drift-control measure.
> *(Prior R4 expanded §7.3 to a 7-icon legend with a blue-circle icon; R6 superseded that. See full revision history at the end.)*

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

### 4.0 Using the census in practice (real-capture notes, 2026-05-18)

The `ניהול מחלקה` screen is used by ward physicians as a **filtered patient list** — a roster. The deeper bed-management / administrative functions are the department head's (`מנהל מחלקה`) domain and are out of scope here.

**How the ward is filtered to one clinician's list:**
- `מחלקה` (top-right) selects the ward — e.g. `גריאטריה - שיקום` (geriatric rehab).
- The `חיפוש לפי case` (search-by-`case`) box filters to one case-manager's patients — type the case-manager specialist's name. Eias's case managers: **the rehab case manager** ("the rehab case manager" / "the rehab case manager") for the **rehab** ward; **the side-B case manager** ("the side-B case manager") for **side B** (acute geriatrics, side B). A census screenshot from Eias is therefore almost always already filtered to one case manager's patients.
- Footer counters: `מאושפזים N` (currently admitted), `מיטות פנויות` (free beds), `לשיבוץ` (awaiting bed assignment), `סה"כ` (total).

**Reading a row for rounds.** The columns that matter per patient: `שם` (name), `חדר` + `מיטה` (room + bed — note `מיטה` is a separate column from `חדר`), `גיל` (age), `שהות במח'` (length of stay — the rehab-day count), `אבחנה` (diagnosis), `צד \ שיוך` (side), `case manager`. This is the AZMA-census-first roster the rounds workflow depends on.


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

**Real-capture confirmations (2026-05-18)** — from `screenshots/azma-census-reference.png`:

- **`חדר` (room) cells** render with a purple/violet fill — UI styling for the room column, not a per-patient status.
- **`שם` (name) cell tint encodes patient sex** — **pink = female, teal/cyan = male** (confirmed by Eias 2026-05-18).
- **`דם` blood-type cells** (`A+`, `B+`, …) carry a coloured fill — the blood-group cell.
- **Per-row census status icons** — these sit in the `כללי` (general) group columns and flag what is *outstanding* for that patient (confirmed by Eias 2026-05-18):
  - **Red vial / test-tube on a yellow background** (`דמים` bloods column) — a **blood test is pending today**.
  - **Yellow book** (`בדיקה` test column) — **awaiting a diagnostic test or imaging** (CT, X-ray, etc.).
  - **Red book** (`משימות` tasks column) — a **pending task / "mission"**: the free-form manual task list used for inter-staff notes (e.g. doctor to nurse and vice versa).
  - **Blue book** (`יעוץ` consult column) — **awaiting a consultation**.
  - **Yellow bell** — an **overdue nursing task** (§4 row 21).
- **Row-action buttons (not status)** — a **red pencil/edit icon** on every row, and near the `case manager` column a small **green layered-pages icon** plus an **`Rx` icon** on every row. Because they appear on *every* row they are row-action buttons (open / edit), not per-patient status — identify them and move on.

## 7. הוראות תרופתיות — order-grid row states (4-axis read)

The medication-orders grid (and the parallel נזלים / לוינים-ונקזים sections) uses **four orthogonal visual axes** to encode an order's state. Read them together; misreading any one of them flips the clinical meaning.

### 7.0 The AZMA medication-order grid (live reference)

> Added R5, revised R6 (both 2026-05-18) from real de-identified captures in `screenshots/` and Eias's confirmation. §7.1–7.6 describe the grid; §7.3 and §7.7 are reconciled with the live captures.

**This grid is AZMA.** It is AZMA's medication-order screen (`הוראות תרופתיות`). The application window's title bar may read **`Eitan 4`** — that is the integrated application build, *not* a separate EMR; the order grid, the SOAP/`ביקור` panel and the census are all AZMA. **Eitan** proper is a different thing entirely — the cross-hospital shared record, surfaced as the small blue patient-name box (SKILL.md §0.3). Do not let the title bar mislead you.

**Layout.** Above the grid: tabs `תרופות / נוזלים / כלליות / הכל`, a `הצג הוראות` filter (`בתוקף` / `הכל`), and an `ישן` (old) checkbox. The AZMA window is commonly split — order grid on the left, a SOAP/`ביקור` panel (S/O/A/P fields) on the right.

**Row tints.** Ticking the `מיון לפי נושא` (sort-by-subject) checkbox groups rows by drug class and tints each class band a colour (blue / green / yellow / pink). The tints are purely a class-grouping aid — they carry **no per-order clinical status**.

**Columns** (right-to-left): route (PO / IV / SC / TD / TOP, no header) · `תאור הוראות` drug name, which may carry a free-text sub-line · dose · frequency (`1Xd`, `2Xd`, `3Xd`, `1Xw`, `3Xw`, `PRN`, `once`, `by protocol`, `HOLD`) · `ימי מתן` administration count/schedule (e.g. `4 / ~`, `1 / 2`, `3 / 3`; may carry an inline blue `i` = linked instructions) · `התחלה` start date · `שינוי` last-changed date · then the per-row **icon cluster** (see §7.3 + §7.7).

**Section bands** seen in the grid: `הוראות תרופתיות` (drug orders), `הוראות מתמשכות / נוזלים` (continuing orders / fluids), `לויינים, נקזים וכלליות מתמשכות` (lines, drains, continuing general orders). Non-drug items — AV fistula, surgical drains (`נקז כירורגי`), nasal cannula / oxygen (`חמצן`), diet (`דיאטה … IDDSI`), peripheral IV (`עירוי פריפרי`) — live in the `לויינים` band and add body-site columns (`יד` / `ירך`, `שמאל` / `ימין`).

**Free-text row sub-annotations** are clinically load-bearing — read them. Examples seen: `שים לב להערת רופא מאשר` (note from the approving physician — on an antibiotic), `הוראה חד פעמית שלא בוצעה` (a one-time order **not yet given** — still pending).

### 7.1 Axis 1 — text color (medication name)

| Color | Meaning |
|---|---|
| **Black** | New or current order (active in the present admission) |
| **Gray** | Old / historical order (audit-trail entry) |

### 7.2 Axis 2 — strikethrough (blue line through the row)

| Display | Meaning |
|---|---|
| **No strikethrough** | The order is still in force |
| **Strikethrough (thin blue line through name + columns)** | The order is **inactive** — a previous order, no longer current. It may have run its course, been cancelled, replaced, or never administered at all (issued or non-issued — either way it is past). **Not "currently held."** |

### 7.3 Axis 3 — the per-row icon strip (reconciled with live captures, 2026-05-18)

The icon strip is the cluster at each row's leading edge: **[admin-status icon] then [`Rx` ID-approval icon — antibiotics only] then [schedule/MAR grid icon] then [speech-bubble]**. Match it against `screenshots/azma-medgrid-icons-zoom.png`.

| Icon | Meaning |
|---|---|
| pencil | **Pending** — order awaiting administration / not yet actioned. |
| red round stop | **Active** — the order is live. Most current orders carry this. |
| green speech bubble | A note on this row written by a **doctor** — a clinical instruction. Read it. |
| red speech bubble | A note on this row written by a **nurse** — e.g. why a dose was withheld ("not given, potassium normal" on a KCl supplement), administration timing, an observed issue. Read it on round. |
| grey speech bubble | Empty — no note logged on this row. |
| blue "i" (in the `ימי מתן` column) | Linked instructions — e.g. the insulin sliding-scale protocol. Click to view. |
| `Rx` (antibiotic rows only) | **Infectious-Diseases (ID) approval status of the antibiotic order**, colour-coded: **yellow** = ID approval needs renewal · **blue** = ID approval granted / in place · **red or dark-orange** = ID approval **rejected** by the Infectious Diseases consult. A non-blue `Rx` on an antibiotic is a flag to act on. |
| schedule / MAR grid icon | Small spreadsheet-style icon on **every** row; opens the administration record. **Not relevant to ward-documentation work — identify it and move on.** |

> **Retired:** earlier revisions listed a "blue circle = order finished" icon. No live capture shows it, and Eias confirms the admin-status icon has only two states — pencil (pending) and red round stop (active). The **inactive / previous-order** state is shown by **row strikethrough** (§7.2), not by a dedicated icon.

> **Still possible:** icons may exist beyond those above (the original SCORM table had a "more below" scroll arrow). If a screenshot shows an icon outside this set, name it precisely and ask — do not guess (SKILL.md §0.1).

### 7.4 Axis 4 — view filter (top-of-grid)

| Filter | Effect |
|---|---|
| `הצג הוראות` → **בתוקף** | Default — hides strikethrough/finished rows. You see only active orders. |
| `הצג הוראות` → **הכל** | Shows the full audit log including finished / replaced / superseded orders. Use this when you need to reconstruct what's been given through this admission. |

### 7.5 Putting it together

For any order row, read three independent things:

- **Strikethrough?** No = current order. Yes = inactive / previous order (§7.2): it may have been administered or never administered, but it is *not* part of the current regimen.
- **Admin-status icon.** Pencil = pending (awaiting administration); red round stop = active.
- **Speech bubble.** Green = a doctor's note, red = a nurse's note (read both), grey = none.

Plus two screen-not-photo cautions:

1. Set the `הצג הוראות` filter to **הכל** before reconstructing a regimen — **בתוקף** hides inactive rows (§7.4).
2. The **selection-row blue border** (highlight when a row is clicked) is *not* a strikethrough. A real strikethrough is a thin blue line cutting through the medication name *and* the dose/frequency columns; the selection border only outlines the row.

### 7.6 Common workflows that depend on this read

- **Morning ward round:** pencil rows = orders pending administration; red-stop rows = active orders. Read every green speech bubble (a doctor's instruction) and red speech bubble (a nurse's note — often why something was withheld).
- **Reconstructing the AC story:** flip the filter to הכל. Read all anticoagulant rows top-to-bottom. No-strike = the current AC order; struck rows = previous AC orders (a HOLD, a bridge, a superseded dose) — the strikethrough tells you they are no longer current.
- **Discharge-letter drug rec:** the home-meds list is the union of (gray, struck rows representing the patient's pre-admission regimen) and (black, no-strike rows started in admission and intended to continue). Each membership decision is a clinical judgment, not a UI artifact.
- **Insulin sliding-scale lookup:** find the insulin row → click the ℹ️ blue info → read the linked sliding-scale protocol.
- **Antibiotic ID-approval check:** the `Rx` icon on an antibiotic row colour-codes its Infectious-Diseases approval — **blue** = approved, **yellow** = needs renewal, **red/dark-orange** = rejected by ID. On rounds, flag any antibiotic whose `Rx` is not blue.

### 7.7 Real-capture reconciliation log

Every item raised from the 2026-05-18 captures has been confirmed by Eias and folded into §7.0 / §7.3. No open items.

- **Speech bubbles** — green = a doctor's note, red = a nurse's note, grey = empty.
- **Admin-status icon** — pencil = pending, red round stop = active (two states only). The old "blue circle = order finished" is retired; inactivity = row strikethrough (§7.2).
- **`Rx` icon** (antibiotic rows) — antibiotic Infectious-Diseases approval status, colour-coded: yellow = renew, blue = approved, red/dark-orange = rejected.
- **Row tints** (blue / green / yellow / pink row bands) — appear only when the `מיון לפי נושא` (sort-by-subject) checkbox is ticked; they group rows by drug class (e.g. antibiotics together at the top). Purely a visual grouping aid — **no per-order clinical meaning**.
- **Schedule / MAR grid icon** — on every row; opens the administration record; not relevant to ward-documentation work.

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
| Red round stop icon on a row | **Active** order (§7.3) |
| Pencil icon on a row | Order **pending** administration (§7.3) |
| Thin blue line through a whole row | Order **inactive** — a previous order, not current (§7.2) |
| ℹ️ on an order row | Linked instructions — usually insulin protocol or Rx note (§7.3) |
| `Rx` icon on an antibiotic row | Antibiotic ID-approval status by colour: blue = approved, yellow = renew, red/dark-orange = rejected (§7.3) |
| Coloured row-band tints (blue/green/yellow/pink) | Drug-class grouping when `מיון לפי נושא` is ticked — cosmetic, no clinical meaning (§7.0) |
| Green speech bubble | A doctor's note on the row — read it (§7.3) |
| Red speech bubble | A nurse's note on the row — read it (§7.3) |
| Grey speech bubble | Empty — no note (§7.3) |
| Gray name + strikethrough in the orders grid | Finished historical order (§7.1, §7.2) |
| Black name + no strikethrough in the orders grid | Active current order (§7.1, §7.2) |
| Green circle near shift change | Unsigned nursing shift summary |
| Color on the blood bank "מספר" column | Sample validity (§4 row 12) |
| Icons at top of screen | Toolbar — §3 or §5 |
| Bell icon on row | Overdue nursing task |
| Red vs gray "רקע" | Current vs prior social-work involvement |

## Files in this bundle

- `AZMA_REFERENCE.md` — this document (R5)
- `azma_reference.json` — programmatic lookup with `medGridRowStates.icons` (7 entries) plus quiz items carrying explicit `manifestEvidence` and `provenance` fields. Original Storyline slide-content dump preserved under `_source.scenes`. **Note:** the `medGridRowStates.icons` list reflects the §7.3 SCORM legend and has not been reconciled with the §7.7 real-capture observations — treat §7.7 as the more current source until the JSON is updated.
- `manifest.json` — the complete Articulate Storyline 3.5 SCORM manifest (`projectId 66MVezv2vF7`). Canonical source for the explicit answer key (look for `"status":"correct"` markers).
- `screenshots/` — de-identified crops from **real AZMA captures** (R5–R7, 2026-05-18): the medication-order grid (`azma-medgrid-*.png`) and the `ניהול מחלקה` census (`azma-census-reference.png`). See `screenshots/README.md`. Any image added here must be PHI-cropped first (no patient name / ID / DOB / admission number).

> **Still missing (would help if produced):**
> - confirmation of the green speech bubble, schedule/MAR grid icon, `Rx`-`!` variant, and row-tint meanings (§7.7)
> - standalone captures of the Q4 / Q5 picture-pick layouts (to confirm `Picture 13` / `Picture 7`)

## Revision history

- **R10 — 2026-05-18:**
  - SKILL.md: "Cross-skill contract — drift control" section added. `azma-ui` declared single source of truth for AZMA screen decoding; consumer skills must point here, not restate icon/column/colour facts. Closes the drift class that left a retired `🔵` icon in `rehab-quickref`.
- **R9 — 2026-05-18:**
  - §6: `שם` name-cell tint confirmed by Eias as sex-coding — pink = female, teal/cyan = male. No open items remain.
- **R8 — 2026-05-18:**
  - §6 census status icons confirmed by Eias: red vial on yellow = blood test pending today; yellow book = awaiting imaging/diagnostic test; red book = pending task/mission (free-form inter-staff list); blue book = awaiting consultation. The per-row red pencil and the green-pages/`Rx` icons reclassified as row-action buttons (not status).
- **R7 — 2026-05-18:**
  - §4.0 added — the `ניהול מחלקה` census is in practice a case-manager-filtered ward roster (filter via the `חיפוש לפי case` box; Eias's case managers: the rehab case manager = rehab, the side-B case manager = side B). Department-administration functions are the department head's domain, out of scope.
  - §6 gains real-capture colour notes (room cells purple; name-cell tint likely sex-coded; blood-type cell colour; per-row census icons). De-identified census crop added to `screenshots/` (`azma-census-reference.png`).
- **R6 — 2026-05-18:**
  - §7.3 reconciled with real de-identified captures and confirmed by Eias: pencil = pending / red round stop = active (two states only); speech bubbles green = doctor / red = nurse / grey = empty; the "blue circle = order finished" icon retired (inactivity = strikethrough, §7.2).
  - §7.0 reframed: the grid is **AZMA**; the `Eitan 4` title bar is the integrated application build, not a separate EMR. Eitan proper = the cross-hospital shared record (blue patient-name box), now in SKILL.md §0.3.
  - §7.5 rewritten (no more blue-circle matrix); §7.6 workflow bullets de-iconned; §7.7 converted to a reconciliation log (confirmed vs still-open).
  - `screenshots/` files renamed `eitan4-*` to `azma-*`; top callout box refreshed to R6.
- **R5 — 2026-05-18:**
  - Added **§7.0** — Eitan 4 real-grid reference (window title `Eitan 4`, tab strip, column layout, section bands, free-text row sub-annotations) from real de-identified captures.
  - Added **§7.7** — real-capture observations: green speech bubble, schedule/MAR grid icon, and `Rx`-`!` variant are present in live captures but absent from the §7.3 legend; the §7.3 "🔵 blue circle" entry is unconfirmed by any capture. All flagged "pending Eias confirmation."
  - Added the **`screenshots/`** folder (de-identified Eitan 4 crops) and a PHI-cropping policy for it.
  - SKILL.md §0 updated to recognize the `Eitan 4` window title and the SOAP/`ביקור` screen; §0.2 added pointing to `screenshots/`.
  - Open question recorded, not resolved: whether Eitan 4 is AZMA's medication module or a separate product.
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
