---
name: szmc-interesting-cases
description: >
  Generate condensed patient case summaries for SZMC ward case conferences
  ("מקרים מעניינים" / ישיבת מקרים / morning report). Input: raw clinical data
  (AZMA screenshots, labs, imaging, discharge letters, free text). Output: a
  clean 1-page case file following a fixed template — who the patient is,
  functional baseline, why they came, what was found, what we did, active
  problems, current status. Triggers: "מקרים מעניינים", "ישיבת מקרים", "case
  conference", "condense this case", "present this case", "summarize this
  patient", or AZMA bundle + presentation request. Default language English;
  Hebrew on request. Auto-chains with azma-ui skill when screenshots present.
  Distinct from geriatric-case-presentation (NEJM journal-club PPTX) and
  szmc-clinical-notes (Chameleon admission/discharge paste).
---

# SZMC Interesting Cases — Case Condensation Skill

## Purpose

Pure **data-in, condensed-summary-out** template. User gives raw patient data; skill produces a 1-page case file the presenter reads from during ward case conferences.

**Not a checklist. Not a prescribing audit. A template.**

---

## When to use

- "תכין לי מקרה מעניין" / "הכן מקרה לישיבת מקרים"
- "Condense this case" / "Summarize this patient"
- "Present this case" / "Case file for X"
- User uploads AZMA screenshots / discharge letter / labs + asks for a presentation summary

---

## Input types accepted

- AZMA EMR screenshots (auto-chain `azma-ui` skill for interpretation)
- Chameleon admission/discharge letters (PDF or text)
- Lab result bundles
- Imaging reports
- Culture results
- Free-text clinical context
- Any combination

---

## Language

**Default: English.** Ward conferences at SZMC are presented in English.

**Hebrew when requested:** "בעברית", "תרגם", "Hebrew version", "in Hebrew".

