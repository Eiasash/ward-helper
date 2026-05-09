---
name: geriatrics-knowledge
description: "Project knowledge base for SZMC geriatric medicine clinical practice. Contains Hazzard's Geriatric Medicine, Harrison's Internal Medicine, Washington Manual of Therapeutics, SZMC DAG Antimicrobial Guidelines, Israeli Ministry of Health regulations (ייפוי כוח מתמשך, מקבל החלטות זמני, סיעוד מורכב, driving fitness חוזר מנכ\"ל 6/2023), and Israeli 65+ statistics (Brookdale/JDC). Use the inline tables in this file directly (inline-table lookup is not available in this runtime). Trigger on: drug dosing, Beers criteria, geriatric syndromes (falls, delirium, dementia, frailty, incontinence, pressure ulcers, dysphagia, polypharmacy), disease management, antibiotic selection, STOPP/START, AKI/CKD dosing, electrolytes, heart failure, VTE, palliative care, goals of care, functional assessment, nutrition, pain, perioperative risk, capacity assessment, ייפוי כוח מתמשך, מקבל החלטות זמני, driving fitness, נהיגה, כשירות לנהוג, סיעוד מורכב admission criteria. Never answer clinical questions from memory alone — always cite from the inline tables in this file."
---

# Geriatrics Project Knowledge Skill

## Purpose

Primary clinical reference corpus for SZMC geriatric ward practice.
Search before answering any clinical, pharmacological, legal, or regulatory question.

---

## Source Hierarchy

| Priority | Source | Domain |
|----------|--------|--------|
| **1** | SZMC DAG Antimicrobial Guidelines | Empiric antibiotic selection — always overrides |
| **2** | **Hazzard's Geriatric Medicine** | Geriatric syndromes, pharmacology, aging physiology — authoritative |
| **3** | **Harrison's Internal Medicine** | Pathophysiology, diagnosis, general internal medicine |
| **4** | Washington Manual of Therapeutics | Drug dosing, treatment algorithms, electrolyte protocols |
| **5** | Israeli MOH Circulars | Capacity law, surrogacy, ward licensing, driving fitness |
| **6** | Brookdale/JDC 65+ Statistics | Israeli epidemiology, prevalence, service benchmarks |

**Rules:**
- DAG overrides all for antibiotic selection at SZMC
- Hazzard's overrides Harrison's for geriatric-specific clinical management
- Israeli MOH law overrides textbooks for medico-legal decisions
- GRS removed from hierarchy — superseded by Hazzard's + Harrison's

---

## Hazzard 8e Chapter Map (verified by PyMuPDF scan, 2026-05-08)

**Source PDF:** `C:\Users\User\OneDrive\Documents\Claude\Projects\SZMC geriatrics\hazzard marked  (3).pdf` (460 MB single PDF; faster to text-search than the 11-part split at `Geriatrics/.audit_logs/upload_staging/hazzard_marked__partNN.pdf`).

**Verified chapter ranges** (PDF page = book page + 34 offset):

| Ch | Title | PDF p | Book p |
|---|---|---|---|
| 33 | LOW VISION: ASSESSMENT AND REHABILITATION | 504–523 | 470–489 |
| 34 | HEARING LOSS: ASSESSMENT AND MANAGEMENT | 524+ | 490+ |

**Note for q.ref correctness on PWA questions:** the canonical title strings are exactly as they appear in the PDF chapter heading. When constructing or validating a `q.ref` value, match this exact form:

- `Hazzard Ch 33 — LOW VISION: ASSESSMENT AND REHABILITATION`
- `Hazzard Ch 34 — HEARING LOSS: ASSESSMENT AND MANAGEMENT`

The em-dash `—` (U+2014) is required. Hyphen-minus `-` will fail hazzard_chapters.json schema-guard. Trailing space / trailing colon / abbreviated titles all fail.

**Other verified chapter starts (incidental, from same scan):**

| Ch | Title (head text) | PDF p |
|---|---|---|
| 14 | MODELS OF HOSPITAL AND OUTPATIENT CARE | 232 |
| 15 | EMERGENCY DEPARTMENT CARE | 244 |
| 27 | (section header — Surgical Management) | 142 |
| 9 | MENTAL STATUS AND NEUROLOGIC EXAMINATION | 178 |
| 10 | ASSESSMENT OF DECISIONAL CAPACITY AND COMPETENCIES | 186 |

(Add to this table as future PDF scans verify more chapters.)

**Workflow:** if a future cluster batch needs another Hazzard chapter verified, run `_web_lane_find_hazzard_eye_v2.py` (in `~/repos/.audit_logs/`) with the eye keywords swapped for the new target's keywords. Takes ~6 seconds per scan.

