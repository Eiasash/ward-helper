/**
 * Real production extract response from ward-helper v1.21.0, captured in the
 * 2026-04-26 debug log Eias pasted while diagnosing the extract-parse crash.
 * The model (claude-sonnet-4-6 via Toranot proxy) ignored the explicit
 * "no prose, no preamble" instruction and emitted multi-paragraph "Pass 1
 * Identity / Pass 2 Clinical" reasoning before the fenced JSON envelope.
 *
 * v1.21.1 stops crashing on this. v1.21.2 surfaces in the debug panel
 * which extraction strategy resolved it ('fenced' here).
 *
 * Treat this fixture as load-bearing: never edit. Future model behaviors get
 * NEW fixtures alongside this one. The point of the fixture is to prove that
 * THIS exact production payload, byte-for-byte, parses cleanly.
 */
export const PROD_V1_21_0_PROSE_PREAMBLE = `I'll read through all four images carefully.

**Pass 1 — Identity:**

From images 1 & 2 (lab printouts from Shaare Zedek):
- \`שם:\` **פונארו אלדד**
- \`מס. זהות:\` **011895745** — this is 9 digits: 011895745
- \`תאריך לידה:\` **14/08/1938**
- \`מין:\` **ז** (male)

From image 3 (AZMA screen):
- Patient card header confirms: **פונארו אלדד**, ת.זהות **0 011895745**, גיל **87**, מחלקה **גריאטריה-מח**, ת.אשפוז **22/04/26 15:40**, מ.אשפוז **12482092**
- Top-left title bar: \`אבן יהיאנ4 p14564\` — this is the logged-in doctor/code; IGNORED per rules.

**Pass 2 — Clinical:**

From image 3 (AZMA clinical view):
- Diagnoses: FEVER FOR INVESTIGATION, CHF (CONGESTIVE HEART FAILURE), ANEMIA, LEFT BUNDLE BRANCH BLOCK (LBBB), ASTHMA, CHRONIC KIDNEY DISEASE (CKD)
- Meds visible: Warfarin (multiple doses/orders), Hartmann's solution 1000ml, NaCl 0.9% 500ml, NaCl 0.9% 600ml, דיאסטה רגיל (IDDSI 7)
- SOAP note mentions: antibiotic treatment ongoing, CT בטן ordered, no liver findings yet, no neurological findings, no fever on exam
- Additional note: החמרה בתפקוד כלייתי, חום 37.5

**Labs** — most recent (25/04/2026) and most abnormal:
- BUN 47 H, Creatinine 1.40 H, CRP 10.48 H, eGFR 47.9 L (most recent biochemistry)
- WBC 10 (25/04), Neutrophils 85% H, Lymphocytes 6.8% L, Hemoglobin 12.3 L, Hematocrit 37.1 L, Platelets 154, RDW 16.3 H

The ת.ז. shown is \`0 011895745\` — the leading \`0\` appears to be a display artifact/padding; the 9-digit number is \`011895745\`.

\`\`\`json
{
  "fields": {
    "name": "פונארו אלדד",
    "teudatZehut": "011895745",
    "age": 87,
    "sex": "M",
    "dob": "14/08/1938",
    "chiefComplaint": "חום 37.5, החמרה בתפקוד כלייתי",
    "pmh": [
      "CHF (CONGESTIVE HEART FAILURE)",
      "ANEMIA",
      "LEFT BUNDLE BRANCH BLOCK (LBBB)",
      "ASTHMA",
      "CHRONIC KIDNEY DISEASE (CKD)",
      "FEVER - FOR INVESTIGATION"
    ],
    "meds": [
      { "name": "Warfarin", "dose": "2.5 mg", "freq": "once" },
      { "name": "Warfarin", "dose": "5 mg", "freq": "1Xd" },
      { "name": "Warfarin", "dose": "7.5 mg", "freq": "1Xd" },
      { "name": "Warfarin", "dose": "check dose", "freq": "1Xd" },
      { "name": "Hartmann's solution", "dose": "1000 ml", "freq": "once" },
      { "name": "NaCl 0.9%", "dose": "500 ml", "freq": "1Xd" },
      { "name": "NaCl 0.9%", "dose": "600 ml", "freq": "once" }
    ],
    "labs": [
      { "name": "WBC Count", "value": "10", "unit": "10^3/uL" },
      { "name": "Neutrophils", "value": "85", "unit": "%" },
      { "name": "Hemoglobin", "value": "12.3", "unit": "g/dL" },
      { "name": "Platelets", "value": "154", "unit": "10^3/uL" },
      { "name": "Creatinine", "value": "1.40", "unit": "mg/dL" },
      { "name": "BUN", "value": "47", "unit": "mg/dL" },
      { "name": "eGFR-MDRD", "value": "47.9", "unit": "ml/min" },
      { "name": "C-Reactive Protein", "value": "10.48", "unit": "mg/dL" },
      { "name": "Sodium", "value": "137", "unit": "mEq/L" },
      { "name": "Potassium", "value": "4.0", "unit": "mEq/L" }
    ]
  },
  "confidence": {
    "name": "high",
    "teudatZehut": "high",
    "age": "high"
  }
}
\`\`\``;