When Hebrew:
- Full RTL markdown with Hebrew section headers
- Drug names stay in English (avoids ambiguity)
- Lab values + units stay LTR
- Consult team names in Hebrew (גסטרו, אונקולוגיה, עו"ס)

---

## OUTPUT TEMPLATE — THIS IS THE SKILL

### Fixed 6-section structure

```markdown
# [Last name] [First name], [Age][M/F] — Case Summary
**For ישיבת מקרים מעניינים — [Department]**

**Admission:** DD/MM/YYYY | **LOS:** X days | **Ward:** [X]
**Allergies:** [list]

---

## 1. Who

One paragraph — age, sex, marital/living situation, functional baseline BEFORE admission, cognitive status, mobility aid, caregiver situation, major occupation/context if relevant.

## 2. Background

Relevant comorbidities only — NOT a dump of every ICD code. Group by organ system if >4 conditions. Recent relevant workup/treatments (last 6 months).

## 3. Why they came

- **Chief complaint:** [one-line]
- **Timeline:** symptom onset → ED → ward
- **ED vitals & key findings:** BP / HR / Sat / T / GCS + anything that changed the triage
- **ED workup:** labs, imaging, what was ruled in/out

## 4. What we found

| Category | Key findings |
|---|---|
| Vitals trend | [if notable] |
| Key labs | [abnormal only, with trends: `Ca: 12.3 → 9.8`] |
| Imaging | [1-line summary per study] |
| Cultures | [organism / sensitivity / specimen] |
| ECG / TTE | [if done] |
| Consults | [service / recommendation summary] |

## 5. What we did

**Active problems this admission** — numbered list, one line per problem + what was done:

1. **[Problem]** — [workup done, treatment given, response]
2. **[Problem]** — [...]
3. ...

## 6. Current status / disposition

- **Clinical status at presentation-time:** [improving / stable / deteriorating / discharged]
- **Functional status now vs baseline:** [capture PT assessment if available]
- **Disposition plan:** [home / rehab / hospice / long-term facility / still inpatient]
- **Open questions for the room:** [1-3 bullets — things the presenter wants discussion on]
```

---

## STYLE RULES

- **Concise.** Target: 1 page printed / one screen scroll.
- **Tables over prose** for labs, imaging, vitals trends.
- **Trends use `>` with spaces:** `Ca: 12.3 > 11.6 > 9.8`
- **Abnormal values only** — don't list normal labs unless clinically important that they WERE normal (e.g., "TSH normal, excluding thyrotoxicosis as AF trigger").
- **Drug doses inline with route:** `Meropenem IV 1g q8h` (exception to the q8h rule — case conferences are English and terse is fine here)
- **No opinions / no audit.** The skill reports what happened. The presenter adds analysis live.
- **No "teaching points" section.** The room generates those in discussion.
- **No citations / PMIDs.** This is not journal club.

---

## WORKFLOW

### 1. Intake

- Collect all provided inputs (screenshots, PDFs, text).
- If AZMA screenshots: invoke `azma-ui` skill to interpret columns/icons/colors.
- If Chameleon discharge letter: extract demographic header, diagnoses (active + background), admission story, lab trends, culture results, discharge disposition, PT block (for functional status).

### 2. Map inputs to template sections

| Template section | Pull from |
|---|---|
| Who | demographics + הצגת החולה + PT functional block + caregiver info |
| Background | אבחנות ברקע + רקע רפואי |
| Why they came | תלונה עיקרית + מחלה נוכחית + ED notes |
| What we found | בדיקות עזר + בדיקות מעבדה trends + culture tables + consult notes |
| What we did | # problem headers from מהלך ודיון + המשך טיפול תרופתי changes |
| Current status | discharge disposition + PT assessment + follow-up plan |

### 3. Write, tightly

- One paragraph per section max (except "What we did" — bulleted list).
- Strip out stuff the room doesn't need (normal CBC, normal LFTs, routine meds unchanged).
- Keep the 2-3 lab trends that actually drove decisions.

### 4. Let the presenter decide what to emphasize

End with **"Open questions for the room"** — 1-3 items the presenter flags for discussion. The skill doesn't decide; the presenter does. Examples:
- "Was empiric ABX the right call given prior sensitivities?"
- "Would you have pursued further workup against patient preference?"
- "Optimal anticoagulation decision here?"

The presenter adds these manually or asks explicitly.

---

## DATA COMPLETENESS CHECK

Before outputting, verify the template has values for:

- [ ] Age + sex
- [ ] Living situation + caregiver
- [ ] Functional baseline (not just "independent" — use specific activity level if stated)
- [ ] Chief complaint (one line)
- [ ] ED vitals
- [ ] Key admission labs with abnormals
- [ ] Imaging summary (if done)
- [ ] Cultures with sensitivities (if done)
- [ ] Problem list with what-we-did for each
- [ ] Discharge status + disposition

If any are missing from the input, mark as `[not provided]` in the output — don't invent.

---

## ANTI-PATTERNS — DO NOT

- ❌ Add condition-specific audit checklists (benzos, Apixaban dosing, etc.) — this skill is a template, not an auditor
- ❌ List every medication
- ❌ Include normal labs by default
- ❌ Use NEJM section headers ("Presentation of Case:", "Differential:")
- ❌ Add citations / PMIDs / references
- ❌ Write opinions about management quality
- ❌ Raise GOC or prescribing concerns unless explicitly in the source data
- ❌ Pad with prose where a table works
- ❌ Generate "teaching points"
- ❌ Hebrew by default (only when asked)

---

## CHAIN OPTIONS

On request, this skill hands off to:
- **`geriatric-case-presentation`** — for a full NEJM-format PPTX journal club deck built on the same case data
- **`szmc-clinical-notes`** — to produce a Chameleon-paste admission note from the same inputs

User says "make slides" / "journal club version" → chain to case-presentation.
User says "write the קבלה" / "admission note" → chain to clinical-notes.