---

## Search Patterns

Read the inline tables in this file directly. The runtime does not provide search.

```
Antibiotic:     "SZMC DAG pneumonia empiric"
Drug safety:    "Beers criteria benzodiazepines elderly"
Syndrome:       "delirium prevention nonpharmacologic hospital"
Renal:          "metformin CKD eGFR dosing"
Capacity:       "ייפוי כוח מתמשך רפואי"
Surrogacy:      "מקבל החלטות זמני תהליך"
Driving:        "driving fitness dementia cognitive"
Admission:      "סיעוד מורכב קריטריונים"
Falls:          "falls prevention inpatient geriatric"
```

---

## Clinical Domains

### Geriatric Syndromes
Falls, delirium (CAM, prevention, management), dementia (types, BPSD, capacity
assessment), frailty (CFS, sarcopenia), urinary incontinence, pressure injuries
(staging, prevention, grade 3–4 management), dysphagia (aspiration risk, diet
modification), malnutrition (MNA, supplementation, refeeding syndrome), sleep
disorders, dizziness/vertigo.

### Pharmacology
Beers Criteria 2023, STOPP/START, renal dosing (Cockcroft-Gault; actual weight if
BMI <30, IBW if obese), anticholinergic burden (ACB scale), drug interactions in
polypharmacy, medication reconciliation admission/discharge.

### Cardiovascular
HFpEF/HFrEF (SGLT2i, diuretic titration), AF (rate vs rhythm, anticoagulation,
CHA₂DS₂-VASc, HAS-BLED), hypertension targets by frailty (SBP 130–150),
perioperative cardiac risk (RCRI, Lee index).

### Infectious Disease
SZMC DAG: empiric selection by syndrome — CAP, HAP, UTI, SSTI, intra-abdominal,
bacteremia, C. diff (fidaxomicin vs vancomycin tiers). Antibiotic renal adjustment.
Atypical sepsis presentation in elderly (no fever, AMS as sole sign).

### Nephrology / Electrolytes
AKI (KDIGO staging, prerenal vs intrinsic), CKD dosing adjustments, hyponatremia
(SIADH vs hypovolemic, correction rate, tolvaptan), hyperkalemia (ECG changes, acute
ladder), hypomagnesemia, hypophosphatemia, contrast nephropathy.

### Endocrinology
DM in elderly (HbA1c targets by frailty, hypoglycemia risk, deintensification),
thyroid (subclinical hypothyroidism, myxedema, thyroid storm), adrenal insufficiency,
sick-day rules.

### Pulmonology
CAP (CURB-65, PSI, DAG antibiotic), COPD exacerbation (NIV criteria, steroid
duration), PE (Wells, age-adjusted D-dimer, anticoagulation in elderly), aspiration
pneumonitis vs pneumonia distinction.

### Hematology / Anticoagulation
VTE prophylaxis (Padua score, pharmacologic vs mechanical), anticoagulation reversal
(warfarin, DOAC-specific agents), anemia workup in elderly (iron, B12, folate), HIT
(4T score, management).

### Neurology
Stroke (tPA eligibility, secondary prevention), Parkinson's disease (missed dose is
clinical emergency — dopaminergic crisis risk), seizure (first seizure workup, AED
drug interactions in polypharmacy).

### Palliative / Ethics
Goals-of-care framing, prognosis tools (4-variable mortality index), comfort care
orders, pain/dyspnea/secretion management at EOL, Israeli legal framework for
surrogate decision-making (see below), capacity assessment methodology.

### Functional / Rehabilitation
Barthel / Katz ADL, MMSE / MoCA interpretation, CFS, early mobilization, hospital-
acquired deconditioning prevention, discharge planning criteria.

---

## Israeli Legal Framework — Clinical Reference

### 1. ייפוי כוח מתמשך (Lasting Power of Attorney)
*MOH Legal Department circular, August 2023*

Legal document (capacity required at signing, ≥18 yo) appointing a proxy for
personal/financial/medical decisions when grantor loses capacity.

**Medical scope** (ייפוי כוח רפואי or personal with health scope):
- Proxy can authorize urgent medical procedures without court order
- Proxy registers document + commitments with האפוטרופוס הכללי
- Attending physician: allow emergency entry for urgent treatment even before
  registration — notify Registrar promptly after

**Decision hierarchy before any incapacitated patient decision:**
```
1. Active ייפוי כוח מתמשך with medical authority → activate proxy
2. Advance directives (הנחיות מקדימות, s.35א Capacity Law) → follow
3. Neither → מקבל החלטות זמני process (see §2)
4. No family agreement → court petition for אפוטרופוס
```

