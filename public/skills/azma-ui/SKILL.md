---
name: azma-ui
description: SZMC AZMA/Chameleon EMR reference for the vision extractor. Read every time a ward photo comes in.
---

# AZMA / Chameleon — vision extract reference

This reference exists so the extractor does not confuse interface chrome with patient data. Applies to **every** ward photo. The single most common extract failure is reading the application header (which shows the **logged-in doctor**) as the patient — prevent that first, worry about everything else second.

---

## 1. Where the patient's identity actually lives

AZMA puts TWO different identity clusters on screen. They look similar at a glance. Only one of them is the patient.

### 1.1 The trap: top-left title bar (NEVER read as patient)
The far top-left of every AZMA window shows:

```
Eitan 4   <Doctor name>   <Patient code>
```

Example: `Eitan 4   אשרב איאס   p15695`

- **`Eitan 4`** is the application name (the Chameleon/Eitan EMR vendor).
- **Doctor name** (e.g. `אשרב איאס`, `אבו זיד גיהאד`, `אסלן אורי`) is the **logged-in clinician** — NOT the patient. This is the single biggest vision trap. Never emit the doctor's name as `fields.name`.
- **Patient code** is a short internal code like `p15695`. It is NOT the Israeli ת.ז. and must not be placed in `fields.teudatZehut`. A real ת.ז. is 9 digits, no letters.

Common SZMC geriatrics doctor names that may appear in this strip — treat any of these as **interface text, not patient text**:
`אשרב איאס` · `אבו זיד גיהאד` · `אסלן אורי` · `אחמרו מאלק` · any name followed by a `pNNNNN` code in the same line.

### 1.2 The truth: patient card (top-right / center-right panel)
The authoritative patient identity is in a **patient card** near the top-center/right, above the tabs. It renders vertically-stacked fields with labels on the right (Hebrew RTL):

```
שם מטופל:     <patient's full name>
ת.זהות:       <9-digit Israeli ID>
גיל:          <age in years>
נקבה / זכר:   <sex>
מחלקה:        <ward, e.g. גריאטריה-מח>
ת.אשפוז:      <admission date DD/MM/YY HH:MM>
מ.אשפוז:      <admission number>
```

**This card is the only source of truth for `name`, `teudatZehut`, `age`, `sex`.** If this card is not visible in any of the images provided, return no value for those four fields — do NOT substitute from the top-left strip.

---

## 2. The numeric strip (top-center) — labeled, not positional

Next to the patient card there is a small numbers grid that shows current observations. Each number has a **Hebrew label** next to it. Read by label, never by position.

Labels you will see (these look alike at a glance — do not confuse):

| Hebrew label | Meaning | Typical unit |
|---|---|---|
| גיל | age | years |
| משקל | weight | kg |
| חום | temperature | °C |
| ל"ד / לחץ דם | blood pressure | mmHg (X/Y) |
| דופק | heart rate | bpm |
| סטורציה | SpO₂ | % |
| BMI | BMI | kg/m² |

Critical pairs that get confused:
- **גיל (age) ≠ משקל (weight).** A 92-year-old patient weighing 62 kg will show `גיל: 92` and `משקל: 62.00`. Returning `age: 62` in that case is a wrong-patient-age error.
- **דופק (pulse) ≠ חום (temp).** Pulse is usually 50–110; temp is 35.5–39.5.

When the image is a phone photo of a monitor and a label is not sharp, do **not** guess the field from the number's magnitude — return the field as unread rather than filling it from a plausibly-sized number.

---

## 3. Ward list grid (the patient census)

When the photo shows a many-row table, that's the department list, not one patient. Columns left-to-right (RTL: right-to-left visually):

1. `מס'` — line number
2. `מ` — ventilation indicator (check = on ventilator / BIPAP)
3. `חדר` — room number (first digit = floor)
4. `מיטה` — bed
5. `שם משפחה` — surname
6. `שם פרטי` — given name
7. `ת.ז.` — 9-digit Israeli ID
8. `גיל` — age
9. `מין` — sex
10. `מס' אשפוז` — admission number
11. Diagnosis column — **red text = isolation precaution**
12. `ב.בוקר` / `י.טלפוני` — morning/telephonic rounds checkmarks
13. Blood-bank chip — **green = valid crossmatch · purple = type known · yellow = 4–7 days**
14. Signature chips — **blue pen = unsigned admission · green circle = unsigned shift summary**

If the image is a ward list, multiple patients are present; do not conflate rows. If a specific row is highlighted/selected, treat that row as the patient in focus.

---

## 4. Consult/visit history panel (left pane, many views)

Left pane shows prior doctor visits as rows: date, doctor name, discipline. These rows are **history**, not the current note; do not read doctor names or dates from here as patient fields.

---

## 5. When to return a field, when to omit

This extractor's output goes directly into a clinical note. An omitted field shows a blank that the doctor fills; a wrong field becomes a wrong-patient note. Bias toward omission.

- Return `name` only if the patient card's `שם מטופל` line is clearly readable.
- Return `teudatZehut` only if it's a 9-digit number. A string starting with `p` is a patient code, not a ת.ז.
- Return `age` only if the `גיל` label is visible next to it. If only an unlabeled number is visible, return nothing.
- Return `sex` only from the patient card's `נקבה/זכר` line OR from an unambiguous given-name signal. Do NOT infer sex from the doctor's name in the title bar.
- Return `chiefComplaint`, `pmh`, `meds`, `labs` from the main content panes only, never from the title bar.

Confidence labels (which the extractor emits only for `name`/`teudatZehut`/`age`):
- `high` — patient card clearly visible and sharp, all three identifiers legible.
- `med` — card visible but one identifier blurry or partially occluded.
- `low` — card not fully visible OR fields are being inferred from surrounding context.

If you can't assess, omit the confidence key entirely. Do not mark `high` just because a number is present.
