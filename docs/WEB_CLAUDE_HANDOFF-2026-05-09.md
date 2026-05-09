# Web Claude handoff — 2026-05-09 morning-rounds-prep

Paste-ready prompt for the parallel Claude web session. Copy everything between the fences below.

```
Hi — terminal Claude here handing off ward-helper status. You're in a different repo per our coordination protocol, so this is informational only. Do NOT touch ward-helper unless explicitly redirected.

## Session: 2026-05-09 morning-rounds-prep autonomous execution

**Branch state:** main is clean. Three PRs shipped and squash-merged in sequence:
- PR #120 v1.40.0 (af780a8) — schema + storage layer
- PR #121 v1.40.1 — engine (dayContinuity + seedFromYesterdaySoap)
- PR #122 v1.40.2 — UI (banners + plan fields + tomorrow notes)

All three: verify-deploy PASS on https://eiasash.github.io/ward-helper/. 969 vitest passing (was 911 baseline; +58 new tests). Branches deleted.

## What shipped (doctor-facing)

1. Morning archive prompt — banner appears next morning offering to snapshot today's patient state into daySnapshots store (20-entry cap, IDB-local only)
2. Discharge button per patient row, with un-discharge round-trip and handoverNote append
3. Re-admit detection — when same name+room within 24h gap, ReadmitBanner offers to seed yesterday's plan
4. Tomorrow notes — per-patient "for tomorrow" lines with [דחה] / [הפוך לקבועה] (promote to handover) actions
5. Plan fields on patient card — planLongTerm + planToday textareas, save on blur
6. Yesterday-SOAP seeding — when extracting next-day TZ, prepends pure context block from yesterday's plan (preserves CHAMELEON_RULES + SOAP_STYLE invariant in orchestrate.ts)
7. Day continuity engine — pure function matching today's roster against snapshot history via room+4-char namePrefix → name fallback, BIDI-stripped

## Files of note

New: src/storage/rounds.ts, src/engine/dayContinuity.ts, src/notes/seedFromYesterdaySoap.ts, src/ui/components/{MorningArchivePrompt,TomorrowBanner,ReadmitBanner,PatientPlanFields,TomorrowNotesInput}.tsx

Modified: src/storage/indexed.ts (DB v5→6, 7 new optional Patient fields), src/ui/App.tsx, src/ui/screens/Review.tsx (NOT Capture.tsx — plan was wrong, extract turn lands in Review), src/ui/components/RecentPatientsList.tsx, src/notes/orchestrate.ts (PREPEND only), src/main.tsx (post-open backfill), src/ui/hooks/glanceableEvents.ts (+notifyDayArchived, +notifyPatientsChanged)

Spec: docs/superpowers/specs/2026-05-09-morning-rounds-prep-design.md
Plan: docs/superpowers/plans/2026-05-09-morning-rounds-prep-v1.md

## Architecture decisions worth remembering

- archiveDay is atomic via single db.transaction(['daySnapshots','patients'],'readwrite') — read+modify+write race protection. Earlier non-atomic version had a corruption bug where retry-after-mid-loop-failure overwrote good snapshot with half-cleared data
- dischargePatient/unDischargePatient/promoteToHandover all tx-wrapped (doctor double-tap protection)
- BIDI strip set is broad — codepoint ranges U+200C–U+200F, U+202A–U+202E, U+2066–U+2069, plus U+FEFF (see `src/engine/dayContinuity.ts` for the actual regex literal). Matches ward-helper's known BIDI corruption history
- Backfill runs as post-open one-shot, NOT in IDB upgrade callback (transaction lifetime hazard)
- promoteToHandover throws on out-of-bounds (not silent no-op) per CLAUDE.md "don't hide confusion"
- SeedDecision discriminated union has only 'no-prefill' | 'prefill' — 'episode-stale' was dead code, removed per YAGNI

## Deferred to v1.41+ (in IMPROVEMENTS.md)

- Runtime "השתמש בהערת אתמול" button on Capture (sub-task 3.8B) — needs threading seedContext through generateNote/buildPromptPrefix
- Cloud sync for daySnapshots (currently IDB-local only)

## Pending user action

User went to sleep mid-execution with explicit autonomy mandate. When they wake:
1. Eyeball-with-DevTools ritual on live URL (real Chrome, console + Network tabs visible) — vitest can't catch CSP violations / raw error bleed / runtime console errors
2. Manual discharge → re-admit roundtrip smoke test
3. Decide on public/skills/geriatrics-knowledge/SKILL.md uncommitted drift (Hazzard chapter map dated 2026-05-08 — not from this session, their other workstream)

## Coordination signal

ward-helper is terminal Claude's. Per ~/.claude/CLAUDE.md "Concurrent Claude sessions" protocol: don't push to ward-helper main, don't open PRs there. If you need ward-helper context for cross-repo work (e.g., porting bidi.ts or shiftContinuity to a sibling), read-only is fine.
```
