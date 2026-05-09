# Morning rounds prep — design

**Status:** approved 2026-05-09 via brainstorming session. Builds on `docs/NEXT_SESSION_BRIEF-morning-rounds-prep.md` (PR #103, 2026-05-07). Spec corrects the brief's data-model assumptions after verifying actual ward-helper schema.

**Author:** Eias + Claude (terminal session 2026-05-09)

**Target versions:** v1.40.0 (schema) → v1.40.1 (engine) → v1.40.2 (UI). Cloud sync deferred to v1.41+.

## Intent (verbatim)

> when I enter for example a daily follow up that the template stays there and then the next day you know there's a placeholder template for the patients unless like we decide it's discharge time and stuff … basically prepare the world do what department prepare the department for the morning for the morning rounds the next day and the day afterwards and so on

## Prior art (read before implementing)

- `docs/NEXT_SESSION_BRIEF-morning-rounds-prep.md` — original brief; data-model assumptions superseded by this spec, three-PR scoping retained.
- Toranot `~/repos/Toranot/src/engine/shiftContinuity.ts` (116 LOC, pure function) — port reference for `dayContinuity.ts`. Match strategy: room + first-4-chars-of-name prefix, BIDI-tolerant, OCR variation tolerance.
- Toranot `~/repos/Toranot/src/types/patient.ts:131-149` — field-shape reference for `tomorrowNotes`, `handoverNote`, `discharged`, `clinicalMeta`.
- ward-helper `src/notes/continuity.ts` — existing `resolveContinuity(teudatZehut)` returns `{ admission, priorSoaps, mostRecentSoap, episodeStart }` with `EPISODE_WINDOW_MS = 30d` staleness gate. **Reused by the new orchestrator; not replaced.**
- ward-helper `src/storage/indexed.ts:189` — existing `getPatientByTz()` primitive (per memory `project_ward_helper_morning_rounds_prep.md`).

## Decisions log

| # | Question | Decision |
|---|---|---|
| Q1 | Auto vs manual archive | **Prompt-but-don't-auto** on first `/today` view of a new calendar day; banner with [ארכב] [דחה] |
| Q2 (policy) | What carries to tomorrow's draft | Carry: PMH/meds/allergies/handoverNote/clinicalMeta/goalsOfCare/`planLongTerm`. **Clear:** subjective entirely (not "subjective baseline" verbatim), vitals, labs, `planToday`, chief complaint |
| Q2 (location) | Where the plan-split lives | **Option A — `planLongTerm` + `planToday` as durable fields on `Patient`.** Edited in `<PatientCard>`, never embedded into `Note.bodyHebrew` (single source of truth) |
| Q3 | Cloud push for `daySnapshots` | **Local-only for v1.40.x.** Originally chose opt-in toggle; deferred to v1.41+ per advisor scope-trim |
| Q4 | Re-admit handling | **Same record, un-discharge.** Keyed by TZ (existing `getPatientByTz`). Skip pre-discharge SOAP prefill if `dischargedAt` gap > 24h (`DISCHARGE_STALE_GAP_MS`) |
| Q5a | `tomorrowNotes` lifecycle | **Auto-clear on surface + "הפוך להערה קבועה" promote button** that copies the line into `handoverNote` |
| Q5b | Double-archive policy | **Confirm-but-allow-replace.** Snapshot keyed by date string; second `put` upserts |
| Q5c | Migration for pre-v1.40 patients | **Eager backfill via post-open one-shot** (`runV1_40_0_BackfillIfNeeded`), gated by `localStorage.ward-helper.v1_40_0_backfilled`. NOT in IDB `upgrade()` callback (transaction lifetime hazard) |
| Aux 1 | New admissions | `buildDayContinuity` returns empty `PreviousDayContext`; no special branch |
| Aux 2 | Discharged in snapshot | Included in `daySnapshots[].patients[]`. `/today` filters them out of active roster but they remain in historical snapshot |
| Aux 3 | Banner re-fire policy | Once per browser session per calendar date; `sessionStorage.bannerDismissed_${date} = '1'` on dismiss |
| Aux 4 | Mistaken archive recovery | No dedicated undo. Doctor uses double-archive replace within the same day |

## Architecture overview

Toranot's `engine/shiftContinuity.ts` ports to ward-helper as `engine/dayContinuity.ts` (pure function, BIDI-tolerant). New orchestrator `notes/seedFromYesterdaySoap.ts` composes `dayContinuity` (roster-level) with existing `notes/continuity.ts` (per-patient note lookup). Patient state gains durable rounds-prep fields. UI is additive — new components overlay the existing `/today` view.

**State management:** ward-helper uses **direct async storage helpers + a glanceable-events bus** (`src/ui/hooks/glanceableEvents.ts`). No reducers, no Zustand, no Context. Storage helpers mutate IDB and emit events; observed components react.

### PR sequence

| PR | Version | Scope | Risk |
|---|---|---|---|
| 1 | v1.40.0 | IDB v5→v6 (new `daySnapshots` store), Patient field additions, `runV1_40_0_BackfillIfNeeded` post-open one-shot, storage helpers (`archiveDay`/`dischargePatient`/`unDischargePatient`/`addTomorrowNote`/`dismissTomorrowNote`/`promoteToHandover`), `notifyDayArchived` event. **No UI.** | Highest — schema change; ship + sleep |
| 2 | v1.40.1 | `engine/dayContinuity.ts` pure function, `notes/seedFromYesterdaySoap.ts` orchestrator, `DISCHARGE_STALE_GAP_MS = 24h`, comprehensive vitest. **No UI.** | Lowest — pure functions |
| 3 | v1.40.2 | All UI: `MorningArchivePrompt` + `DoubleArchiveConfirm`, draft-seed wiring in `NoteEditor`, `DischargeButton`, `ReadmitBanner`, `PatientPlanFields` textareas in `PatientCard`, `TomorrowBanner` + promote button, `TomorrowNotesInput`. SOAP emit prompt update | Medium |

Branch convention: `claude/term-rounds-prep-pr<n>-<slug>`. Per workspace `CLAUDE.md`, never push to `main` directly. PR + squash merge, CI green, `verify-deploy.sh` pass before claiming "shipped".

## Data model

### Patient delta (PR 1)

```ts
// src/storage/indexed.ts
export interface Patient {
  // existing fields unchanged
  id: string;
  name: string;
  teudatZehut: string;
  dob: string;
  room: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  // v1.40.0 additions (all optional; backfill defaults non-null)
  discharged?: boolean;            // default false
  dischargedAt?: number;           // ms timestamp; undefined when not discharged
  tomorrowNotes?: string[];        // default []
  handoverNote?: string;           // default ''
  planLongTerm?: string;           // default ''
  planToday?: string;              // default ''; cleared on archive
  clinicalMeta?: Record<string, string>;  // default {}; YAGNI bag, not formalized sub-shape
}
```

`clinicalMeta` is intentionally typed as `Record<string, string>`, not a structured interface, per ward-helper's "minimum code, nothing speculative" rule. PR 3 surfaces only the keys it uses; future PRs formalize as needed.

### `daySnapshots` IDB store (PR 1)

```ts
export interface DaySnapshot {
  id: string;          // YYYY-MM-DD; primary key (Q5b: replace on double-archive)
  date: string;        // same value as id
  archivedAt: number;  // ms timestamp
  patients: Patient[]; // frozen copy (discharged ones included)
}
```

Bounded to last 20 entries. On `put`, count store size; if > 20, delete oldest by `archivedAt` ascending.

### IDB version bump

```ts
const DB_VERSION = 6;  // up from 5

upgrade(db, oldVersion, _newVersion, tx) {
  // existing v1-v5 blocks unchanged
  if (oldVersion < 6) {
    // STORE-ONLY work in upgrade callback (synchronous, safe)
    if (!db.objectStoreNames.contains('daySnapshots')) {
      db.createObjectStore('daySnapshots', { keyPath: 'id' });
    }
    // NO data backfill here — the data backfill runs post-open via
    // runV1_40_0_BackfillIfNeeded(). Doing async cursor work in upgrade()
    // risks dropping the versionchange transaction (idb v8 / IDB spec).
  }
}
```

### Post-open backfill (PR 1)

```ts
// src/storage/rounds.ts (new)
const BACKFILL_KEY = 'ward-helper.v1_40_0_backfilled';

export async function runV1_40_0_BackfillIfNeeded(): Promise<void> {
  if (localStorage.getItem(BACKFILL_KEY) === '1') return;
  try {
    const db = await getDb();
    const tx = db.transaction('patients', 'readwrite');
    const store = tx.objectStore('patients');
    let cursor = await store.openCursor();
    while (cursor) {
      const p = cursor.value as Patient;
      await cursor.update({
        ...p,
        discharged: p.discharged ?? false,
        tomorrowNotes: p.tomorrowNotes ?? [],
        handoverNote: p.handoverNote ?? '',
        planLongTerm: p.planLongTerm ?? '',
        planToday: p.planToday ?? '',
        clinicalMeta: p.clinicalMeta ?? {},
      });
      cursor = await cursor.continue();
    }
    await tx.done;
    localStorage.setItem(BACKFILL_KEY, '1');
  } catch (err) {
    // Don't set marker on failure — retries next boot.
    // Reads tolerate missing fields via ?? defaults.
    console.warn('[rounds] v1.40.0 backfill failed; will retry next boot', err);
  }
}
```

Called once during app boot in `main.tsx` immediately after the auth-success effect that loads `useSettings`. Idempotent via the localStorage marker, so a second invocation (e.g. during HMR) is a cheap no-op.

### Storage helpers (PR 1)

| Function | Effect | Event |
|---|---|---|
| `archiveDay(): Promise<DaySnapshot>` | `put` snapshot to `daySnapshots`, clear `planToday=''` for all roster patients, cap to 20 entries, set `localStorage.ward-helper.lastArchivedDate = today` | emits `notifyDayArchived` (new), `notifyPatientsChanged` |
| `dischargePatient(patientId): Promise<void>` | Set `discharged=true`, `dischargedAt=Date.now()` | emits `notifyPatientsChanged` |
| `unDischargePatient(patientId, gapDays, reason): Promise<void>` | Set `discharged=false`, clear `dischargedAt`, append handoverNote line `"חזר לאשפוז ב-${date} לאחר ${gapDays} ימים: ${reason}"` | emits `notifyPatientsChanged` |
| `addTomorrowNote(patientId, text): Promise<void>` | Push to `tomorrowNotes[]` | emits `notifyPatientsChanged` |
| `dismissTomorrowNote(patientId, lineIdx): Promise<void>` | Splice the indexed line from `tomorrowNotes` | emits `notifyPatientsChanged` |
| `promoteToHandover(patientId, lineIdx): Promise<void>` | Append the indexed line to `handoverNote`, splice it from `tomorrowNotes` | emits `notifyPatientsChanged` |

## Continuity engine (PR 2)

### Files

```
src/engine/dayContinuity.ts                 ← NEW
tests/engine/dayContinuity.test.ts          ← NEW (mirrors Toranot's shiftContinuity tests)
src/notes/seedFromYesterdaySoap.ts          ← NEW (orchestrator)
tests/notes/seedFromYesterdaySoap.test.ts   ← NEW
src/notes/continuity.ts                     ← UNCHANGED
src/notes/orchestrate.ts                    ← MODIFIED in PR 3 (add seedContext arg)
```

### `dayContinuity.ts` API

```ts
export interface PreviousDayContext {
  patient: Patient;            // yesterday's frozen copy
  matchType: 'exact' | 'name-fallback';
  handoverNote: string;        // filtered: only if length > 5 (Toranot rule)
  tomorrowNotes: string[];     // notes targeted at today's date
}

export const DISCHARGE_STALE_GAP_MS = 24 * 60 * 60 * 1000;
export const ROOM_NAME_PREFIX_LEN = 4;
export const HANDOVER_MIN_CHARS = 5;

export function buildDayContinuity(
  currentRoster: Patient[],
  snapshotHistory: DaySnapshot[],   // sorted descending by archivedAt
): Map<string /* patientId */, PreviousDayContext>;
```

**Match strategy** (verbatim port from Toranot, Hebrew-name-aware):

1. For each `current` in `currentRoster`, scan most-recent snapshot's `patients[]`.
2. Try exact match: `current.room === prev.room && namePrefix(current) === namePrefix(prev)` (case-insensitive, BIDI-stripped, first 4 chars).
3. Fallback if no exact: same `namePrefix` regardless of room (handles room moves).
4. Skip `prev.discharged === true` patients (Aux 2 says they're in the snapshot, but `dayContinuity` reports living roster only).
5. Filter `handoverNote` by `trim().length > HANDOVER_MIN_CHARS`.

### `seedFromYesterdaySoap.ts` orchestrator

```ts
export type SeedDecision =
  | { kind: 'no-prefill'; reason: 'no-history' | 'discharge-gap' | 'episode-stale' }
  | { kind: 'prefill';
      bodyContext: string;     // yesterday's bodyHebrew, reference only
      patientFields: {
        handoverNote: string;
        planLongTerm: string;
        clinicalMeta: Record<string, string>;
      };
    };

export async function decideSeed(patient: Patient): Promise<SeedDecision> {
  // Gate 1: discharge gap
  if (patient.discharged && patient.dischargedAt
      && Date.now() - patient.dischargedAt > DISCHARGE_STALE_GAP_MS) {
    return { kind: 'no-prefill', reason: 'discharge-gap' };
  }
  // Gate 2: existing 30-day episode window via resolveContinuity
  const ctx = await resolveContinuity(patient.teudatZehut);
  if (!ctx.mostRecentSoap) {
    return { kind: 'no-prefill',
             reason: ctx.episodeStart === null ? 'no-history' : 'episode-stale' };
  }
  return {
    kind: 'prefill',
    bodyContext: ctx.mostRecentSoap.bodyHebrew,
    patientFields: {
      handoverNote: patient.handoverNote ?? '',
      planLongTerm: patient.planLongTerm ?? '',
      clinicalMeta: patient.clinicalMeta ?? {},
    },
  };
}

export function detectReadmit(patient: Patient): { isReadmit: boolean; gapDays?: number } {
  // Read-only — does not mutate. UI dispatches unDischargePatient after this.
  if (!patient.discharged || !patient.dischargedAt) return { isReadmit: false };
  const gapMs = Date.now() - patient.dischargedAt;
  return { isReadmit: true, gapDays: Math.floor(gapMs / (24 * 60 * 60 * 1000)) };
}
```

**Staleness gate ordering (advisor concern 3):** discharge gap fires before episode window. A patient discharged 25h ago with a 5-day-old prior admission gets `'discharge-gap'`, not `'episode-stale'`.

**Re-admit ordering (advisor concern 5):** `detectReadmit` is read-only. The UI calls it, surfaces the banner, and dispatches `unDischargePatient` only after doctor confirms. This avoids mutate-then-read races.

### SOAP emit prompt update (PR 3)

`src/notes/orchestrate.ts` adds an optional `seedContext: SeedDecision` argument. When `kind: 'prefill'`, the system prompt prepends two distinct blocks:

**Block A — yesterday's reference (volatile fields only):**

```
Yesterday's SOAP for this patient is provided below as reference for clinical
continuity. When drafting today's, the Subjective, vitals, labs, and today's
chief complaint must reflect TODAY'S data — do not copy from yesterday.

Yesterday's SOAP (reference only, do NOT copy verbatim):
${seedContext.bodyContext}
```

**Block B — durable patient context (separate input):**

```
Patient durable context (use directly; do not re-derive from yesterday's prose):
- handoverNote: ${seedContext.patientFields.handoverNote}
- planLongTerm: ${seedContext.patientFields.planLongTerm}
- clinicalMeta: ${JSON.stringify(seedContext.patientFields.clinicalMeta)}
```

**Single source of truth:** `planLongTerm` is on the `Patient` record, surfaced in `<PatientCard>`, passed as structured input to the prompt. It is never copied verbatim into `Note.bodyHebrew`. The doctor edits it in one place.

## UI flow (PR 3)

### New components

| Component | File | Purpose |
|---|---|---|
| `<MorningArchivePrompt>` | `src/components/MorningArchivePrompt.tsx` | Detects `lastArchivedDate < today`, renders Hebrew banner. Once-per-session dismissal via `sessionStorage.bannerDismissed_${date}`. |
| `<DoubleArchiveConfirm>` | inline modal | Q5b: confirm before second archive same day. *"כבר ארכבת היום בשעה X. לארכב שוב? הארכוב הקודם יוחלף."* |
| `<TomorrowBanner>` | `src/components/TomorrowBanner.tsx` | Surfaces `patient.tomorrowNotes` items. Each line has [✓ דחה] (clears) and [↑ הפוך לקבועה] (promotes to handoverNote). |
| `<DischargeButton>` | inline in `<PatientCard>` | Confirm: *"לשחרר את ${name}?"* → `dischargePatient(id)`. |
| `<ReadmitBanner>` | `src/components/ReadmitBanner.tsx` | When capture detects a TZ that's `discharged: true`: *"TZ זוהה — מטופל שוחרר לפני N ימים. לחזרה לאשפוז?"* with [כן] / [לא, חולה חדש]. |
| `<TomorrowNotesInput>` | inline in `<PatientCard>` | Text input + add button → `addTomorrowNote(id, text)`. |
| `<PatientPlanFields>` | inline in `<PatientCard>` | Two textareas: `planLongTerm` and `planToday`. Edits write through to the patient record via storage helpers. |

### Banner detection (TodayView mount)

```ts
useEffect(() => {
  const today = new Date().toLocaleDateString('en-CA');  // YYYY-MM-DD, browser timezone
  const lastArchived = localStorage.getItem('ward-helper.lastArchivedDate');
  const dismissed = sessionStorage.getItem(`ward-helper.bannerDismissed_${today}`) === '1';
  if (lastArchived && lastArchived < today && !dismissed) {
    setShowMorningPrompt(true);
  }
}, []);
```

Banner re-fires on next session (Aux 3).

### Draft-seed flow (clicking "השתמש בהערת אתמול" on a patient)

```
1. Read current Patient via getPatientById
2. Call seedFromYesterdaySoap.decideSeed(patient)
3. Branch:
   a. SKIP_PREFILL → open NoteEditor with empty bodyHebrew. Show banner:
      "המטופל שוחרר לפני יותר מ-24 שעות; הסיכום מתחיל ריק. ראה תכנית
       ארוכת-טווח בכרטיס המטופל."
   b. PREFILL → call SOAP emitter with seedContext. Result lands in NoteEditor.
4. Doctor edits in NoteEditor (existing component). Saves via existing
   saveBoth() → IDB + cloud (existing pipeline).
```

`<NoteEditor>` does NOT embed `planLongTerm` into `bodyHebrew` on open. `planLongTerm` is visible separately in `<PatientPlanFields>` on `<PatientCard>`.

### Re-admit flow (capture finds existing TZ)

```
1. Capture extract returns a TZ
2. Look up via getPatientByTz(tz)
3. If patient.discharged === true:
   - Call detectReadmit(patient) → { isReadmit: true, gapDays }
   - Render <ReadmitBanner>
4. Doctor confirms re-admit:
   - Call unDischargePatient(id, gapDays, reason='re-admission via capture')
   - Existing capture flow continues (note generation, save)
5. Doctor declines (claims new patient):
   - Should not happen for valid TZs (TZ is unique per person in Israel)
   - But if it does: log warning, fall through to "create new patient"
     (existing code path)
```

### Settings (no toggle in this PR per Q3 / Q6)

Settings panel gains an informational line:

> *"היסטוריית סיכום יום: שמורה רק במכשיר הזה. סנכרון לענן יתווסף בעתיד."*

Document deferred cloud sync in `IMPROVEMENTS.md`:

> **v1.41+ candidate (deferred from v1.40 brainstorm 2026-05-09):** opt-in cloud sync for `daySnapshots`. Requires new `blob_type = 'day-snapshot'` in Supabase migration, Settings toggle, sync hook on `notifyDayArchived`, and orphan-canary check extension.

## Error handling

| Failure | Detection | Recovery |
|---|---|---|
| Backfill cursor throws mid-iteration | try/catch around `runV1_40_0_BackfillIfNeeded` | Don't set localStorage marker. Retries next boot. Reads tolerate missing fields via `?? defaults`. |
| Snapshot `put` exceeds IDB quota | `QuotaExceededError` | Banner *"לא ניתן לארכב — שטח אחסון מלא. מחק סיכומים ישנים ב-Settings."*. Don't drop active state. |
| Snapshot history > 20 | Length check before `put` | Delete oldest by `archivedAt` ascending. Idempotent. |
| `dischargedAt` missing on `discharged: true` patient (corruption) | Defensive read in `decideSeed` and `detectReadmit` | Treat as not-discharged for staleness. Don't crash. Console.warn gated by `localStorage.bidiAudit` (existing dev affordance). |
| TZ collision during re-admit | `getPatientByTz` returns multiple | Should be impossible (`by-tz` index, TZs unique). If it happens, log + use most recent. |
| Mistaken archive (Aux 4) | None — this is doctor-error, not system error | No undo. Doctor uses double-archive replace within the day (Q5b). |

## Edge cases (must have tests)

1. **Empty snapshot history** — first launch, no archives ever → `buildDayContinuity` returns empty Map.
2. **Patient moved rooms overnight** — `room` differs but `name` first-4-chars matches → `matchType: 'name-fallback'`.
3. **OCR name variation** — `"כהן שרה"` (yesterday) vs `"כהן שרה מ"` (today) → first-4-chars `"כהן "` matches.
4. **Discharged yesterday** — patient in snapshot with `discharged: true`, NOT in today's roster. `buildDayContinuity` does not return them. Re-admit detection finds them by TZ separately.
5. **`handoverNote` ≤ 5 chars** — filtered out of `PreviousDayContext.handoverNote`. Prevents stale "כן"/"לא" pollution.
6. **Discharge gap 23h vs 25h** — boundary test: 23h prefills, 25h skips.
7. **Double-archive same day** — second `put` to `daySnapshots[date=today]` upserts. `archivedAt` reflects second event.
8. **Backfill marker present, partial legacy patient** — reads still work via `?? defaults`. First edit normalizes.
9. **No `lastArchivedDate` ever set** (first launch) — no banner. Once archived, banner fires next day.
10. **Banner dismissed in session, browser reload** — sessionStorage clears; banner re-fires immediately on new-day check.

## Testing

### Test files (PRs 1–3)

```
tests/
├─ engine/
│  └─ dayContinuity.test.ts            ← PR 2: mirror Toranot's ~6 cases
├─ notes/
│  └─ seedFromYesterdaySoap.test.ts    ← PR 2: discharge-gap, episode-stale, prefill paths
├─ storage/
│  ├─ rounds.test.ts                   ← PR 1: backfill idempotency, partial-failure recovery
│  ├─ archiveDay.test.ts               ← PR 1: cap to 20, planToday clear, lastArchivedDate set
│  └─ readmit.test.ts                  ← PR 1: dischargePatient + unDischargePatient round-trip
└─ components/
   └─ MorningArchivePrompt.test.tsx    ← PR 3: banner once-per-session, dismissal sessionStorage key
```

Target: ~25–30 new vitest cases on top of existing 900+ suite. CI gates unchanged. Use `fake-indexeddb` matching existing `storage/*.test.ts` convention.

## Cross-references

- Brief: `docs/NEXT_SESSION_BRIEF-morning-rounds-prep.md`
- Toranot port source: `~/repos/Toranot/src/engine/shiftContinuity.ts` + `tests/shiftContinuity.test.ts`
- Existing continuity: `src/notes/continuity.ts:7,17-52`
- Existing TZ lookup: `src/storage/indexed.ts:189` (`getPatientByTz`)
- Existing event bus: `src/ui/hooks/glanceableEvents.ts`
- Workspace rule (never push main): `~/repos/CLAUDE.md` "Concurrent Claude sessions"
- Memory entries:
  - `project_ward_helper_morning_rounds_prep.md`
  - `feedback_existing_utility_never_called.md` — class-of-bug to avoid
  - `feedback_react_setauthsession_unmount_race.md` — React state-update race patterns

## Open work explicitly NOT in this spec

- **Cloud sync for `daySnapshots`** — deferred to v1.41+. Will need its own mini-spec covering: opt-in toggle UI, `blob_type` migration, sync hook timing, orphan-canary extension. Single-device user means MVP value is low.
- **Formalized `clinicalMeta` sub-shape** — current spec keeps it `Record<string, string>`. If future PRs surface specific keys with shared validation needs, formalize then.
- **Cross-day longitudinal queries** — e.g. "how many days has patient X been on ward?" — not in scope; would build on `daySnapshots` after it stabilizes.

## Suggested first message to Claude when implementing PR 1

> Start ward-helper morning-rounds-prep PR 1 per `docs/superpowers/specs/2026-05-09-morning-rounds-prep-design.md`. Schema-only PR — no UI. Land IDB v5→v6 (new `daySnapshots` store), Patient field additions, `runV1_40_0_BackfillIfNeeded` in new `src/storage/rounds.ts`, storage helpers (`archiveDay`/`dischargePatient`/`unDischargePatient`/`addTomorrowNote`/`dismissTomorrowNote`/`promoteToHandover`), `notifyDayArchived` event. Tests for backfill idempotency, archiveDay cap-to-20, readmit round-trip. Branch `claude/term-rounds-prep-pr1-schema`. Target v1.40.0.
