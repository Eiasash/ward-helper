---
name: azma-ui
description: SZMC AZMA EMR interface decoder — reads the ניהול מחלקה patient-census grid and the הוראות תרופתיות medication-order grid. CRITICAL — Claude CANNOT reliably read AZMA icons, columns, colors, or row-states from an image alone — they are a closed SZMC-specific visual vocabulary absent from training data, and guessing yields confident wrong reads (icons called "unrecognized" or given invented meanings). ALWAYS consult this skill BEFORE interpreting ANY screenshot of a Hebrew hospital EMR, ward census, patient list, or medication grid — whether or not the user names AZMA, and even when they just paste an image with a clinical request (write a SOAP, decode this, what does this icon/color mean, read the census). Treat every uploaded SZMC ward/EMR screenshot as a trigger; the skill confirms AZMA vs Chameleon. Covers the 21 patient-grid columns, double-click behaviors, color codes, the order-grid icon legend, and the AZMA familiarization quiz answers. Read AZMA_REFERENCE.md first.
---

# AZMA UI decoder

**If an EMR / hospital-software / Hebrew-RTL-grid screenshot was uploaded, you are in the right place. Do not interpret its icons, columns, colors, or row-states from the image alone — match them against this skill.**

## §0 — Recognizing the screen (do this FIRST)

AZMA icons are a closed vocabulary. You have no reliable training-data knowledge of them. Confident-sounding guesses are the failure mode this skill exists to prevent.

**Is it AZMA?** AZMA screens are Hebrew-RTL, dense, grid-based. The screens you will actually be sent:

- **`ניהול מחלקה` (department census / ward roster)** — one row per patient; columns for חדר+מיטה / גיל / אבחנה / שהות / case-manager; coloured cells and per-row icons. In practice it is used as a **case-manager-filtered ward list** — Eias filters via the `חיפוש לפי case` box to his own case manager — a roster, not the admin layer. → decode with §4 (incl. §4.0 filtering) + §6 (colours).
- **Medication-order grid** (AZMA `הוראות תרופתיות`) — one row per drug/order; route (PO/IV/SC/TD/TOP) + drug name + dose + frequency + a strip of small icons per row; a `הצג הוראות` filter (בתוקף / הכל) at top; tabs `תרופות / נוזלים / כלליות / הכל`. The window is usually split: order grid on the left, a SOAP/`ביקור` panel (S/O/A/P fields) on the right. The application title bar may read `Eitan 4` — see §0.3; that does not make it a different EMR. Decode with §7.
- **`ביקור` / visit screens** — a visit-list table (תאריך ביקור / שם רופא/יועץ / תחום ייעוץ) plus S/O/A/P fields and an active-diagnoses list. This is the rounds/SOAP surface.
- Toolbars / dialogs (vitals `סימנים חיוניים`, lab results, document viewer) → §3 / §5, or just read the visible Hebrew.

**Is it Chameleon, not AZMA?** Chameleon is SZMC's *documentation* EMR — paste-field-based (a sidebar of named text fields: אבחנות / קבלה / רגישויות / תרופות בבית …), not an icon-dense grid. **If the screenshot is Chameleon, the icon legend below does NOT apply** — say so and route to the `szmc-clinical-notes` skill instead of forcing AZMA semantics.

**If unsure which it is**, say so explicitly and describe what you see — don't pick one silently.

## §0.3 — AZMA vs Eitan vs Chameleon (do not confuse them)