Physicians cannot initiate ייפוי כוח — patient must have presented it.
Check for existence before defaulting to family consensus.

---

### 2. מקבל החלטות זמני (Temporary Medical Decision Maker)
*Patient Rights Law Amendment 16, enacted 15.01.2024 — MOH Medical Directorate circular*

**Purpose**: Alternative to court for urgent (non-emergency) decisions when patient
cannot consent and no ייפוי כוח / guardian exists.

**Prerequisites — all must be met:**
- Patient cannot give informed consent
- Procedure is urgent (not emergency — emergencies use 3-physician rule)
- No valid ייפוי כוח / appointed אפוטרופוס for medical matters
- Family consensus exists on who should be surrogate

**Step-by-step process (your clinical role):**

Step 1 — You (specialist physician):
- Determine urgent procedure is needed
- Document patient cannot consent
- Attempt accessibility accommodations per Disabilities Law
- If capacity uncertain → consult psychiatrist or geriatrician

Step 2 — עו"ס (social worker, working hours):
- Verify no existing ייפוי כוח or advance directives
- Convene family; achieve consensus on one surrogate
- Inform family of legal priority order (below)
- Obtain family signature on **נספח א'** (Declaration form)

Step 3 — Hospital director or delegate:
- Reviews case
- Signs **נספח ב'** (Authorization) → authorization active
- All documentation → patient chart; copy to surrogate

**Family priority order** (Patient Rights Law s.14b(a)):
spouse → child → parent → sibling
(Agreement on different order permissible)

**Validity**: 6 months from signing, for all required procedures.
Re-check capacity before each procedure — if patient consents directly, use that.

**On discharge**: Re-assess capacity; document current capacity status in discharge letter.

**Parallel track**: Family can still petition for אפוטרופוס during the 6-month period.

**This tool does NOT apply when:**
- Valid ייפוי כוח מתמשך exists (including personal scope covering health)
- Appointed guardian already exists
- Family disagrees — must go to court

---

### 3. סיעוד מורכב (Complex Nursing — Geriatric Ward)
*MOH Circular 4/2010, amended 14/3/23*

**Admission criteria — must meet ALL:**
- Chronically functionally dependent (סיעודי or תשוש נפש per MOH definition)
- PLUS at least one active medical complexity criterion:

| Criterion | Detail |
|-----------|--------|
| Medical instability | Not requiring general hospital but needs continuous monitoring |
| Pressure ulcer | Grade 3 (subcutaneous loss) or grade 4 (bone/muscle exposure) |
| IV therapy | IV fluids or medications for extended period |
| Respiratory | Tracheostomy, BiPAP ventilation, frequent suction >1×/shift, or continuous O2 monitoring |
| Dialysis | Chronic peritoneal or hemodialysis |
| Active malignancy | Requiring active treatment: transfusions, pleural drainage, IV chemo/radio, pain control |
| Recurrent transfusions | >1×/month after diagnostic workup complete |

**Exclusions — do not admit:**
- Sub-acute patient not chronically dependent (→ general ward first for stabilization)
- Prolonged mechanical ventilation (separate facility type)
- Rehabilitation potential (→ geriatric rehabilitation unit)
- Patient manageable at home
- Post-trach ventilator weaning

**Staffing requirements (36-bed reference unit):**
- Medical director ≥0.5 FTE geriatric training; geriatrician on-call 24/7
- Resident 24/7 (not counted in FTE)
- Mandatory: Infectious disease consultant (standing agreement)
- Additional per patient mix: nephrology, ENT, oncology, surgery, dermatology, psychiatry, urology
- Social worker ≥0.5 FTE with palliative care training
- Lab 24/7: CBC+diff, electrolytes, glucose, urea, creatinine, coagulation, blood gases, cultures
- Urgent lab results within 4 hours
- Radiology available 24/7; blood bank access

**Admission disputes:** District geriatrics physician (גריאטר מחוזי) → if unresolved:
MOH Head of Geriatrics Division.

---

### 4. Driving Fitness — חוזר מנכ"ל 6/2023 + נספח 12ב'
*Director General MOH circular, amended August 2023*

**Physician obligation**: Report patients whose medical conditions may endanger
themselves or others while driving.

**Reporting portal** (old paper form cancelled August 2023):
`https://www.gov.il/he/service/medical-fitness-reports-for-drivers`
Electronic form and electronic reporting link both available there.

