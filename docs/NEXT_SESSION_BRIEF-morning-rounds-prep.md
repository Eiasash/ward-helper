# Next-session brief — Morning rounds prep feature

**Status:** scoped, not yet started. Author: Eias + Claude on 2026-05-07 evening session (after shipping v1.39.3 → v1.39.14 across 12 PRs).

**Intent (verbatim from user):**

> when I enter for example a daily follow up that the template stays there and then the next day you know there's a placeholder template for the patients unless like we decide it's discharge time and stuff … basically prepare the world do what department prepare the department for the morning for the morning rounds the next day and the day afterwards and so on

**Read this first when starting the new session:** the Toranot repo (`~/repos/Toranot`) already implements this for shift handoff. Borrow its primitives. Don't redesign from scratch.

---

## What Toranot already has (the canonical reference)

| Toranot artifact | Location | Why we want it |
|---|---|---|
| `engine/shiftContinuity.ts` | `~/repos/Toranot/src/engine/shiftContinuity.ts` (116 LOC, pure function) | Cross-references newly-imported patients against the most recent archived shift. Returns a `Map<patientId, PreviousShiftContext>` with handoverNote / openTasks / flags. **Match strategy: room + name fuzzy match (first-4-chars prefix, case-insensitive).** Handles OCR name variations like `"כהן שרה"` vs `"כהן שרה מ"`. |
| `ShiftSnapshot` interface | `~/repos/Toranot/src/context/reducer.ts:30` | The frozen-in-time copy of patient list. Fields: `id`, `date`, `label`, `patients[]`, `archivedAt`. |
| `ARCHIVE_SHIFT` reducer action | `~/repos/Toranot/src/context/reducer.ts:563` | **Manual archive (not auto)** — doctor explicitly says "this shift is done." Snapshot pushed onto `shiftHistory[]`, capped at `MAX_SHIFT_HISTORY = 20`. Photos stripped before archive (localStorage size hygiene via `stripPatientForArchive`). |
| `tomorrowNotes: string[]` field | `~/repos/Toranot/src/types/patient.ts:131` | Explicit "מחר" column for items destined for tomorrow's team. |
| `handoverNote?: string` | `~/repos/Toranot/src/types/patient.ts:147` | Sticky note that "persists across shift archives" — the comment says this verbatim. |
| `discharged?: boolean` + `isAdmission?: boolean` | `~/repos/Toranot/src/types/patient.ts:148-149` | Explicit transitional state. |
| `clinicalMeta` (PMH, baseline mobility/cognition, goals of care) | `~/repos/Toranot/src/types/patient.ts:85-97` | Persistent fields that should carry forward to tomorrow's draft. |

Toranot uses **shift-based** semantics (ערב/לילה/morning). Ward-helper should use **day-based** semantics. Otherwise the architecture is identical.

---

## Three PRs over one session (~3-4 hours focused)

### PR 1 — Schema migration (riskiest piece, ship + sleep on it)

**Scope:** add fields to ward-helper's patient record + a rolling daily snapshot store.

**IndexedDB changes** in `src/storage/indexed.ts`:
- Add to `Patient` type:
  - `discharged?: boolean`
  - `dischargedAt?: number` (ISO ms)
  - `tomorrowNotes?: string[]`
  - `handoverNote?: string` (sticky single-string)
