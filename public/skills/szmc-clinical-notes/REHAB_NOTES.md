# SZMC Rehab Notes — reference for the szmc-clinical-notes skill

_Extracted from SKILL.md to keep the always-loaded skill body lean. Load this file in full when writing a rehab admission (קבלת שיקום), rehab daily round (ביקור רופא), or rehab discharge (סיכום אשפוז שיקומי)._

## REHAB NOTES — admission and daily rounds

**The geri-rehab ward (גריאטריה -שיקום) runs on a different note rhythm than acute medicine.** Three settings are supported:

- **rehab-admission** (קבלת שיקום) — invoked by "כתוב לי קבלת שיקום", "rehab admission", or transfer-from-acute patient data
- **rehab-rounds** (ביקור רופא) — invoked by "ביקור רופא", "daily round", "rehab round". Daily M–F per patient regardless of complexity.
- **rehab-discharge** (סיכום אשפוז שיקומי) — invoked by "סיכום אשפוז שיקומי", "rehab discharge", or discharge of a patient off the rehab ward. See the rehab-discharge section below.

### Rehab admission — inheritance pattern

The rehab admission is structurally a **transfer note**, not a fresh admission. The patient's history was taken by the source department; recreating it is wasted effort and introduces inconsistencies. Inherit the source-department narrative wholesale and add only the on-arrival snapshot.

**Source departments seen at SZMC geri-rehab:**
- Neurology (post-CVA, post-ICH)
- Orthopedics (post-fracture, post-spine surgery)
- Cardiology / cardiothoracic (pre/post valve, pre/post CABG)
- Geri-mugbar / acute geriatrics (deconditioning, post-medical-illness)
- Internal medicine (post-pneumonia, post-sepsis recovery)

**Section structure (printed-output order):**

1. **כותרת** (auto)
2. **הצגת החולה** — single line: `בן/בת X, [marital], [living situation], [transferred from]`. Example: `בן 77, אב ל-4 ילדים, מתגורר עם אישתו בקומה 2 עם מעלית. הגיע מגריאטריה מוגבר לשיקום טרום-ניתוחי.`
3. **אבחנות פעילות** — keep MINIMAL: `ADMISSION FOR REHABILITATION` first, then **only** the genuinely-active acute issue(s) continuing into rehab (e.g. an active `UTI`). The recent **surgery goes to ניתוחים בעבר**, and the **resolved/chronic problem (ischemic leg, arterial occlusion, the stroke once stable) goes to אבחנות ברקע** — NOT under active. **Pull every diagnosis from the EMR's CODED diagnosis list, never paraphrase from the narrative prose** (the coded list is authoritative; e.g. filed dx `ADENOCARCINOMA OF RECTUM` even when the HPI prose says "SCC of anus" — flag the mismatch but use the coded term). **The rehab stay gets a NEW אשפוז number** — use it in the header, never carry the acute-stay number.
4. **אבחנה משוערת** — only if relevant (e.g., `ENDOCARDITIS (IE / BE / SBE)` in PATIENT case)
5. **אבחנות ברקע** — chronic + recent acute that resolved. English UPPERCASE.
6. **ניתוחים בעבר** — surgical history, especially recent admission's procedure
7. **תלונה עיקרית** — the rehab-specific transfer reason. Examples:
   - `העברה ממחלקה נירולוגיה לצורך שיקום` (post-stroke)
   - `חיזוק ושיפור מצב לפני ניתוח לב פתוח` (pre-cardiac-surgery)
   - `העברה מאורתופדיה לצורך שיקום לאחר ניתוח דהקומפרסיה וקיבוע T7-L2`
8. **רקע רפואי** — מחלות + previous admissions
9. **מחלה נוכחית** — **INHERIT from source-dept discharge dictation**. Do not retake history. Audit the source narrative for typos / voice-rec errors and paste cleaned version. If source dept used `#`-prefixed problem-list (אונקולוגי / זיהומית / תפקודית etc.), preserve that structure.
   - **When the source was a surgical dept (e.g. ortho) and the request is to write it "as if admitted to that dept", write מחלה נוכחית as that dept's admission HPI** — narrate the *in-hospital course*, not the at-home story: baseline + fall/mechanism → fracture/diagnosis → operative fixation (date, implant) → post-op course (transfusion, control film, Vit-D repletion, PT mobilization) → transfer to rehab. The home/social story belongs in הצגת החולה and תפקוד, not here.
   - **Do NOT propagate a source's "ללא רקע רפואי" / "no PMH" when the EMR's CODED background contradicts it.** The coded background list is frequently RICHER than the acute discharge (which often under-captures comorbidity — e.g. ortho discharge says "no PMH" while the coded list carries GERD, lumbar spinal stenosis, a prior vertebral fracture s/p kyphoplasty, prior surgeries, prior osteoporosis therapy). Trust the coded list, omit the false "no background" clause, and flag the discrepancy in the team box.
10. **רגישויות** — inherit
11. **תרופות בבית** — inherit (auto sidebar populates from Chameleon DB)
12. **בדיקה גופנית** — **on-arrival snapshot**. Use the **admission-encounter bedside vitals** (the set taken at the actual admission contact), **NOT the AZMA header snapshot** — they differ and the header is often a stale morning reading. Record the time/date taken.
    ```
    הופעה כללית: ל"ד X/Y, דופק Z, חום W, סטורציה N% [נלקח HH:MM DD/MM]
    ריאות: כניסת אוויר טובה ושווה / ללא ממצא חריג / [findings]
    לב: סדיר / לא סדיר עם אוושה X/6
    בטן: רכה ללא רגישות / [findings]
    גפיים: בצקות / ללא בצקת / [findings]
    עצבים: [neuro exam — especially relevant if post-CVA or post-spine]
    ```