**Driving task domains** (from נספח 12ב' — clinical assessment framework):

| Domain | Key Requirements |
|--------|-----------------|
| **Physical** | Upright posture, steering wheel + pedal control (fluently), limb coordination, vehicle entry/exit, joint range, pedal force/speed |
| **Sensory** | Distance vision (intersections, distance judgment, oncoming traffic), near vision (curbs, signs), hearing (sirens, horns, pedestrians) |
| **Cognitive** | Correct decisions in rapidly changing environment, fast appropriate response, continuous traffic law awareness |

**Geriatric red flags for driving:**

| Condition | Issue | Action |
|-----------|-------|--------|
| Dementia (any stage) | All 3 domains impaired | Report + formal המרב"ד evaluation |
| Parkinson's | Motor + cognitive | Disease-specific assessment; may need OT driving eval |
| Uncontrolled epilepsy | Unpredictable LOC | Absolute contraindication per Israeli traffic law |
| Severe visual impairment | Acuity, visual fields | Refer ophthalmology; report if impaired beyond threshold |
| Syncope / severe orthostatic hypotension | LOC risk | Report during active investigation |
| Acute stroke/TIA | Temporary disqualification | Report; re-evaluate post-rehabilitation |
| Beers-listed sedating drugs | Cognitive + motor impairment | Benzos, first-gen antihistamines, sedating antipsychotics, opioids |

**Workflow:**
1. Identify condition
2. Document conversation with patient in chart
3. Advise patient in writing to stop driving pending evaluation
4. Report electronically via MOH portal (המרב"ד)
5. Formal fitness evaluation → referral to המרב"ד assessor

---

### 5. Israeli 65+ Statistics (Brookdale/JDC Annual Yearbook)

26th year of publication. Covers:
- Demographic: age subgroups (65–74, 75–84, 85+), sex, district
- Health: life expectancy, mortality, chronic disease, disability, health service use
- Social: education, employment, economic status, loneliness, religiosity, volunteering
- Services: community (home care) vs institutional (מוסד ≈ nursing home) utilization rates
- International comparison: 65+ proportion, dependency ratios, mortality, marital status, workforce participation

Use for: Prognosis context, goals-of-care conversations, understanding what's typical
for an Israeli patient of this age. Full database: `brookdale.jdc.org.il`

---

## Automatic Medication Analysis

Run for every drug query without being asked:

1. **Beers 2023** — drug on list for ≥65? Avoid or use with caution?
2. **STOPP/START** — inappropriate? Missing indicated drug?
3. **Renal dose** — CrCl-based adjustment (Cockcroft-Gault)?
4. **ACB score** — anticholinergic burden contribution?
5. **Drug interactions** — cross-check current list
6. **Fall risk** — sedatives / antihypertensives / diuretics / antipsychotics?
7. **Driving risk** — does this impair driving (→ flag for driving fitness discussion)?

---

## Response Format

```
ANSWER
  Direct answer first. Mechanism second.
  Source: [Hazzard's | Harrison's | Washington | DAG | MOH Law]

GERIATRIC FLAGS
  Beers / STOPP-START / renal dose / ACB / falls / driving — applicable only.

SZMC CONTEXT
  DAG antibiotic if relevant. Israeli legal framework if capacity/surrogacy involved.

GAPS
  Outdated edition, missing data, or question outside knowledge base.
```

Peer-level analysis. Mechanism-based. No scaffolding. Atypical geriatric presentations
always flagged. Israeli legal context integrated when medico-legally relevant.

---

## SZMC Institutional Context

- Ward: Geriatric department, Shaare Zedek Medical Center, Jerusalem
- Shift: 26-hour on-call; covers ward + new admissions overnight
- DAG = SZMC local antibiotic guidelines — always override generic recommendations
- Common organisms: ESBL producers, MDR-GNB in recurrent UTI; MRSA low prevalence
- CrCl formula: Cockcroft-Gault; actual weight if BMI <30, IBW if obese
- Israeli legal framework applies: ייפוי כוח מתמשך / מקבל החלטות זמני / הנחיות מקדימות

---

## Gaps — Priority Additions

| File to Add | Why Critical |
|-------------|-------------|
| `STOPP_START_2023.md` | Full criteria not indexed; highest-yield polypharmacy tool |
| `FRAILTY_TARGETS.md` | CFS × condition × target (HbA1c, SBP, anticoag, statin) |
| `ANTIBIOTIC_QUICKREF.md` | DAG extracted: syndrome → drug → dose → renal → duration |
| `ISRAEL_DRUG_NAMES.md` | Generic ↔ Israeli trade name cross-reference |
| `FUNCTIONAL_SCORES.md` | All scoring tools in one file: Barthel, Katz, CFS, CAM, Padua, CURB-65, Wells, RCRI |
| `PALLIATIVE_PROTOCOLS.md` | SZMC comfort care orders, EOL symptom management |
| Hazzard's 8e full index | Ensure all 8e chapters (excluding 2–6, 34, 62 per P005-2026) are fully indexed in project knowledge |