- New IDB store: `daySnapshots` with shape `{ id: string, date: string, archivedAt: number, patients: Patient[] }`
  - Bounded to last 20 entries
  - Photos stripped before archive (mirror Toranot's `stripPatientForArchive` if any photo refs remain in patient records)
- IDB schema version bump (currently v5 per memory; → v6 with onUpgrade migration that adds the new fields with defaults)

**Reducer changes** in `src/context/` (or wherever the equivalent lives — ward-helper uses different state mgmt than Toranot's Zustand):
- `ARCHIVE_DAY` action: snapshots current roster + patient state into `daySnapshots`, clears today's volatile fields (vitals/labs/today's-plan), preserves identity + clinicalMeta + handoverNote
- Auto-trigger: on first `/today` view of a new calendar day (compared to `lastArchivedDate` localStorage key), prompt user to archive

**No UI yet in this PR** — pure schema + reducer + tests. Ships as v1.40.0 (minor bump signals new persistence layer).

**Cloud backup compatibility:** the new fields encrypt + push fine since the cipher blob is opaque. The `daySnapshots` store stays local-only initially (don't auto-push yet — pushing 20 snapshots × N patients × M notes balloons cloud costs). Add a later "push snapshots too" toggle if user wants cross-device continuity.

### PR 2 — Continuity engine (pure function, easy to test)

**Scope:** port `shiftContinuity.ts` line-by-line, rename "Shift" → "Day".

**File:** `src/engine/dayContinuity.ts` (new). Pure function:

```ts
export function buildDayContinuity(
  currentRoster: Patient[],
  snapshotHistory: DaySnapshot[],
): Map<string, PreviousDayContext>;
```

Match strategy identical to Toranot's: exact room + first-4-chars-of-name prefix match, fallback to name-only if room changed (patient moved).

**Tests:** mirror `tests/shiftContinuity.test.ts` from Toranot. Cover:
- empty history → empty result
- room moved + name match → matched
- name OCR variation → matched (`"כהן שרה"` vs `"כהן שרה מ"`)
- discharged patient yesterday → not surfaced today
- handoverNote with <5 chars → filtered out (Toranot does this: `prev.handoverNote.trim().length > 5`)

Ships as v1.40.1.

### PR 3 — UI: morning prompt + draft seed

**Scope:** wire the engine into `/today` + add the SOAP-as-seed flow.

**On `/today` mount:**
- If `localStorage.lastArchivedDate < today`, show banner: *"זוהה יום חדש. לארכב את אתמול ולהקים רשימה לבוקר?"* with **ארכב** + **דחה** buttons.
- After archive: roster filters out `discharged === true` patients. The remaining list shows a **"השתמש בהערת אתמול"** button next to each patient.
- Clicking surfaces yesterday's most recent SOAP from `notes` IDB store, opens NoteEditor pre-filled with:
  - **Carry**: subjective baseline, PMH, meds, allergies, handoverNote, goals of care, clinicalMeta
  - **Clear**: vitals, labs, today's plan, today's chief complaint

**Discharge button** added to per-patient view — sets `discharged: true` + `dischargedAt: now()`, drops patient from tomorrow's auto-roster.

**Tomorrow notes affordance** — small text input on each patient card titled *"מחר"*. Saves directly to `tomorrowNotes[]`. Surfaces as a banner when that patient appears in tomorrow's roster.

Ships as v1.40.2.

---

## Open design questions (decide before starting PR 1)

**1. Auto-archive vs manual archive.** Toranot is manual (doctor explicitly archives). User said *"unless like we decide it's discharge time and stuff"* — implies they want some auto-detection. **Recommendation: prompt-but-don't-auto.** On first `/today` view of a new day, show a banner asking. Doctor accepts → archive runs. Doctor dismisses → keep yesterday's list visible until they explicitly archive. Safer than auto.

**2. What counts as "carry" vs "clear" on the SOAP draft?**
The classifier I sketched in PR 3 above is a starting point. **Open question:** is the *plan* persistent or volatile? On one hand, "continue current treatment plan" carries. On the other, today's specific actions (call consult, order labs) shouldn't auto-prefill into tomorrow. **Recommendation: split `plan` into `planLongTerm` (carries) + `planToday` (clears).** This is a schema change that should land in PR 1, not PR 3.

**3. Should `daySnapshots` push to cloud?**
Pro: cross-device continuity (open ward-helper on phone, see yesterday's snapshot).
Con: 20× the data volume, doctor's privacy concern about historical lists living in cloud.
**Recommendation: local-only initially.** Add a Settings toggle later if user wants cross-device.

**4. How to handle a patient who returns after discharge?**
If patient X is `discharged: true`, gets re-admitted later (same person, same TZ), should the old record un-discharge or should a new record be created?
**Recommendation: same record, un-discharge.** Set `discharged: false`, clear `dischargedAt`, push a fresh `handoverNote` indicating re-admission. Same TZ → same patient.

---

## Where today ended (context for starting cold)

- **v1.39.14 live** as of 2026-05-07 evening (PR #102)
- 12 PRs shipped today: v1.39.3 → v1.39.14
- All 8 medical PWAs continue to share `app_users` in Supabase project `krmlzwwelqvlfslwltol`
- ward-helper has 900 passing tests + 1 skipped, entry chunk ~130 KB gzipped
- The orphan-canary state for the user's current account is "had 86 cloud rows from a prior passphrase, marker preserved by v1.39.9, override UI shipped in v1.39.14 if they ever want to reclaim that path"
- User can log in normally with `eiasashhab55555` / `zondama55` (reset 2026-05-07 evening) → can change password in-app via v1.39.13's friendly Hebrew error UX

## Suggested first-message-to-Claude in the new session

> "Start the morning-rounds-prep feature per docs/NEXT_SESSION_BRIEF-morning-rounds-prep.md. Ship PR 1 (schema only, no UI). Use the four open design questions in that brief — pick the recommended answers unless they don't make sense after re-reading. We're aiming for v1.40.0 by end of session 1."

That gives the next Claude full scope + recommendations + a clear v1.40.0 target. They can spend the first 5 minutes reading the brief + the Toranot files, then go directly to coding the schema migration.

---

## Cross-references

- **Toranot source files** to read first:
  - `~/repos/Toranot/src/engine/shiftContinuity.ts`
  - `~/repos/Toranot/src/context/reducer.ts` (line 30 for `ShiftSnapshot`, line 563 for `ARCHIVE_SHIFT`)
  - `~/repos/Toranot/src/types/patient.ts` (lines 85-149 for the field shapes)

- **Memory entries** to reference:
  - `project_ward_helper_password_recovery.md` — auth schema constraints (we share `app_users` with siblings)
  - `feedback_existing_utility_never_called.md` — class-of-bug to avoid (utilities exist, new code doesn't import them)
  - `feedback_react_setauthsession_unmount_race.md` — React state-update race patterns to avoid in any new auth-touching code