13. **בדיקות עזר** — **dedicated section** (do NOT fold imaging into the discussion the way some filed notes do — Eias's preference is a standalone section). One line each: ECG (rhythm + QTc), CXR, CT/CTA, Doppler, ECHO — raw findings only, **no specimen/accession reference numbers**, no arrows, no interpretation words.
14. **בדיקות מעבדה** — **dedicated section**, raw values only (no H/L, no normal-range parens, no specimen/accession IDs). Prose trend format: `נתרן בקבלה X, במהלך האשפוז Y עד Z`. Pull the recent bloods + any recent workup; fill it, do not leave blank.
15. **דיון** — **OPENS with a one-paragraph synthesis CAPSULE before any `#`** (Eias 16/06/26), then the `#`-prefixed problem list. The capsule, in order: age + independent/previously-walking baseline + `רקע כמפורט מעלה` + admitted to [surgical dept] for surgery and transferred to our ward for rehab + on-arrival exam (**pertinent findings ONLY** — wound status, neurovascular, no-edema, no acute cardiopulmonary finding) + **pertinent latest imaging/labs** (post-transfusion Hb, renal, Vit-D, control film) — then the line `כעת מציגה את הבעיות הבאות לדיון:` followed by the `#` list. It is **NOT** a bare `#` list. One `#` per active problem, labs woven into the relevant `#`. **NO plan inside this block.**
   - **EXPAND each `#` with the clinically meaningful context and reasoning** — don't reduce it to a label. e.g. for osteoporosis: name the loading dose already given (Vit-D 50,000u), the agent decision and *why* (TERIPARATIDE/FORTEO as anabolic for bisphosphonate **treatment failure** — a fracture under/after a bisphosphonate), and the renal constraint (CrCl). The discussion is where the thinking is shown; the plan carries the one-line actions.
16. **תוכנית** — a **SEPARATE final paragraph**, **one line per plan item** (e.g. `שיקום מעברים`, `המשך אנטיביוטיקה ומעקב מדדי דלקת`, `איזון סוכר`, `מעקב פצע`, `תיאום סוציאלי לקראת שחרור`). Carry the concrete actions the discussion implies — **drug-initiation/stop decisions with timing** (e.g. start TERIPARATIDE after Ca/Vit-D correction; continue prophylactic anticoagulation until 1 month post-op *with the stop date*), follow-up labs, and discharge-planning steps.
   - **Post-op rehab admissions: include an estimated suture/staple removal date based on POD** (see `ortho-reference` §6 — hip / proximal extremity = POD 10–14; compute from the surgery date, e.g. surgery 07/06 → ~POD 14 ≈ 21/06), with the caveat "after confirming the wound is well-healed." Avoid the Friday-punt-to-weekend trap.

**Critical rules:**

- **The rehab admission body is short by design.** Most substantive content lives in the inherited מחלה נוכחית paragraph. The doctor's value-add is the on-arrival exam, the בדיקות עזר/מעבדה, and the framing of what rehab is for.
- **FILL ALL GAPS — no "to confirm" placeholders in the note body.** The תפקוד section gets the FULL functional grid from the PT/OT intake: the 9 ADL items graded 3-tier (הלבשה / רחצה / אכילה / הכנת אוכל / ניידות / ניידות בכיסא גלגלים / מעברים / שליטה על שתן / שליטה על יציאה) plus מגורים / עזרה / ניידות-aid / התמצאות / הזנה. Resolve floor + elevator and the rehab room + bed. Genuine unknowns (a real source contradiction, or a current grade the PT hasn't recorded) stay flagged in the non-copy team box — that is the ONLY place a "confirm" item belongs.
- **ALWAYS output the medication orders to give/enter in the SAME turn as the note** — not only when separately asked. Group `קבוע` / `לפי צורך (PRN)` / `מוחזק-לברר (held/clarify)`. **Default to give = the CURRENT ACTIVE orders on the sending department's AZMA medication grid** (continue them), UNLESS the transfer letter (סיכום) specifies otherwise. **IMPLEMENT documented medication recommendations** from the transfer letter / consult — add, reduce, stop, or titrate — do not merely copy the active list. Verify Israeli brand names against the drug database before writing orders.
- **WATCH the בדיקות עזר free-text panel for wrong-patient / template contamination.** That free-text box sometimes holds values that are NOT this patient's (a leftover template or another patient's labs). Real case (PATIENT 16/06): the panel showed Na 133 / BUN 73 / Cr 2.76 / Troponin 264 / CRP 21.44 while the patient's actual labs were Cr ≤1.01, Troponin <10, CRP 0.12. **Cross-check every value in that panel against the patient's real lab results; if foreign, flag it and clear it — never paste it into the note.**
- **Verify home floor + elevator across sources — it is discharge-critical.** The admission `הצגת החולה` and the social-work note can conflict (PATIENT: admission `קומה 3 ללא מעלית` vs social work "building has an elevator"). For a return-home rehab goal this changes the whole plan (stair training, home access). Reconcile before signing; if unresolved, flag in the team box.

### Rehab daily rounds (ביקור רופא) — three patterns

Headers (always underlined, this exact order, every note):
```
S דיווח המטופל:
O בדיקה גופנית וממצאי עזר:
A מסקנה והערכה:
P לביצוע:
תוכנית טיפול (יעדי טיפול):
```

The format inside `A` and `P` depends on **where in the admission you are**:

- **Pattern FIRST-DAY** — the SOAP written on day 0 or day 1 of the rehab admission. Detailed regardless of patient complexity. Establishes the chart for everyone who'll round over the next month.
- **Pattern STABLE** — subsequent rounds when the patient has no active acute issues. Minimal.
- **Pattern COMPLEX** — subsequent rounds when ≥2 complexity triggers fire. Problem-list `*` bullets in `A`.

Triage rule (60-second decision):
1. Is this the day-1 round (first SOAP after admission)? → **FIRST-DAY**, regardless of complexity.
2. Otherwise: count active complexity triggers. ≥2 → **COMPLEX**. <2 → **STABLE**.

**Verbosity gradient (holds across all three patterns):** `A` is always more detailed than `P` — `A` carries the clinical reasoning, `P` is the tighter action list. FIRST-DAY is the most verbose SOAP of the admission (full capsule + complete problem list); from the next round on the capsule drops and `A` leans toward delta/update over a full restatement — but `A` stays more detailed than `P` every round.

---

**Pattern FIRST-DAY — detailed SOAP with patient capsule** (use on day 0 or day 1 of the rehab admission, always):

This is the framing handoff. Written once per admission. Contains content you won't repeat in subsequent rounds.

```
S דיווח המטופל:
[Patient's voice on the TRANSFER — not just "feels good"]
[How they slept the first night in the new ward]
[Pain control adequacy with current regimen — ask explicitly, by indication site]
[Recent events worth surfacing — fall pre-admission, near-syncope in PT, etc.]
[Concerns about upcoming surgery / discharge / family situation]
[Mood and motivation for rehab — explicit ask]

O בדיקה גופנית וממצאי עזר:
[Vitals — incl. orthostatic if any falls/dizziness in story]
[General appearance, cooperation, cognition implicit via conversation]
[Indication-matched focused exam — see "Focused exam by indication" below]
[Surgical wound if post-op — describe specifically: length, sutures, drainage, healing]
[Per-limb motor + sensation + DP if mobility-relevant]
[ECG findings if abnormal at admission]

מעבדה:
[Today's / admission labs — date-stamped. A decision-driving value is ALSO cited in the relevant A bullet as reasoning. NEVER inside O.]

A מסקנה והערכה:
[3-4 line PATIENT CAPSULE — see formula below. This is the framing handoff.]

בעיות:
*[domain] - [status, relevant lab/result inline when it drives a decision today, decision]
*[domain] - [status + decision]
[...as many as active]

P לביצוע:
[Actions with explicit timing — היום / מחר בבוקר / יומיומית]
[Labs being added today]
[Consultations being requested]
[Specialty referrals — psych, nephro+endo for CKD-MBD, social work, etc.]

תוכנית טיפול (יעדי טיפול):
[Concrete goal by indication — see goal-by-indication table below]
```

**The patient capsule — formula:**

```
[age] [marital status] [parent count if relevant]. [living situation — alone / with whom / which floor / elevator yes-no].
רקע רפואי כולל [3-5 chronic conditions, prioritized by relevance to rehab].
בבסיס [pre-admission ADL/IADL one-liner: עצמאי / עם הליכון / עם קלנועית / סיעודי].
כעת לאחר [acute event] בתאריך [DD/MM]. התקבל/ה לשיקום ביום [N] לאחר [הניתוח/האירוע].
```

Worked example (PATIENT, post-ORIF day 10, ESKD):
```
בן 62, גרוש, אב ל-2, מתגורר לבד בקומה 5 עם מעלית. אחות בקשר.
רקע רפואי כולל ESKD על המודיאליזה 3X בשבוע דרך פיסטולה משמאל, סוכרת לא מאוזנת על אינסולין,
יל"ד, רטינופתיה סוכרתית עם עיוורון בעין שמאל, אנמיה כרונית, היסטוריה של דיכאון.
בבסיס תפקודי - עצמאי בכל ה-ADL, מתנייד עם קלנועית מחוץ לבית, הליכון בבית.
נפל מהקלנועית 22.4.26, סבל שבר סאבטרוכנטרי בירך שמאל, עבר ORIF עם מסמר GAMMA ב-23.4.
כעת הועבר אלינו לשיקום ביום 10 לאחר הניתוח.
```

Capsule rules:
- **Cross-check demographics against admission הצגת החולה.** Marital status, parent count, living situation are propagated from your day-1 capsule into every subsequent note by every physician for the next month — getting them wrong on day 1 corrupts the chart. The PATIENT 13/04 note had `אלמנה ואם ל-2` while admission said `רווקה / אם ל-5` — that's the failure mode.
- **Days post-event** (e.g., "ביום 10 לאחר הניתוח") is critical context for analgesia, anticoag duration, suture removal — calculate it explicitly.
- **Mention contact person and relationship** (sister, son, daughter, niece) — discharge planning starts here.
- **Pre-admission baseline** is one line. Don't restate the OT intake; reference it.

**Focused exam by indication (the FIRST-DAY O section):**

| Indication | Add to standard 4-system exam |
|---|---|
| Post-CVA | Cranial nerves, motor per limb segment, sensory, language/dysarthria, gait if attempted |
| Post-hip / knee replacement | Surgical wound (length, sutures, drainage), per-limb motor (IP/QUAD/knee flexion/ankle), DP pulse, pain on ROM |
| Post-spine surgery | Surgical wound, motor IP/QUAD/dorsi-plantar flexion bilaterally, sensation, sphincter function |
| Pre-cardiac surgery | Heart auscultation (murmur grade, location), JVP, lung bases, peripheral edema, peripheral pulses |
| Post-medical illness / deconditioning | Volume status, sit-stand attempt with documented difficulty, grip if relevant |
| ESKD on HD | Fistula/graft thrill+bruit, signs of infection at access site |

**Pattern STABLE — minimal SOAP** (subsequent rounds, no active acute issues):

```
S דיווח המטופל:
מרגישה טוב
ישנה בלילה
פעמ"ם שלשום

O בדיקה גופנית וממצאי עזר:
חום 36.7, ד 78, ל"ד 110/60, סטורציה 97% על אוויר חדר
קולות הלב סדירים
כ"א טובה לריאות
בטן רכה
גפיים ללא בצקת

מעבדה:
[today's labs if drawn — date-stamped; else omit the section. NEVER inside O.]

A מסקנה והערכה:
בשיקום לאחר CVA - מתקדם היטב
ל"ד במעקב - מורידים תרופות לל"ד

P לביצוע:
המשך שיקום

תוכנית טיפול (יעדי טיפול):
[case header — see below]
```

**Pattern COMPLEX — problem-list SOAP** (subsequent rounds, ≥2 of these triggers active):

Complexity triggers:
- IV antibiotics with drug-level monitoring (Vanco, gentamicin, etc.)
- Post-op with active wound, drain, or VAC dressing
- Active diuresis with changing volume status
- BP / glucose actively being titrated (≥2 dose changes/week)
- AKI in evolution
- Pending procedure (echo, ortho consult, surgery decision)
- New abnormal labs requiring follow-up (neutropenia, electrolyte derangement, etc.)
- ≥2 active acute clinical problems running in parallel

```
S דיווח המטופל:
מרגיש טוב, ללא כאב

O בדיקה גופנית וממצאי עזר:
חום 36.4, ד 73, ל"ד 161/65, סטורציה 97% על אוויר חדר
קולות הלב סדירים + אושה סיסטולית
כניסת אוויר טובה לריאות ללא חרחורים
בצקת +++ ברגליים - שיפור משמעותי עדיין בצקת משמעותית

מעבדה:
קראטינין 1.3, שאר תפקודי כליות וביוכימיה ללא שינוי משמעותי (DD/MM)

A מסקנה והערכה:
מצבו יציב, מעבר לבעייה תפקודית, בעיות פעילות
*אורתופדית - עדיין חבישת ואקום, צוות אורתופדי יבוא היום לבדוק ולהוריד / להחליף
*זיהומית - ממשיך VANCO + RIFAMPICIN. החמרה קלה בתפקוד כלייתי היום (קראטינין 1.3) - כנראה משני לטיפול במשתנים, נעקוב אחר רמת VANCO מחר בבוקר
*בצקת פריפרית משמעותית. מקבל SPIRONOLACTONE + FUROSEMIDE - נעביר FUROSEMIDE לפומי עם מעקב משקל

P לביצוע:
החלטה לגבי חידוש או החלפה של VAC היום
FUROSEMIDE פומי במקום IV
רמת VANCO לפני המנה הבאה מחר בבוקר
מעבדה היום - תפקודי כליות וביוכימיה
שקילה יומיומית
הפסקת טיפול ב-TAMSULOSIN

תוכנית טיפול (יעדי טיפול):
[case header — see below]
```

**Pattern COMPLEX rules:**
- Each `A` bullet starts with `*[domain] - ` followed by status + decision in one sentence
- Each `A` bullet is a **trajectory vs the prior round**, not a fresh status: unchanged → `ללא שינוי משמעותי`; changed → state the delta in prose (`קראטינין ירד מ-2.1 ל-1.8`, `APIXABAN הופסק`, `חום 39.2 ירד ל-afebrile`); resolved → `נפתר`; new problem → add it under the right `*domain`. The prior round's note is already in the chart — don't re-describe what hasn't moved.
- Domain prefixes (pick what's active, not a fixed template):
  - `*אורתופדית` (post-op spine/joint, wound, fixation, drain, VAC)
  - `*זיהומית` (active ABX, levels, source control, cultures)
  - `*תפקודית` (functional progression, transfers, mobility, ADL improvement/regression)
  - `*כלייתי` (AKI/CKD trajectory, drug-related toxicity, hydration)
  - `*לבבי` (HF, arrhythmia, surgical timing)
  - `*לחץ דם` (HTN management, drug changes)
  - `*בצקת` (volume status, diuretic titration)
  - `*נשימתי` (O2, pneumonia, OSA, secretions)
  - `*נוירולוגית` (post-stroke deficits, cognition, seizure, spasticity)
  - `*כאב` (pain control, opiates, paracetamol scheduled)
  - `*שתן` (retention, catheter, UTI, catheter trial)
  - `*מטבולית` (electrolytes, glucose, nutrition labs)
  - `*פצע` (wound, VAC, dressing, healing)
  - `*עצירות` (constipation, BM tracking, laxative regimen)
  - `*שינה` (sleep, delirium, agitation, melatonin)
  - `*תזונתי` (intake, weight trend, supplements, dietitian)
  - `*פסיכולוגית` (mood, motivation, family dynamics)
- `P לביצוע` on a subsequent round is a **delta, not a reprint** — yesterday's `לביצוע` is already in the chart (in AZMA's SOAP entry the P field persists verbatim across sessions, so a full reprint double-enters it). Lead with what changed since the last round — מה נוסף, מה הופסק או שונה — with explicit timing (`היום` / `לפני המנה הבאה מחר בבוקר` / `יומיומית` / `בערב`). Collapse unchanged continuations into one line (`ממשיך טיפול כפי שתואם`); do not re-enumerate them item by item. Carve-out: a genuinely active/complex problem still gets its own specific action line — the delta framing governs only the standing, unchanged actions.
- Labs go in their **own `מעבדה:` section after O** (date-stamped) — **never in `O`**. `O` holds the bedside exam + ECG/imaging findings (`ממצאי עזר`). A **decision-driving** lab may *also* be cited inline in the relevant `A` bullet as reasoning (`*כלייתי - החמרה קלה, קראטינין 1.3`) — that citation is interpretation, not the data section. Today's labs as a group live in `מעבדה`; routine normals not driving a decision can be summarized in one line or omitted.

### תוכנית טיפול (יעדי טיפול) — goal by indication, not template inertia

This field is the institutional rehab discharge-planning text. It has TWO logical components:

1. **Case header** — short narrative summarizing primary rehab indication. Carries forward.
2. **Functional target** — the actual SMART goal. Set on day 1 if indication permits; updated post team-meeting.

**Anti-pattern observed across SZMC rehab notes (don't copy):** the same frozen string ("שיקום לאחר CVA פרונטוטמפורלי מימין. מוקדם מדי לקבוע מטרה") gets pasted into every round from day 0 through day 18+, even after the team has clearly moved past the "too early to set a goal" phase. This is template inertia, not a goal.

**Goal by indication — concrete from day 1 except for CVA:**

| Indication | Day-1 goal | Notes |
|---|---|---|
| Post-hip / knee replacement | `בן/בת X לאחר [procedure]. מטרה לעצמאות בניידות ובשרותים.` | Often add: `חזרה הביתה עם הליכון` |
| Post-spine surgery (decompression / fusion) | `בן/בת X לאחר [procedure]. מטרה לעצמאות במעברים והליכה עם עזרים.` | Specify weight-bearing restrictions |
| Pre-cardiac surgery (CABG / valve) | `בן/בת X לקראת ניתוח [procedure] בעוד [N] שבועות. מטרה לחיזוק תפקודי טרום-ניתוחי.` | Date the planned procedure |
| Post-acute deconditioning (post-pneumonia, post-sepsis) | `בן/בת X לאחר אשפוז ב[ward] עם [event]. מטרה לחזרה לתפקוד בסיסי לפני האשפוז.` | Anchor to pre-admission ADL |
| Post-fracture without surgery | `בן/בת X לאחר [fracture site]. מטרה לעצמאות בניידות בהתאם להוראות אורתופדיה.` | Include weight-bearing status |
| Post-CVA | `שיקום לאחר CVA [territory]. מוקדם מדי לקבוע מטרה.` | **Legitimately deferred** for first 3-5 days. Update after team meeting (~day 5-7) with destination + functional milestones + timeline. |

**Day-7 goal update template (post team meeting, all indications):**

```
[case header]. יעד: שחרור [destination] עד תאריך [DD/MM].
אבני דרך: [milestone 1], [milestone 2], [milestone 3].
```

Example:
```
בן 77 לאחר ORIF של שבר בירך שמאל. יעד: שחרור הביתה עם תמיכה משפחתית עד תאריך 25/05.
אבני דרך: עצמאי במעבר מיטה→כסא, הליכה 30 מטר עם הליכון, עצמאי בשרותים.
```

**The rule:** if a patient is on day 7+ and the goal still says "מוקדם מדי לקבוע מטרה" with no team-meeting update, that's a chart-quality problem worth fixing in the geriatric analysis (chat-only) — even if the institutional culture tolerates it.

### Rehab admission cadence and team workflow

- **Day 0:** rehab admission note (this skill, rehab-admission mode) + on-arrival exam
- **Day 0–1:** PT, OT, dietitian, SLT (if relevant) write their **intake** notes (richer than follow-ups; carry pre-admission baseline + scoring instruments). Doctor does NOT recreate this content — references it.
- **Day 1–4:** baseline assessment phase. תוכנית טיפול goal stays as `מוקדם מדי לקבוע מטרה`.
- **Day 5–7 (typical):** ישיבת צוות (team meeting) — multidisciplinary; sets discharge plan + goals. Round note that day or the next should reflect updated target.
- **Daily M–F:** doctor writes ביקור רופא (this skill, rehab-rounds mode). Format = Pattern A or B based on complexity.
- **Discharge:** rehab-specific סיכום אשפוז — see **"Rehab discharge (סיכום אשפוז שיקומי)"** below. Its מהלך ודיון uses a `#`-prefixed problem list (parity with the admission), placed after the מצב תפקודי template; the blocks unique to the discharge are kept too — functional-baseline + the מצב תפקודי template + the `*` בעיות אחרות incidental list + לסיכום.

### Rehab discharge (סיכום אשפוז שיקומי) — **per the index case 08/06/26 print**

The rehab discharge uses the **same printed-section skeleton** as the general discharge (אבחנות פעילות → ניתוחים באשפוז → ברקע → הצגה → תלונה → מחלה נוכחית → רקע → רגישויות → הרגלים → בדיקה בקבלה → תרופות בבית → בדיקות עזר → מעבדה → **מהלך ודיון** → המלצות בשחרור → המשך תרופתי → auto → חתימה). **The divergence is entirely inside מהלך ודיון, plus a few framing rules.** Don't reinvent the skeleton — apply the deltas.

**Delta 1 — אבחנות פעילות leads with the rehab frame, not the acute medical reason.**
The acute diagnosis is already closed (it lives in the source-dept discharge). Active dx here is:
```
ADMISSION FOR REHABILITATION
DECONDITIONING
[+ any still-active carrier/isolation status, e.g. CARBAPENEM RESISTANT KLEBSIELLA PNEUMONIAE (CRKP) CARRIER, NON CPE]
```
Isolation/carrier status that is still in effect at discharge **must** appear as an active dx and be repeated in the body (with the until-date) — it governs the next facility/home arrangement. (the index case: CRKP non-CPE, last positive 27/04, isolation until 10/2026 = 6 months.)

**Delta 2 — מחלה נוכחית is the inherited acute story, audited.**
The rehab admission appended the source-dept course; at discharge you output the cleaned full narrative for paste-over (same APPEND-field rule as general discharge). The *rehab* story does NOT go here — it goes in מהלך ודיון.

**Delta 3 — מהלך ודיון structure (this is the whole point). USES `#`-prefixed problem headers (parity with the admission דיון), placed after the מצב תפקודי template — which is kept verbatim, not replaced.** Order:

1. **Rehab capsule opener** — one line: `כעת התקבל לשיקום לאחר אשפוז ממושך` + a **2–3 sentence recap** of the acute course (cholangitis → PTC → VATS → ventilation → weaned/decannulated). This is a *recap*, not a re-do of מחלה נוכחית.
2. **Functional baseline paragraph** (`ברקע התפקודי -`): pre-admission BADL grade + who supervises + indoor/outdoor mobility + aid + caregiver hours (`X ש"ש של מט"ב`) + IADL (banking / meds / phone / who does shopping & house) + how transported outside. Close with `בשל ירידה תפקודית, התקבל במחלקת שיקום גריאטרי.`
3. **The מצב תפקודי template** (verbatim skeleton — fill the blanks, keep the SZMC quote marks):
```
מצב תפקודי: במבחן "מיני מנטל סטטוס" המטופל קיבל __ מתוך __ נקודות צפויות, ובמבחן "ציור שעון" קיבל __ מתוך 10 נקודות צפויות.
בניידות בתוך מיטה [עצמאי/השגחה/עזרה]
במעבר משכיבה לישיבה [grade]
במעבר מישיבה לשכיבה [grade]
במעבר מישיבה לעמידה [grade]
שיווי משקל דינמי בעמידה [תקין/לקוי]
הליכה עם [aid] [grade + distance/סיבולת]
מדרגות עם [grade]   ← optional line; drop if not assessed
באכילה [grade]
ברחצה [grade]
בלבוש [grade]
בשירותים [grade + sphincter note, e.g. "עזרה קלה עם שליטה חלקית על הסוגרים"]
FUNCTIONAL INDEPENDENCE MEASURE מוטורי בבית (לפני האשפוז) __/91, בקבלתו לשיקום __/91, ובשחרור __/91.
FUNCTIONAL INDEPENDENCE MEASURE קוגניטיבי __/35.
```
   - **Grade words = the FIM score rendered as Hebrew (Eias 08/06/26) — do NOT free-hand them.** Conversion:

     | FIM | grade | | FIM | grade |
     |---|---|---|---|---|
     | 7/7 | עצמאי | | 3/7 | עזרה בינונית |
     | 6/7 | השגחה | | 2/7 | עזרה בינונית למלאה |
     | 5/7 | עזרה קלה | | 1/7 | עזרה מלאה |
     | 4/7 | עזרה קלה לבינונית | | | |

     Balance line uses `תקין / לקוי`; gait line appends the aid + distance or `סיבולת נמוכה`.
   - **Which lines come from FIM vs PT:**
     - **FIM-backed** (convert the *discharge-column* score via the table): `באכילה`←אכילה, `ברחצה`←רחצה, `בלבוש`←לבוש עליון+תחתון, `בשירותים`←שירותים, `שליטה`←שליטה שלפוחית+מעי, `מדרגות עם`←עליה וירידה במדרגות, `הליכה עם`←ניידות-הליכה/כ"ג (then append aid + distance/סיבולת from the PT note).
     - **NOT FIM items — pull from the PT discharge note** (same vocabulary): `בניידות בתוך מיטה`, `במעבר משכיבה לישיבה`, `במעבר מישיבה לשכיבה`, `במעבר מישיבה לעמידה`, `שיווי משקל דינמי בעמידה`.
   - **Gendered M/F templates both exist — match the patient.** Male: `המטופל קיבל ... בקבלתו ... עצמאי`. Female: `המטופלת קיבלה ... בקבלתה ... עצמאית`. The capsule, transfer lines, and all prose inflect too. (the deconditioning exemplar = male template; the femur exemplar = female.)
   - The two FIM lines are the **outcome headline**: motor `home / admission / discharge`. The admission value is usually *below* home (deconditioning during the acute stay); the discharge value climbing back toward/above home is the rehab "win." (the index case: 61 → 35 → 63 = recovered to baseline.) Cognitive FIM is a single `/35`.
   - These numbers come from the Chameleon **אומדנים** assessment grids (FIM/BADL, MMSE, Clock-CDT, MoCA), entered as dropdowns and auto-totaled. The prose block is the doctor's distillation of those totals — **MMSE or MoCA, whichever was administered** (one patient gets MMSE 25/30, another MoCA 20/30 — don't write both).
4. **`#`-prefixed problem list** — in parity with the admission דיון: `כעת מציג/ה את הבעיות הבאות לדיון:` then one `#` per active rehab problem, each expanded with the clinical reasoning (the rehab course, what changed, the decision). This is the discussion proper, and it comes *after* the מצב תפקודי block above.
5. **בעיות אחרות:** — `*`-bullet list of incidental issues *during the rehab stay* (single `*` per incidental item — the `#`-prefixed headers are the problem-list discussion in step 4, these bullets stay `*`, not `**`). Each ties an event to its action, drug changes inline:
```
בעיות אחרות:
*ירידה של ל"ד לאחר מאמץ - הופחת מינון של חוסמי ביתא ושל ACE INHIBITOR. חל שיפור במהלך השיקום
*STITCH ABCESS סביב ה-PTC, תפר משי הוחלף בתפר ניילון על ידי כירורגי
*פצע לחץ דרגה 1 בעכוז - טיפול בעזרת דיאטה, שינוי תנוחה
*קושי באיזון סוכר - משתחרר על LANTUS 10 יחידות
```
6. **לסיכום,** — closing: `התאשפז במחלקת שיקום גריאטרי בשל ירידה תפקודית לאחר אשפוז ... במהלך השיקום חל שיפור ... [discharge reason]`. State the reason for the discharge timing honestly, and if it was a **shared decision** say so (`הוחלט יחד עם המטופל על שחרור לביתו`). Early/situational discharges (family, logistics, war footing) are named plainly, not hidden.

**Delta 4 — המלצות בשחרור are short and rehab-specific** (dash on input, EMR renders numbered):
```
- זקוק/ה לפיזיותרפיה במסגרת הבית (יט"ב)
- ביקור בית של ריפוי בעיסוק לצורך הערכה בסביבה הביתית וקביעת מטרות בהתאם לצורך
```

**Delta 5 — המשך טיפול תרופתי carries `(למשך N חודשים)` durations**, and **reflects the rehab titrations** (the dose changes you wrote as `*` bullets must match the drug list): BB reduced, ACE-i reduced, Lantus down, steroids tapered, anticoag switched back from in-hospital enoxaparin to home apixaban, etc. Reconcile the בעיות אחרות bullets against this list before finalizing — a dose-reduction claimed in prose but not reflected in the drug list is a defect.

**Delta 6 — signature is the senior / case manager, not the fellow.** This print was signed `ד"ר the rehab case manager, מ.ר ***REDACTED-LICENSE***` (rehab case manager), with the PT block signed separately by the physiotherapist. **Do NOT auto-stamp Eias's 000147224 on a rehab discharge** the way the general-discharge template does — leave the signing physician per case (confirm who finalizes). The auto-appended PT block (`מצב תפקודי לפי הערכת הפיזיותרפיה`) is the PT's, signed by her.

**Two-patient upload caveat (process, not format):** a teaching/EMR bundle may mix patients (the 08/06 set had the index case ***REDACTED-ID*** *and* the femur exemplar ***REDACTED-ID***). Map every screenshot to its patient by the header ID/DOB **before** pulling any number into a note — FIM/MMSE/motor grids look identical across patients. (Memory: ".eml may span multiple patients — map by header first.")

**Delta 7 — condensation defaults (Eias 08/06/26, "condense relevant sections").** The rehab discharge runs long because the acute story gets told twice. Default to terse:
- **מחלה נוכחית: 2 short paragraphs max** — para 1 = baseline + fall/mechanism + diagnoses; para 2 = surgery (date, implant, uneventful, no transfusion) + the imaging finding that changed management + transfer-to-rehab reason. Don't narrate every consult and X-ray.
- **The מהלך ודיון capsule must NOT re-tell מחלה נוכחית.** One to two sentences: `כעת התקבלה לשיקום לאחר [procedure] ב[date], על רקע [the one comorbid issue that matters in rehab].` Then go straight to the functional-baseline paragraph. Redundancy between מחלה נוכחית and the capsule is the #1 source of bloat.
- **בדיקות עזר (imaging): keep only what changes management.** For a spine CT in an ortho-rehab patient: the fractured levels + worse/new + the conservative-management decision + any incidental finding needing follow-up. **Drop the level-by-level degenerative disc readout** (D11-D12 bulge, L3-L4 / L4-L5 stenosis, etc.) — irrelevant to a rehab discharge. One summary line `שינויים ניווניים רב מפלסיים עם היצרויות ספינליות ופורמינליות` covers it.
- **בדיקות מעבדה: essentials only.** Biochem (Na trend, Ca, Cr, Vit D) + CBC (Hb trend, WBC trend). **Drop normal coags/INR** unless anticoagulation-relevant. Max 3 values/line, raw numbers, no interpretation.

**Ortho-rehab specifics (the femur exemplar femur case, 08/06/26 — the cleaner ortho exemplar vs the deconditioning exemplar's deconditioning case):**
- **Active dx** = `ADMISSION FOR REHABILITATION` + `STATUS POST [procedure] - [fracture] (date)` + any other fractures. **NOT `DECONDITIONING`** — that's for the long-ICU/medical-decline case (the deconditioning exemplar), not a clean post-op ortho.
- **ניתוחים באשפוז = procedures during the REHAB stay only** (usually none). The index surgery (CRIF/ORIF/hemi) belongs in מחלה נוכחית and the operative-dx line — not in ניתוחים באשפוז, which would wrongly imply it happened this admission.
- **בעיות אחרות for ortho-rehab** typically: vertebral/other fractures on conservative management; **DVT prophylaxis with its stop date** (LMWH ~1 month post-op — e.g. ENOXAPARIN/CRUSIA); post-op anemia trend (no transfusion); low Vit D; incidental imaging findings needing community follow-up.
- **Geri-analysis pearls for the chat (not the note):**
  - **Osteoporosis is treatment-defining after a fragility fracture — push it, don't boilerplate it.** A hip fracture (± vertebral fractures) defines osteoporosis without DXA; a *new* vertebral fracture during the admission = very high imminent refracture risk. The discharge rec should drive actual treatment (replete Vit D → check Ca/renal → anti-resorptive/anabolic via ortho/endo/GP), not just "bone-health follow-up in the community." Vit D + Ca alone is repletion, not treatment.
  - **Opioid taper.** Ortho discharges on standing oxycodone (Targin/Percocet) + PRN. A pain-free, mobilizing rehab patient (refusing doses, VAS 0) should leave on paracetamol + a PRN, standing opioids dropped — falls/constipation/delirium in the elderly. Confirm with the team.
  - **CCB / home-med reconciliation.** The rehab order set can diverge from the acute discharge (e.g. home/ortho Amlodipine vs a rehab Lercanidipine order). Reconcile the discharge drug list against *current rehab orders*, not the acute discharge, and don't double-list a class.
  - **Dual antihypertensive + presyncope/fall** → check orthostatics before discharge; if BPs run low, trim the CCB.

### Complex-medical rehab discharge checklist — **the ESRD/HD case ESRD case, 08/06/26**

For a rehab patient with serious chronic disease (dialysis, advanced CKD, brittle DM, immunosuppression, G6PD), the medical layer is where the value and the traps are. Run this before signing — each line is a real miss caught on the the ESRD/HD case case:

- **Dialysis status is the first question, before anything else.** If ESRD/HD: name the **unit + schedule + access** in the note; at discharge coordinate the **next session + transport**; **protect the fistula arm** (no BP, no draws — put it in the exam *and* the recs); EPO/IV iron are given **via the dialysis unit**, not the GP. Don't write the discharge until you know.
- **Renal drug dosing — reconcile against renal-adjusted doses, not the home doses.** Re-dose renally-cleared drugs (**Levetiracetam** — the ESRD/HD case's home 1000 BID → 500 BID; gabapentinoids; LMWH; many antibiotics); **avoid metformin**; ACE/ARB caution with hyperkalemia (the ESRD/HD case's home ACE was correctly dropped, K ran to 5.9). Flag any renally-cleared drug still at its non-renal dose.
- **CKD-MBD ≠ osteoporosis.** With eGFR<30 / dialysis, an "OSTEOPOROSIS" label is really CKD-MBD: check **PTH / Ca / Phos / 25-OH-D** (the ESRD/HD case PTH 126, VitD 16.2); treat with **active vit D (alfacalcidol) + phosphate binder (lanthanum/sevelamer) + calcium**; **NO bisphosphonate** without workup + nephro/endo; **denosumab risks hypocalcemia** — replete Ca first.
- **HbA1c is unreliable in CKD / anemia / EPO / recent transfusion — it reads falsely low.** the ESRD/HD case's A1c was 5.3% while glucose ran 115–273. Titrate insulin to the **glucometer**, and say so in the recs.
- **G6PD** — check the allergy/alert field (logged as "PD6G"/G6PD). If deficient: flag a **card** and avoid triggers (sulfonamides, nitrofurantoin, dapsone, primaquine, rasburicase, methylene blue, high-dose aspirin).
- **Immunosuppressants in renal failure** — **MTX** (renally cleared, hazardous in ESRD; the ESRD/HD case on monthly MTX for PMR) and similar: state **held vs resumed** + who follows. Don't leave it ambiguous.
- **Rising inflammatory markers + pending cultures** — don't sign off a climbing CRP/WBC without the culture result / a named source.
- **Signature = senior / case manager** (the ESRD/HD case's interim signed by the rehab case manager), not the fellow — same as the other rehab discharges.

### Allied health intake → doctor's note (read-only)

The **PT, OT, dietitian, and SLT intake notes** are the source of truth for:

| Data | Lives in |
|---|---|
| Pre-admission ADL/IADL baseline | OT intake (`ייעוץ ריפוי בעיסוק`) |
| Cognitive screen (MOCA, MMSE) | OT intake or psych intake |
| Caloric/protein targets | Dietitian intake (`ייעוץ תזונה`) |
| Functional grade per limb (e.g., 4/5 IP left, 5/5 right) | PT intake (`ייעוץ פיזיותרפיה`) |
| Swallowing assessment / IDDSI level | SLT intake (`ייעוץ שמיעה ודיבור`) |
| Pre-admission falls history | OT intake |
| Family/caregiver context | OT or psych intake |

**Doctor's notes reference but do not recreate.** If a one-line functional summary is needed in the rehab admission's `# תפקוד` or in the daily round's `A` section, paraphrase or pull a single key number — don't restate the full intake.

### Rehab notes — what NOT to write

- ❌ Do NOT take a fresh history in the rehab admission. The source department already did.
- ❌ Do NOT recreate PT/OT/dietitian intake content in the doctor's narrative.
- ❌ Do NOT drop the `#`-prefixed problem list from a rehab note. **Both** the admission דיון and the discharge מהלך ודיון carry a `#`-prefixed problem list (expand each `#` with reasoning). In the discharge the `#` list sits **after** the מצב תפקודי template, and the blocks unique to the discharge are kept alongside it — functional-baseline paragraph + the מצב תפקודי template + the `*` בעיות אחרות incidental list — not in place of the `#` list.
- ❌ Do NOT auto-add Beers/STOPP/START blocks to daily rounds. Med deprescribing decisions go inline in `*` bullets when actually changing a med, not as a standalone section.
- ❌ Do NOT update the תוכנית טיפול goal silently — if the team meeting hasn't happened yet, leave it as `מוקדם מדי לקבוע מטרה`.

### Rehab clinical pearls — high-impact gotchas

These are clinical decisions that come up repeatedly on geri-rehab and where the institutional default is wrong or risky. Catch them on day 1 — that's when corrections are cheap.

**1. Audit the source department's clinical claims before propagating.**

The acute team's discharge dictation will contain medication interpretations, lab interpretations, and recommendations that you'll be tempted to copy into your rehab admission's מחלה נוכחית. Don't propagate without reading. Two real failure modes seen:

- *Vitamin D 20 ng/ml labeled as "maintenance therapy"* (PATIENT 13/04) — D 20 is **insufficiency** (sufficiency starts ~30 ng/ml), not maintenance. Calling it maintenance and proceeding to bisphosphonate creates a pharmacological hazard.
- *"Continue Aclasta in discharge" in an ESKD patient* (PATIENT 03/05) — bisphosphonates in HD are not a default; need CKD-MBD workup and nephro+endo consultation first.

**2. CKD-MBD vs osteoporosis — bisphosphonate trap in ESKD/HD patients.**

A low-trauma fracture in an ESKD/HD patient is **not** classic osteoporosis. It's a mixed picture of renal osteodystrophy + secondary hyperparathyroidism + Vit D / Ca / P derangement. KDIGO guidelines treat CKD-MBD distinctly from osteoporosis. Bisphosphonate (especially zoledronate) in HD risks symptomatic hypocalcemia post-infusion, atypical femur fractures, and accumulation. The right sequence on day 1:

1. Order full CKD-MBD workup: 25(OH)D, PTH, Ca (corrected), P, ALP, albumin
2. Replete Vit D first if <30 ng/ml — loading dose then maintenance
3. Verify Ca, P, PTH targets per KDIGO before any bisphosphonate
4. **Consult nephrology AND endocrinology** before initiating
5. Document the workup plan in P, do not write "Aclasta in discharge" on day 1

If the source team recommended bisphosphonate, push back as a question in your A bullet (`*עצמות - מהלך מורכב יותר ב-ESKD מקלאסי OP, נשלים CKD-MBD לפני`) rather than direct contradiction.

**3. Demographics cross-check on day 1 capsule.**

Marital status, parent count, living situation get propagated from your day-1 capsule into every subsequent note for the next month. The PATIENT 13/04 note had `אלמנה ואם ל-2` while admission said `רווקה / אם ל-5` — chart corruption that propagated. Cross-check the admission הצגת החולה verbatim before writing the capsule. If the admission field is blank or ambiguous, write it as you confirmed at bedside, not as you assumed.

**4. Dizziness or pre-syncope during PT is a clinical event, not an anecdote.**

When a PT note describes a "near-fall" or "dizziness" or "needed extra support to stabilize" during ambulation, that's a clinical event that goes in `A` as its own bullet, not buried in `*תפקודית`. In a geri-rehab patient on multiple antihypertensives + neuropathic agents + insulin, the differential is: orthostatic hypotension (HD-related, drug-related), arrhythmia, hypoglycemia, anemia, vasovagal. Workup before more aggressive PT:

- Orthostatic vitals (lying → standing, 1 min and 3 min)
- ECG with rhythm strip; consider 24h telemetry if frequent APBs/PVCs
- Glucose monitoring
- Hb if not recent
- Medication review for orthostatic offenders (alpha-blockers, ACE-i, diuretics, gabapentinoids)

**5. Pre-admission falls + in-rehab near-falls → connect them.**

Geri-rehab admissions for fracture often have a fall as the precipitating event. If the PRE-admission fall and an IN-rehab near-fall both happen, treat them as a syndrome to investigate, not two unrelated events. The PATIENT case: scooter fall on 22/04 with weakness, near-fall in PT on 03/05 — both should be in the same bullet with the same workup.

**6. Iatrogenically deprescribed antidepressants in HD patients.**

A common pattern: SSRIs stopped on admission for renal disease, never restarted. The patient is now starting a month of rehab where motivation and participation determine outcome. Day 1 is the right time to re-raise. Sertraline at low dose or mirtazapine at night are both reasonable in HD. Don't wait until day 14 when the patient isn't engaging with PT.

**7. Pre-syncope during PT requires PT communication, not just chart documentation.**

If you write `*אירוע פרה-סינקופלי` and order workup, also tell the PT in person to scale back intensity until cleared. The chart bullet doesn't reach them in real time.

**8. Aspirin without documented CAD indication in a fall-risk patient.**

Common finding on admission med review: aspirin 100mg with no CAD/CVA documented in chart, in a patient with Hb<10, recent fracture, fall history, ± fistula. Don't hold day 1 unless bleeding, but flag for review and document the absent indication. Same logic as STOPP-START but framed as a question, not a directive.

**9. Polypharmacy flag on day 1 — but as questions, not directives.**

The admission med list often has 10+ meds with unclear current indication. Day-1 review is the right time, but frame as `*תרופות - לבדוק אינדיקציה ל-ASPIRIN, רוויה ל-PREGABALIN לכאב ניורופתי, רלוונטיות של AMLODIPINE לאחר שינויי ל"ד מאז הניתוח` — not "stop X." The treating team has context the chart doesn't show.

**10. Discharge planning starts day 1, not week 4.**

For any patient living alone in a high-floor apartment (PATIENT: floor 5; PATIENT: floor 1 no elevator), day-1 social work referral is appropriate. Discharge to "home alone" for a fresh post-op patient with falls history is rarely viable; surfacing the constraint on day 1 lets the family/social work plan in parallel with the rehab clinical course.
