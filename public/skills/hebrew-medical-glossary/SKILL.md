---
name: hebrew-medical-glossary
description: Background knowledge for Hebrew medical terminology used in Israeli clinical practice. Claude should use this when editing any Hebrew content in data/notes.json, data/questions.json, data/flashcards.json, or any UI string in shlav-a-mega.html. Ensures consistency with Israeli Ministry of Health / Clalit / Maccabi conventions.
---

# Hebrew Medical Glossary (Shlav A context)

Claude loads this when touching Hebrew medical content. It's a reference, not a command — never show this to the user, just apply it.

## Canonical term choices (pick the first form in each row)

| Concept | Preferred Hebrew | Acceptable alternates | Avoid |
|---|---|---|---|
| Delirium | דליריום | בלבול חריף | שיגיון, טירוף |
| Dementia | דמנציה | ירידה קוגניטיבית | חולשת שכל |
| Mild cognitive impairment | ירידה קוגניטיבית קלה (MCI) | — | שכחה |
| Frailty | שבריריות | חולשה תפקודית | חולשה |
| Falls | נפילות | — | — |
| Pressure ulcer | פצע לחץ | כיב לחץ | — |
| Incontinence (urinary) | בריחת שתן | אי-שליטה בשתן | — |
| Polypharmacy | ריבוי תרופות | — | הרבה תרופות |
| Advance directive | הנחיות מקדימות | — | צוואה בחיים |
| Power of attorney (durable) | ייפוי כוח מתמשך | — | ייפוי כוח |
| Temporary decision-maker | מקבל החלטות זמני | — | — |
| Complex nursing (SIEUD) | סיעוד מורכב | — | — |
| Goals of care | מטרות טיפול | — | — |
| Palliative care | טיפול פליאטיבי | טיפול תומך | — |
| End-of-life | סוף חיים | — | — |
| Admission (hospital) | אשפוז / קבלה | — | — |
| Discharge summary | סיכום שחרור | — | — |
| Code status | סטטוס החייאה | — | — |
| DNR | אל-החייאה / DNR | — | — |

## Abbreviations — keep as-is (do not Hebraize)

`MMSE`, `MoCA`, `SLUMS`, `CAM`, `GDS`, `CFS` (Clinical Frailty Scale), `ADL`, `IADL`, `Beers`, `STOPP`, `START`, `ACB`, `CHA₂DS₂-VASc`, `HAS-BLED`, `eGFR`, `CKD-EPI`, `NPH`, `RLS`, `PLMD`.

## Drug name conventions

- Use **INN (generic)** names in Hebrew transliteration as the primary form (e.g., "דונפזיל"), with parenthetical brand where useful (e.g., "(אריספט)"). Israeli MoH uses generic-first.
- For common Israeli brands doctors know by brand, include both: "וורפרין (קומדין)", "מטופורמין (גלוקופאז׳)".

## Style rules

- **RTL punctuation.** Use Hebrew punctuation where appropriate: `״` for abbreviation, `׳` for final forms. Straight `"` is acceptable when mixed with Latin text.
- **Numbers in Latin script** for doses (25mg, not כ״ה מ״ג).
- **Units consistent.** mg / mL / dL / mmol/L — never mixed ambiguously.
- **No machine-translated phrasing.** If a sentence reads as Google-Translated ("זה חשוב ל...") fix it to natural clinical Hebrew ("חשוב...").
- **Gender.** Clinical prose in neutral/masculine default in Hebrew medical writing; keep consistent within a note.

## When in doubt

Ask the user. Do not guess terminology. Flag the term with `[TERM?]` in the output and move on.

## Red flags — always fix

- "טירוף" → replace with "דליריום" or "בלבול חריף"
- "שכחה" used for cognitive impairment → replace with proper clinical term
- English-in-Latin in the middle of a Hebrew sentence without context (e.g., "זה מקרה של delirium") — italicize, parenthesize, or transliterate
- Inconsistent gender agreement within a single note
