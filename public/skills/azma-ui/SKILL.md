---
name: azma-ui
description: SZMC AZMA EMR (ניהול מחלקה / inpatient chart + הוראות תרופתיות / order grid) interface reference. Trigger whenever the user uploads a screenshot of the AZMA/Chameleon EMR, asks about what an icon/column/color/indicator means in AZMA, mentions "ניהול מחלקה" or "הוראות תרופתיות", asks to decode EMR columns, asks what a row state means in the medication-orders grid, or when looking at the department patient census grid at SZMC. Contains: meaning of every patient-grid column (1-21), double-click behaviors, color-code conventions (red diagnosis=isolation, blue pen=unsigned admission, green circle=unsigned shift summary, blood bank colors), the canonical 7-icon legend for the medication-orders grid (pen=pending / 🔴=given / 🔵=order finished / ℹ️=linked protocol / 📋=Rx attached / 💬red=active comment / 💬grey=empty), 4-axis row-state read for medication orders (text color × strikethrough × admin icon × view filter), 5 official quiz Q&As with manifest-grade answers, the SCORM manifest, and 20 slide-art images (note: these are decorative slide backgrounds, NOT EMR captures — the actual EMR screens are composited inside slide JS in the source SCORM). Read AZMA_REFERENCE.md first; consult azma_reference.json for programmatic lookup; consult manifest.json for canonical Storyline answer keys.
---

See `AZMA_REFERENCE.md` for the full reference (R4, 2026-05-02).

**Quick navigation:**
- §3 — Department-management toolbar (6 icons)
- §4 — Patient-list grid (21 columns)
- §5 — Global toolbar icons
- §6 — Patient-grid color codes (red diagnosis, blue pen, green circle, blood-bank colors)
- **§7 — `הוראות תרופתיות` order-grid 4-axis row-state read** (text color × strikethrough × **canonical 7-icon legend** × view filter)
- §8 — 5 official quiz Q&As (manifest-grade answers)

**Programmatic lookup:** `azma_reference.json` (v4.0.0). Top-level keys: `deptMgmt`, `colorCodes`, `medGridRowStates`, `quiz` (with `manifestEvidence` + `provenance` per item), `iconDischargeMapping`, `_source.scenes` (raw Storyline slide content).

**Canonical SCORM source:** `manifest.json` — explicit `"status":"correct"` markers tie answer records to choice IDs. Use this when verifying quiz answers programmatically.

**Slide art (slide_art/):** 20 background images — SZMC logo, geometric blue shapes, stock photos (doctors / lab equipment / laptop+stethoscope), a few EMR-adjacent dialogs (password change, comment dialog). **These are NOT AZMA EMR screen captures.** The actual EMR screens shown in the course are composited inside slide JS files in the source SCORM zip, not exported as standalone PNGs. R1 docs that described these as "EMR screenshots" were misleading.

When Eias sends a photo of AZMA:
- **Patient-list / department census** → match against §4 columns and §6 color codes
- **Order grid (`הוראות תרופתיות` / `נזלים` / `לוינים-ונקזים`)** → use §7's 4-axis read. Always check all 4 axes (text color, strikethrough, icon, view filter) — misreading one flips clinical meaning
- **Toolbar** → §3 (department-management) or §5 (global)

## Workflow links to clinical writing

When decoding a patient row, three patient-grid icons drive content in the **discharge note** (see `szmc-clinical-notes` skill):

### 1. Tube/catheter icon (T-shape, leftmost in icon cluster)
Indicates the patient currently has, or recently had, an indwelling tube or catheter. **Hover reveals the event log** with insertion/removal dates per device:
```
22/04 PEG
27/04 עירוי פריפרי
24/04 NGT
25/04 Foley
```

**Discharge writing rule (Eias 28/04/26):**
- **NGT, urinary catheter (Foley), PEG insert/remove events** → put as entries under **`ניתוחים באשפוז`** in the discharge with the date.
- **Peripheral IV (`עירוי פריפרי`) → SKIP.** Routine, not clinically tracked, gets stripped from final discharge.
- If a tube was placed before this admission and is still in place (e.g., chronic PEG, suprapubic catheter), it goes under `ניתוחים בעבר`, not `ניתוחים באשפוז`.

### 2. Red spiral icon
Pressure ulcer present. If active during this admission:
- Add to `אבחנות פעילות` if it required active management (debridement, dressings, consult)
- Surface in `# תפקוד` block of `מהלך ודיון`
- Add to המלצות בשחרור: pressure-relief schedule, dressing protocol, follow-up plan

### 3. Wheelchair icon
Disabled / wheelchair-bound. Reflect in:
- `הצגת החולה` ("מתגוררת בבית עם מטפלת, מרותקת לכיסא גלגלים")
- `תפקוד` section ("עזרה מלאה במעברים, ניידות בכיסא גלגלים")

## Order-grid → discharge med rec

When using the order-grid (§7) to reconstruct the discharge medication list, the canonical formula is:

> **Home meds list** = (gray + struck + 🔵 rows representing pre-admission regimen) ∪ (black, no-strike rows started in admission and intended to continue)

Each membership decision is a clinical judgment, not a UI artifact. Specifically:
- A struck-out row with 🔵 (course completed) **does not necessarily** belong on the discharge list — it might have been a one-off (Ceftriaxone for CAP, NaCl bolus, etc.) that was supposed to end.
- A black no-strike row added in admission **does not necessarily** belong on the discharge list either — some are bridges (e.g., therapeutic Enoxaparin during AC hold) that should stop on discharge.
- Always verify the AC story explicitly when there's an Apixaban → HOLD → Enoxaparin sequence (see §7.6 workflow).