- **AZMA** — the ward EMR this skill decodes: the census (`ניהול מחלקה`), the medication-order grid, the SOAP/`ביקור` panel. The application window's title bar may read **`Eitan 4`** — that is the integrated application build; the functionality is AZMA. Do not let the title bar mislead you.
- **Eitan** — a *separate* thing: a cross-hospital / national shared health record (consolidated snippets from other hospitals' reports, kupat-holim community and specialist consults, primary-care visits, chronic home meds `תרופות קבועות`, etc.). In the AZMA UI, Eitan is the **small blue rectangular box showing the patient's name**, usually at the top of the screen off to one side. If the screenshot *is* the Eitan record, it is mostly plain Hebrew text — read it directly; the §7 icon legend does not apply to it.
- **Chameleon** — SZMC's documentation EMR, paste-field-based. Separate again. Route to `szmc-clinical-notes`.

## §0.2 — Real-capture visual reference

The `screenshots/` folder holds de-identified crops from real AZMA medication-grid captures. When decoding an order grid, **open `screenshots/azma-medgrid-icons-zoom.png` and match the icons directly** rather than reasoning from the text legend alone. §7.3 is the legend (reconciled with these captures and confirmed by Eias, 2026-05-18); §7.7 is the reconciliation log — all items confirmed, none open.

## §0.1 — Anti-confabulation rule (non-negotiable)

When an icon, column glyph, or color in the screenshot does **not** cleanly match an entry in §4 / §6 / §7.3 / §7.7:

- Do **not** call it "unrecognized", "a new symbol", or "unknown to the system."
- Do **not** invent a plausible-sounding meaning.
- Instead: pinpoint it ("the leftmost icon on row 3, a small orange triangle"), state it is outside the documented set, and ask Eias — see the §7.3 "more below" caveat. The order-grid legend's source table had a scroll arrow, so genuinely-undocumented icons can exist; the correct move is to flag, not fill in.

A precise "this icon isn't in my reference — what is it?" is a *correct* answer. A confident wrong gloss is the bug.

---

See `AZMA_REFERENCE.md` for the full reference (R5, 2026-05-18).

**Quick navigation**
- §3 — Department-management toolbar (6 icons)
- §4 — Patient-list grid (21 columns)
- §5 — Global toolbar icons
- §6 — Patient-grid color codes (red diagnosis, blue pen, green circle, blood-bank colors)
- **§7 — order-grid row-state read** — §7.0 the AZMA grid (live) · §7.3 the icon legend (reconciled & confirmed) · §7.7 reconciliation log
- §8 — 5 official quiz Q&As (manifest-grade answers)

**Programmatic lookup** — `azma_reference.json` (v4.0.0). Top-level keys include `deptMgmt`, `colorCodes`, `medGridRowStates`, `quiz` (with `manifestEvidence` + `provenance` per item), `iconDischargeMapping`, `_source.scenes` (raw Storyline slide content).

**Canonical SCORM source** — `manifest.json` carries explicit `"status":"correct"` markers tying answer records to choice IDs. Use this when verifying quiz answers programmatically.

**On the `screenshots/` folder** — earlier R1 docs referenced a folder of 20 images claimed to be "real EMR UI captures"; those were slide-background decorations and were dropped. As of R7 (2026-05-18) the `screenshots/` folder holds **genuine de-identified AZMA crops — the medication-order grid and the `ניהול מחלקה` census** — see §0.2 and `screenshots/README.md`. Any new image added there must be PHI-cropped first (no patient name / ID / DOB / admission number).

When Eias sends a photo of AZMA:
- **Patient-list / department census** → match against §4 columns and §6 color codes
- **Order grid (`הוראות תרופתיות` / `נזלים` / `לוינים-ונקזים`)** → use §7's 4-axis read. Always check all 4 axes (text color, strikethrough, icon, view filter) — misreading one flips clinical meaning
- **Toolbar** → §3 (department-management) or §5 (global)

## Workflow links to clinical writing

When decoding a patient row, three patient-grid icons drive content in the **discharge note** (see `szmc-clinical-notes` skill).

### 1. Tube/catheter icon (T-shape, leftmost in icon cluster)
Indicates the patient currently has, or recently had, an indwelling tube or catheter. Hover reveals the event log with insertion/removal dates per device, e.g.

```
22/04 PEG
27/04 עירוי פריפרי
24/04 NGT
25/04 Foley
```

Discharge writing rule (Eias 28/04/26):
- NGT, urinary catheter (Foley), PEG insert/remove events → put as entries under **`ניתוחים באשפוז`** in the discharge with the date.
- Peripheral IV (`עירוי פריפרי`) → SKIP. Routine, not clinically tracked, gets stripped from final discharge.
- If a tube was placed before this admission and is still in place (e.g., chronic PEG, suprapubic catheter), it goes under `ניתוחים בעבר`, not `ניתוחים באשפוז`.

### 2. Red spiral icon
Pressure ulcer present. If active during this admission:
- Add to `אבחנות פעילות` if it required active management (debridement, dressings, consult)
- Surface in `# תפקוד` block of `מהלך ודיון`
- Add to המלצות בשחרור — pressure-relief schedule, dressing protocol, follow-up plan

### 3. Wheelchair icon
Disabled / wheelchair-bound. Reflect in:
- `הצגת החולה` (e.g. "מתגוררת בבית עם מטפלת, מרותקת לכיסא גלגלים")
- `תפקוד` section (e.g. "עזרה מלאה במעברים, ניידות בכיסא גלגלים")

## Order-grid → discharge med rec

When using the order-grid (§7) to reconstruct the discharge medication list, the canonical formula is:

> **Home meds list** = (gray, struck rows representing the pre-admission regimen) + (black, no-strike rows started in admission and intended to continue)

Each membership decision is a clinical judgment, not a UI artifact. Specifically:
- A struck-out (inactive) row does not necessarily belong on the discharge list — it might have been a one-off (Ceftriaxone for CAP, NaCl bolus, etc.) that was supposed to end.
- A black no-strike row added in admission does not necessarily belong on the discharge list either — some are bridges (e.g., therapeutic Enoxaparin during AC hold) that should stop on discharge.
- Always verify the AC story explicitly when there is an Apixaban → HOLD → Enoxaparin sequence (see §7.6 workflow).


## Cross-skill contract — drift control

`azma-ui` is the **single source of truth** for AZMA screen decoding — every icon, column, colour, and row-state meaning. This section exists because a fact stated in two skills drifts: when the `🔵 order finished` icon was retired here, a stale copy survived in `rehab-quickref`'s daily-round step until a later audit caught it.

The contract:
- **Consumer skills must NOT restate** AZMA icon / column / colour meanings. They point here ("decode with the `azma-ui` skill") and add only their own *interpretation* layer on top.
- **When a legend in this skill changes**, check each consumer below for an inline AZMA fact that needs the same correction.
- A consumer may keep a *labelled* "quick reminder" of a couple of facts for speed (e.g. a bedside quickref) — but it must be marked as a reminder, with `azma-ui` named as authoritative.

Known consumers (2026-05-18):
- `rehab-quickref` — daily-round speed-tips, med-grid step (carries a labelled quick-reminder).
- `szmc-clinical-notes` — "AZMA EMR INTERPRETATION" section (interpretation only, no restated legend).
- `szmc-interesting-cases` — auto-chains this skill for screenshot interpretation.
