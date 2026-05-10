# ward-helper — audit-fix-deploy improvement log

Auto-appended by the audit-fix-deploy pipeline. Most recent run on top.

---

## 2026-05-10 — Ortho-rehab quickref UI at #/ortho (follow-up to PR #127)

Wires the ortho-rehab content drop (PR #127) into a single-screen UI exposed at
`#/ortho`. No version bump (purely additive route; no SW behavior change, no
existing-feature change).

**Files added:**
- `src/ui/screens/OrthoQuickref.tsx` - single React functional component, three
  sections top-to-bottom:
  - **A. Live calculators** - date input drives reactive POD, suture removal
    date (site select + 6 modifier checkboxes), DVT prophylaxis line (renal-state
    radio group). Single "Copy" button on the DVT line routes through
    `wrapForChameleon` before `navigator.clipboard.writeText`.
  - **B. Reference accordions** (8 native `<details>`, all collapsed by default):
    hip-fracture procedures, suture timing, ASA classes, DVT presets, Vancouver
    types, post-op imaging differential + bedside rules, ORIF vs CRIF, IM-nail
    brands. Tables use `dir="rtl"` headers + per-cell `dir="auto"` for mixed
    Hebrew/English content.
  - **C. SOAP templates** (5 native `<details>`): day-1 ortho capsule, day-1 SOAP
    post-hip, day-1 SOAP post-spine, daily STABLE gym, daily STABLE bedside.
    Each template has a "העתק" button using `wrapForChameleon`. Domain
    prefixes appended as a `<ul>` at the bottom.

**Files edited:**
- `src/ui/App.tsx` - `import OrthoQuickref`, add `<Route path="/ortho">`, add
  6th `NavLink to="/ortho"` labeled "אורתו". Eager-imported (small enough not
  to need lazy-loading; matches Today/Settings pattern).

**Tests added:**
- `src/ui/screens/__tests__/OrthoQuickref.test.tsx` - 6 happy-path cases:
  renders without crashing, empty-state hint visible until date picked, POD=17
  for surgery 2026-04-23 with system clock pinned to 2026-05-10, suture-removal
  output reflects hip default (POD 14, date 07/05/26), 13 `<details>` elements
  present (8 reference + 5 templates), copy button calls
  `navigator.clipboard.writeText` with the Hebrew DVT line preserved. Uses
  `vi.useFakeTimers({ toFake: ['Date'] })` so async setTimeout cleanup in the
  copy handler doesn't deadlock `vi.waitFor`.

**No new dependencies.** Native `<details>/<summary>` for accordion (no
@radix-ui/accordion or similar). No new component CSS - reuses existing
`.card`, `.btn-like`, `.toggle-row`, `.cloud-banner`, `.empty-sub` from
`src/styles.css`.

**Acceptance:**
- `npm run check` green (TypeScript strict)
- `npm test`: 1026 passed | 1 skipped (Δ +6 vs PR #127's 1020 baseline)
- `npm run build` green; entry chunk **145.08 kB gz** (80.6% of 180 kB ceiling,
  Δ +10.43 kB vs 134.65 kB PR #127 baseline - 3 ortho modules now bundled into
  the entry chunk via the eager import; consumed 21% of the 49.95 kB headroom).
- Encoding hygiene grep (Unicode arrows, `**bold**`, `^--$`) clean across both
  new files.
- `verify-deploy.sh`: PASS (no version bump, cache marker `ward-v1.42.0` unchanged).

**Out of scope (deferred, per brief):**
- Auto-audit drift probe for ortho-rehab content drift.
- Patient-card-level POD widget on Today/History (this PR ships the standalone
  quickref only).
- Decision-tree autopicker for procedure selection.

---

## 2026-05-10 — Ortho-rehab quickref data + calculators (additive content drop)

Adds the SZMC ortho-rehab reference card content + Hebrew SOAP templates +
3 TZ-safe pure date calculators. No version bump (purely additive content;
no behavior change to existing app surfaces).

**Files added:**
- `src/data/orthoReference.ts` — TS `as const` export with full hip-fracture
  procedure table, ASA classes, ORIF vs CRIF, IM-nail brands, suture timing
  (7 sites + 6 modifiers), DVT prophylaxis presets (default + 2 renal
  adjustments), Vancouver periprosthetic types, post-op imaging differential,
  bedside imaging rules. All Hebrew strings preserved as-is UTF-8. Source-of-
  truth: `~/.claude/skills/rehab-quickref/` v4.1 + `ortho-reference/` skills.
- `src/data/orthoTemplates.ts` — TS `as const` export with day-1 ortho
  capsule, FIRST-DAY SOAP for hip and spine, daily STABLE templates (gym +
  bedside), and `domainPrefixes` lookup mirror of `rehabPrompts.ts`
  REHAB_UNIVERSAL (UI-only; LLM-directive copy in rehabPrompts.ts is
  canonical).
- `src/notes/orthoCalc.ts` — three pure functions: `calculatePOD`,
  `suggestSutureRemovalDate`, `suggestDvtProphylaxis`. **TZ-safe by
  construction**: uses local-zone `getFullYear/getMonth/getDate` rather
  than `toISOString().slice(0,10)` (the v1 brief had this bug; silent
  one-day-west drift in any UTC-positive zone like Asia/Jerusalem).
- `src/notes/__tests__/orthoCalc.test.ts` — 22 cases including the
  "regression: dates are computed in local TZ, not UTC" block that pins
  the local-calendar-day behavior. Without this guard, a future
  "simplification" back to `toISOString` would silently corrupt suture
  removal and DVT-end dates by one day.

**Package changes:**
- `cross-env` added to devDependencies; `test` / `test:watch` / `test:coverage`
  scripts now prefix `cross-env TZ=Asia/Jerusalem` so the regression test
  pins the right zone on Windows CI as well as Linux CI.

**No UI in this PR.** Follow-up PR will add `pages/Rehab/OrthoQuickref.tsx`
(collapsible accordion) + bedside POD widget on the patient-detail surface.

**Acceptance:**
- `npm run check` green (TypeScript strict)
- `npm test`: 1020 passed | 1 skipped (Δ +34 vs v1.41.0 audit snapshot;
  22 are this drop's orthoCalc cases, the rest accumulated through v1.42.0).
- `npm run build` green; entry chunk 134.65 kB gz (74.8% of 180 kB ceiling,
  Δ ~ +1 kB vs v1.42.0 baseline 133.69 kB; well within budget).
- Encoding hygiene grep (`\*\*\w`, Unicode arrows, `^--$`) clean across
  all 4 new files.
- Out of scope (deliberate): NO Supabase migrations, NO RLS changes, NO
  cohort examples, NO AI-generated narrative paragraphs, NO decision-tree
  autopicker. See § 8 of WARD_HELPER_ORTHO_REHAB_BRIEF for rationale.

---

## 2026-05-10 — v1.42.0 daySnapshots cloud sync (v1.41+ candidate from #122 brainstorm)

Closes the deferred "Cloud sync for `daySnapshots`" item listed under "v1.41+
candidates" below. Opt-in toggle, per-snapshot encrypted blob, cap mirroring
via SECURITY DEFINER RPC.

**Files added:**
- `supabase/migrations/0008_ward_helper_backup_allow_day_snapshot_blob_type.sql`
  — extends the `blob_type` CHECK constraint to allow `'day-snapshot'`, plus a
  new `ward_helper_evict_day_snapshots(p_username, p_keep_ids text[])`
  SECURITY DEFINER RPC. Migration 0002 intentionally has no DELETE policy on
  `ward_helper_backup`, so the RPC is the only sanctioned client path to
  evict cloud rows when the local 20-snapshot cap kicks in. Defense pattern
  mirrors `ward_helper_dedupe_stale_canaries` (migration 0007): caller must
  already own at least one day-snapshot under `p_username`, and an empty
  `p_keep_ids` is treated as a no-op (never wipe everything).
- `src/storage/daySnapshotsCloud.ts` — new module:
  - `DAY_SNAPSHOT_CLOUD_SYNC_KEY`, `getDaySnapshotCloudSyncEnabled`,
    `setDaySnapshotCloudSyncEnabled`
  - `pushLatestDaySnapshotIfEnabled()` — full 3-state guard (toggle off /
    guest / no-login = silent skip with structured `{ kind: 'skipped',
    reason }`), pushes the newest local snapshot, then mirrors the cap.
  - `evictStaleCloudSnapshots(username, keepIds)` — RPC wrapper.
  - `applyDaySnapshotFromCloudRow(row, passphrase)` — restore-side decrypt +
    shape-check + putDaySnapshot.
- `tests/daySnapshotsCloud.test.ts` — 13 cases covering toggle persistence,
  3-state guard, ciphertext-only-on-wire payload contract (PHI sentinels in
  patient handover/plan must not appear in any string field), cap-mirror RPC
  call shape, re-archive idempotency, restore round-trip, shape-check
  rejection, wrong-passphrase rejection.

**Files touched:**
- `src/storage/cloud.ts` — extends `pushBlob` `type` union and `CloudBlobRow`
  `blob_type` to include `'day-snapshot'`. No other change.
- `src/notes/save.ts` — extends `RestoreResult` with `restoredDaySnapshots:
  number` and adds the `'day-snapshot'` branch in the per-row decrypt loop
  inside `restoreFromCloud`.
- `src/ui/App.tsx` — adds `useEffect` subscribing to
  `ward-helper:day-archived` window event. Helper does the gating; this
  subscriber stays trivial and never throws.
- `src/ui/hooks/useSettings.ts` — adds `useDaySnapshotCloudSync()` hook
  mirroring the `useBidiAudit` pattern.
- `src/ui/screens/Settings.tsx` — new "סנכרון ענן" section above developer
  diagnostics with the toggle and helper text explaining 20-day cap +
  no-backfill semantics.
- `tests/canaryProtection.test.ts` — regression case proving day-snapshot
  rows count as non-canary data, so orphan-protection still triggers when
  the wrong passphrase tries to overwrite the canary.

**Architecture decisions:**

- **Per-snapshot blob_id = snapshot.id (YYYY-MM-DD)** rather than a single
  collection blob. Idempotent on re-archive of the same date (upsert by
  composite key). Granular sync: only the new snapshot is pushed per archive
  event, not the whole 20-snapshot history.
- **Cap mirror via DELETE RPC, not collection upsert.** The local cap evicts
  the oldest snapshot when count > 20; the same eviction must propagate to
  cloud or storage grows unbounded. RLS blocks raw client DELETE on this
  table by design (migration 0002), so we add a scoped SECURITY DEFINER RPC.
- **No backfill on toggle enable.** "Enable" means "from now on" — explicit
  in the toggle's helper text. Avoids a code path that would push 20 historic
  snapshots over a slow mobile connection on first opt-in.
- **Push trigger lives in App.tsx, not inside `archiveDay()`.** The storage
  layer must not depend on auth/passphrase state — that would invert the
  existing `storage → no UI; UI → storage` direction. The App-level
  subscriber pattern matches how `notifyDayArchived` is already consumed by
  the glanceable header.

**Trinity:** package.json `1.41.0 → 1.42.0`, `public/sw.js` line bumped to
`ward-v1.42.0` (Vite `swVersionSync` plugin rewrites `dist/sw.js` at build).

**Verification:**
- `npm run check` clean (tsc --noEmit).
- `npm test` 1000 passed (was 986 baseline; +14 added — 13 daySnapshotsCloud
  + 1 canaryProtection regression). 1 skipped unchanged (live-eval gated).
- `npm run build` clean. Entry chunk gz **134.65 kB / 180 kB ceiling
  (74.8%)**, +0.70 kB delta from v1.41.0.
- `dist/sw.js` correctly rewritten to `ward-v1.42.0` via the swVersionSync
  Vite plugin.

**Operational notes:**
- Migration 0008 must be applied to Supabase project `krmlzwwelqvlfslwltol`
  before users opt in. Without it, the first push fails with a CHECK
  constraint violation. Apply via the Supabase MCP or the SQL editor.
- The toggle is OFF by default. Existing users see no behavior change.
- Per-snapshot wire payload size is ~5–50 KB (encrypted JSON of
  `Patient[]` × N).
- **Cap is per-device, not per-user.** The evict RPC scopes by `user_id =
  auth.uid()` for the security defense (caller can only prune their own
  device's snapshots), so a multi-device user may accumulate up to N×20
  cloud day-snapshots across devices. Local stays bounded because
  `putDaySnapshot` enforces the 20-cap on every write/restore. Acceptable
  trade-off — tightening would require either widening the evict scope
  beyond `auth.uid()` (loses the defense) or moving cap enforcement to a
  cron RPC (more code, deferred).

---

## 2026-05-10 — audit-only pass on v1.41.0 (no code changes, no version bump)

Routine audit-fix-deploy run on the post-v1.41.0 main HEAD. Zero functional
issues found — all 8 CI gates green, full verify suite green, bundle 28%
under entry-chunk ceiling. Deliverable is documentation + telemetry only.

Gates (§ F.1):
- Gate 1 entry-chunk gz: **133,691 B / 184,320 B (72.5%)** — 50,629 B headroom
- Gate 1 total assets gz: **203,898 B / 409,600 B (49.8%)**
- Gate 2 CSP present in `index.html`: PASS
- Gate 3 no analytics/tracking: PASS
- Gate 4 no plaintext-PHI grep hits in source: PASS
- Gate 5 PBKDF2_ITERATIONS = 600_000 in `src/crypto/pbkdf2.ts`: PASS
- Gate 6 `toranot.netlify.app/api/claude` in `src/agent/client.ts`: PASS
- Gate 7 NO `@anthropic-ai/sdk` in `package.json`: PASS
- Gate 8 `compressImage` called in `src/ui/screens/Capture.tsx`: PASS (2 sites)

Verify suite:
- `npm ci` — 350 packages, 0 vulnerabilities
- `npm run check` — clean (tsc --noEmit)
- `npm test` — **986 passed / 1 skipped** across **97 files** (skipped =
  `tests/extraction/eval.test.ts`, gated on `ANTHROPIC_API_KEY`)
- `npm run build` — clean, sw rewrites to `ward-v1.41.0`

Skill drift check (§ F.6):
- `azma-ui`, `szmc-clinical-notes`, `szmc-interesting-cases`,
  `hebrew-medical-glossary` — all in sync with `~/.claude/skills/` source.
- `geriatrics-knowledge` — in sync after the `SKILL_PATCHES` rewrite (sync
  script logs `patched geriatrics-knowledge/SKILL.md`).

Coverage snapshot (vitest --coverage):
- **Total statements 65.34%, branches 80.96%, functions 63.20%**
- Lowest-yield uncovered code is in UI screens (`DebugPanel.tsx` 2.2%,
  `Consult.tsx` 4.2%, `AccountSection.tsx` 17.5%, `Save.tsx` 18.9%,
  `Census.tsx` 27.8%, `Review.tsx` 33.8%) — UI-only, low cost-benefit
  for unit tests; better attacked by Playwright in the bot harness.
- Non-UI code very well covered: `email.ts` 100%, `consult.ts` 90.1%,
  `regenerate.ts` 86.9%, `orchestrate.ts` 98.0%, `client.ts` 100%.
- Two largest non-UI files with sub-80% coverage: `agent/loop.ts` (72.6%,
  207/285) and `notes/save.ts` (73.8%, 76/103). Most of the gap is
  defensive `postClaude` failure-mode branches already exercised by
  integration mocks; further unit tests would be redundant harness wiring.

Decision: no test additions this pass. Coverage is healthy where it
matters; the UI gap is correctly addressed by the ward-helper-bot-v1
Playwright harness (Phase 7, see `scripts/wardHelperBot/`), not by
synthetic vitest UI cases.

No skills source edits, no `public/skills/**` hand-edits.

Trinity unchanged (still v1.41.0 / `ward-v1.41.0`).

Open follow-ups carried forward (none new this run):
- Eyeball-with-DevTools ritual on the morning-rounds-prep flow (v1.40.x +
  v1.41.0) — already done 2026-05-09 per `project_ward_helper_morning_rounds_prep`
  memory; no action needed.
- ward-helper-bot-v1 next campaign (still up to user — Phase 7 cadence).
- `tests/extraction/eval.test.ts` periodic run with `ANTHROPIC_API_KEY` set
  to catch `parse_azma_screen` regressions (per § F.6).

---

## 2026-05-10 — v1.41.0 runtime "השתמש בהערת אתמול" toggle (Task 3.8 sub-task B shipped)

Closes the deferred sub-task from the v1.40 brainstorm (see "v1.41+ candidates"
below). The infrastructure already shipped in v1.40.x (`decideSeed`,
`buildSeedBlocks`, `SeedDecision`); v1.41.0 threads `seedContext` through
the prompt-prefix builders and adds a runtime toggle on Review.

Files touched:
- `src/notes/orchestrate.ts` — added optional `seedContext?: SeedDecision`
  param to `buildSoapPromptPrefix`, `buildPromptPrefix`, and `generateNote`.
  Trimmed `buildSeedBlocks` to emit ONLY the durable patient fields
  (handoverNote / planLongTerm / clinicalMeta) — yesterday's SOAP body is
  already injected by `buildSoapPromptPrefix` via `MOST RECENT SOAP (date)`,
  so re-emitting `bodyContext` would duplicate the body in the prompt.
- `src/ui/screens/Review.tsx` — new `seedAvailable` + `seedFromYesterdayEnabled`
  state + inline toggle button rendered alongside `ContinuityBanner`. The
  button only shows when `decideSeed` returns `prefill` for the extracted
  patient. Default OFF (doctor opts in) — adds tokens, don't spend implicitly.
  On Proceed, writes `seedFromYesterday=1` to sessionStorage.
- `src/ui/screens/NoteEditor.tsx` — reads the flag, calls `decideSeed` on
  the continuity patient, passes the resulting `SeedDecision` into
  `generateNote`. Cache key extended to include seed-on/off so a flipped
  toggle invalidates cached body.
- `tests/seededSoapPrompt.test.ts` — locked test updated for the new
  contract (no `bodyContext` re-emission, no "do NOT copy verbatim"
  sentinel inside `buildSeedBlocks`).
- `tests/seedContextThreading.test.ts` — new (12 cases) — locks the
  threading through `buildSoapPromptPrefix` + `buildPromptPrefix` for
  every note type, including "body appears at most once" duplication
  guard.
- `tests/reviewSeedToggle.test.tsx` — new (5 cases) — locks the
  Review-screen UI: button visibility predicate, label-flip on click,
  sessionStorage flag write on Proceed.

Architecture decision (advisor-flagged): when both continuity AND seed are
on, we let continuity own the body (`MOST RECENT SOAP (date)` block) and
seed contributes ONLY the durable patient-fields lines on top. The
alternative — seed replacing continuity — was rejected as it would mean
losing the trajectory-tracking instructions in the SOAP follow-up branch.

Verification:
- `npm run check` clean (tsc --noEmit).
- `npm test` 986 passed (was 969 baseline; +17 added — 5 reviewSeedToggle
  + 12 seedContextThreading; locked seededSoapPrompt swapped 1 case for 1).
- `npm run build` clean. Entry chunk gz 133.95 kB / 180 kB ceiling (74.4%).
- `dist/sw.js` correctly rewrites to `ward-v1.41.0` via the swVersionSync
  Vite plugin.

Trinity: package.json `1.40.2 → 1.41.0`, `public/sw.js` line bumped to
`ward-v1.41.0` (Vite plugin rewrites at build, but the literal must be
present or the swVersionSync plugin throws).

---

## 2026-05-05 — v1.33.0 bundle telemetry follow-up

After PR #48 (azma-ui R4 + geriatrics-knowledge skills bundle) and PR #49 (SOAP capsule-in-A v4) both landed in parallel during the deep-audit session, the entry chunk grew. Capturing the new baseline so future audits can delta against it:

| Asset | R2 (2026-05-01) | v1.33.0 (post-#48/#49) | Δ |
|---|---|---|---|
| Entry chunk gz | 154,419 b (83.78%) | 159,230 b (86.39%) | **+4.81 kB** |
| Trigger threshold for lazy-load | 165 kB | 165 kB | — |
| Headroom to 180 kB ceiling | 29.9 kB | 25.1 kB | -4.8 kB |
| Headroom to lazy-load trigger | 10.6 kB | 5.8 kB | -4.8 kB |

**Status:** still under the lazy-load trigger (159 < 165 kB), but ~5.8 kB below it. The next feature commit landing in `index-*.js` is plausibly the one that crosses. Watch list:
- **If next bump pushes entry ≥165 kB**: trigger lazy-load of `@supabase/supabase-js` per the R2-deferred plan (defer `getSupabase()` until first cloud-push attempt, save ~30 kB gz).
- **If skill bundle grows further** (azma-ui R5, new SZMC skill): re-confirm the runtime-only file whitelist in `scripts/sync-skills.mjs` is excluding decorative assets (slide_art/ already excluded).

CI bundle gate (`[ "$SIZE" -le 184320 ]`) still passing. No action needed.

### Why this isn't a code-change PR

Per session working rule #2 ("Minimum code that solves the problem. Nothing speculative."), the lazy-load is reserved for the trigger crossing. Pre-emptive split would risk pessimizing cache behavior on the current stable bundle for no measured user-impact.

---

## 2026-05-05 — v1.32.0 deep audit (audit-only, no behavior change)

**Trigger:** workspace-wide deep audit pass across the 4 medical PWAs. ward-helper baseline is v1.32.0; tests + tsc + build green earlier today.

**Outcome:** 🟢 audit-only — backlog items earmarked for "if entry chunk crosses ~165 kB gz" or cross-repo coordinated. **No code change, no trinity bump, no live witness gate.**

### Watch-item spot-checks

| Watch item | Result |
|---|---|
| Two auth systems both functional (anon `signInAnonymously()` cloud sync + `app_users` RPC) | ✅ pattern intact in `src/auth/auth.ts` + `src/storage/cloud.ts` (cloud sync wired with 20 live rows per CLAUDE.md baseline; `app_users` RPC NOT bridged to cloud sync per CLAUDE.md "do not finish without explicit ask") |
| Wrong-patient defense — 3 layers firing | ✅ all present: `src/agent/loop.ts` (PROMPT extract instructions), `src/agent/tools.ts` (`assertExtractIsSafe`), `src/ui/components/FieldRow.tsx` (`onConfirmChange` + Proceed gate v1.21.3) |
| Skill drift between `~/.claude/skills/` and `public/skills/` | ✅ `tests/skillsBundle.test.ts` enforces; build sync via `scripts/sync-skills.mjs` |
| Entry chunk gzip ceiling 180 kB (184,320 bytes) | ✅ CI gate at `.github/workflows/ci.yml`: `[ "$SIZE" -le 184320 ]`. Last R2 measurement: 154,419 bytes (83.78%, ~30 kB headroom) |
| Opus 4.7 adaptive (v1.27.0) token cost | No baseline shift detected this pass; cost-tracker `src/agent/costs.ts` defenses in place since R3 PR #35 (NaN/negative/non-finite clamp at write+read boundaries) |
| Supabase pinned to `krmlzwwelqvlfslwltol` (NOT `oaojkanozbfpofbewtfq`) | ✅ `tests/supabase-config.test.ts` enforces |

### `npm run check && npm test` — clean

`tsc --noEmit` + vitest both green earlier today. 701+ tests across 62+ files baseline (per CLAUDE.md snapshot) + 1 skipped (live-eval gated on `ANTHROPIC_API_KEY`, by design).

### Outstanding feature branch — surfaced for visibility

Branch `claude/term-skills-r4-azma-and-geri-knowledge` (commit `48f9eb1`, 2026-05-02 by Eias) is 1 commit ahead of `main`, **pushed to origin but no PR open**. Substantive change: +2113 LOC bundling azma-ui R4 + geriatrics-knowledge skills (CLAUDE.md, `public/skills/azma-ui/{SKILL.md,AZMA_REFERENCE.md,azma_reference.json}`, `public/skills/geriatrics-knowledge/SKILL.md`, `public/skills/szmc-clinical-notes/SKILL.md`, `scripts/sync-skills.mjs`, `src/notes/templates.ts`, `src/skills/loader.ts`, `tests/skillsBundle.test.ts`).

**Action: none from this audit pass** — the branch is not corrupted, not stale beyond fix, and not blocking deploy. Decision on whether to PR/merge it is the user's. Flagging here so it's visible in the audit trail.

### Backlog items NOT shipped (with rationale)

| Item | Why not shipped this pass |
|---|---|
| Lazy-load `@supabase/supabase-js` until first cloud-push | Earmarked in R2 IMPROVEMENTS for "if entry climbs past ~165 kB gz". Currently 154 kB — 11 kB under the trigger. Speculative work. |
| `@vitest/coverage-v8` config | Speculative — coverage % is noisy on a hand-tested codebase. R3+ candidate per IMPROVEMENTS.md. |
| Vite 5 → 8 + Vitest 4 upgrade | Multi-major jump, plugin compat verification. Should be focused PR with separate test pass. |
| Skill-file path resolution for `.claude/skills/` writes | Sandbox-config issue, not application code. |
| Strict CSP `===` exact-list assertion | R3 candidate after transitional-domain settling. |

### PAT audit

No GitHub PAT, Anthropic API key, or Supabase service-role key shapes in this terminal session's visible context.

---

## 2026-05-01 — R3 followups shipped (PR #35)

Two R3-flagged hardening items from the R2 deeper-dig audit landed together in [PR #35](https://github.com/Eiasash/ward-helper/pull/35) — both touch the same low-risk cost-tracking surface:

| Item | R2 line | Resolution |
|---|---|---|
| `costs.ts` NaN/negative/non-finite defense | "Hardening opportunity (R3): validate `usage.input_tokens >= 0 && Number.isFinite(...)`" | `sanitizeTokenCount` + `sanitizeUsd` clamp untrusted numeric input at write (`turnCost`) AND read (`load`) boundaries — write-side keeps bad data out of localStorage, read-side rehabilitates pre-sanitization-era corrupt state. +9 vitest cases under "malformed-input defense". |
| `@supabase/supabase-js` 2.104.1 → 2.105.1 | "safe minor bump and could land in R3" | Lockfile-only bump (caret `"^2.45.0"` unchanged). Bundle delta +1.5 kB gz (155.9 kB / 84% of 180 kB ceiling). |

CI verification (8 gates): bundle-size, CSP, no-analytics, no-PHI-in-console, PBKDF2=600k, Toranot proxy, no-anthropic-sdk, compressImage — all PASS. Test count 668 → 677 (+9 NaN cases), 60 files unchanged.

**Still earmarked for later** (not in #35):
- supabase-js lazy-load (defer `getSupabase()` until first cloud-push). Trigger: entry chunk climbs past ~165 kB gz. Currently 155.9 kB → ~10 kB headroom before this becomes worth doing.
- Coverage gaps (no `@vitest/coverage-v8` configured). Tests are written by hand against named contracts; coverage % is noisy here.

---

## 2026-05-01 — R2 deeper-dig audit (v1.32.0)

### R1 followups resolved

| Followup | Resolution |
|---|---|
| Vite mixed static/dynamic-import warning on `useGlanceable.ts` | Extracted no-dep event emitters (`notifyNotesChanged`, `notifyPatientChanged`, `notifyNoteTypeChanged`, `markSyncedNow`, `readLastSync`) into new `src/ui/hooks/glanceableEvents.ts`. `src/storage/indexed.ts` now statically imports from the new module — no cycle, no warning. `src/notes/save.ts` updated accordingly. `useGlanceable.ts` re-exports the helpers so existing static-import sites in 5+ UI components keep compiling unchanged. Build is now warning-free (verified 2026-05-01). |
| Skill file creation blocked | Re-attempted both `~/.claude/skills/ward-helper-dev/SKILL.md` and `repo/.claude/skills/ward-helper-dev/SKILL.md`. Sandbox-level `mkdir -p` for `.claude/skills/` is denied at the bash-tool layer (not a filesystem error — explicit "Permission to use Bash has been denied"), and `Write` tool to that path returns the same denial. The sandbox treats anything under `.claude/skills/` as out-of-policy. Reference content for ward-helper remains in repo `CLAUDE.md` + this `IMPROVEMENTS.md`; that's the discoverable path for any future Claude session. |
| Confirm authoritative facts for central skill (Round 4 will apply) | See "Central skill update — authoritative facts" section below. |

### Central skill update — authoritative facts (for Round 4)

The central `~/.claude/skills/audit-fix-deploy/SKILL.md` § F has stale numbers. Round 4 should update these specific values:

| Skill section | Stale value | **Authoritative value (R2 confirmed)** | Source of truth |
|---|---|---|---|
| § F.1 Gate 1 — bundle ceiling | `[ "$SIZE" -le 153600 ]` (150 kB) | **`[ "$SIZE" -le 184320 ]` (180 kB)** | `.github/workflows/ci.yml` line 26 + repo `CLAUDE.md` |
| § F.1 Gate 1 — comment | "main chunk ≤ 150 kB gzipped" | **"entry chunk ≤ 180 kB gzipped"** | same |
| § F.1 — `npm test` expectation | "expect 113+ passing, 1 skipped" | **"expect 668+ passing, 1 skipped, 60 files"** | `npm test 2>&1 \| tail -5` |
| § F.5 — bundle size baseline | "current: 132.99 kB gz, ceiling 153.6 kB" | **"current: ~154.4 kB gz, ceiling 184.32 kB (180 kB)"** | live build artifact |
| § F.5 — test count baseline | "currently 113/14 files + 1 skipped" | **"currently 668/60 files + 1 skipped"** | same |
| § F.6 — bundle-size budget command | `PCT=$(( SIZE * 100 / 153600 ))` | **`PCT=$(( SIZE * 100 / 184320 ))`** | same |
| § F.6 — bundle-size budget message | "% of 150 kB budget" | **"% of 180 kB budget"** | same |
| § F.6 — IMPROVEMENTS.md template | "% of 150 kB ceiling" | **"% of 180 kB ceiling"** | same |
| § F.7 — bundle constraint | "Never exceed 150 kB gzipped main chunk" | **"Never exceed 180 kB gzipped entry chunk (CI also caps total assets at 400 kB gz)"** | same |

**Live measurements taken 2026-05-01 on branch `claude/r2-deeper-dig-*`**:

```
entry chunk:  154,419 bytes (83.78% of 184,320-byte / 180 kB ceiling)
total assets: 164,347 bytes (40.12% of 409,600-byte / 400 kB ceiling)
test count:   668 passed + 1 skipped across 60 files
```

### Vite warning resolution

Before R2: `useGlanceable.ts (dynamically imported by indexed.ts) ... is also statically imported by HeaderStrip.tsx, RecentPatientsList.tsx, Capture.tsx, Review.tsx, save.ts ... so dynamic import will not move it into another chunk.`

After R2: clean build, no warning. Approach was to extract just the side-effect-free event emitters into a sibling module (`glanceableEvents.ts`) and convert `indexed.ts` from `await import('@/ui/hooks/useGlanceable')` to a synchronous `import { notifyNotesChanged } from '@/ui/hooks/glanceableEvents'`. Net code: +90 LOC in the new module (mostly comments), -10 LOC of try/catch dynamic-import boilerplate in `indexed.ts`. Bundle delta: +0.19 kB gz (negligible — the new module's contents were already statically reachable; it just moved).

### Deeper audit findings

| Surface | Result | Notes |
|---|---|---|
| `npm outdated` | 10 packages have newer majors available | All deliberate holds: react@18 (waiting on 19 ecosystem readiness), vite@5 (vitest 3 peer requirement), react-router-dom@6 (no new feature needed; v7 is a rewrite), typescript@5.9 (vitest 3.2 peer), @supabase/supabase-js@2.104→2.105 is a safe minor bump and could land in R3 [✅ SHIPPED in #35]. **No medium+ vulnerabilities introduced by these holds.** |
| `npm audit` | 2 moderate (esbuild ≤0.24.2 dev-server CORS, transitive via vite@5) | Vite 8 fixes; Vite 5 → 8 is a multi-major jump. Dev-only — never reaches the production bundle. Defer until vitest 4 lands (vite 8 + vitest 4 alignment). Risk: dev-server only; exposure is local-machine scope. |
| Bundle composition (top 10 chunks) | One large entry chunk (495 KB raw / 154.77 KB gz), 4 lazy chunks all < 11 KB raw | The entry chunk dominates. supabase-js + react + react-router are the big static imports. Lazy splitting Supabase (skill § F.6's biggest split candidate) would require deferring `getSupabase()` until first cloud-push attempt. Skipped this run (entry is 83.78% of ceiling — comfortable headroom). Earmarked for R3 if entry climbs past ~165 kB gz. |
| CSP audit | PASS, exact whitelist | `connect-src 'self' https://api.anthropic.com https://toranot.netlify.app https://*.supabase.co` — matches CLAUDE.md spec. No analytics, no widening since R1. **Now asserted in `tests/r2-deeper-dig.test.ts`** so any future widening fails CI before it ships. |
| Dead-code probe (10-min time-box) | No `ts-prune` or `knip` installed; spot-check via grep on `export function` showed no obvious dead exports | The codebase is small (~6k LOC) and tightly tree-shaken at build time; deeper dead-code analysis is low-yield until LOC doubles. |
| Coverage gaps | `vitest.config.ts` has no coverage provider configured | Can't run `--coverage`. Tests are written by hand against named contracts; coverage % is a noisy metric for this repo. **Skipped** — would need adding `@vitest/coverage-v8` and a config block, which is more change than R2 should ship. R3 candidate. |
| PHI-leak grep extended (`name_hebrew`, `dob`, `mrn`, `room_number` in `console.log` / `localStorage.setItem` / pattern reads) | PASS — zero hits | Beyond the Gate 4 check (`teudatZehut` / `bodyHebrew`), grepped for every PHI-shaped field name. Clean. |
| `URL.revokeObjectURL` audit | PASS — every `createObjectURL` in `src/` has a paired `revokeObjectURL` in the same file | Asserted as a regression-protection test (`tests/r2-deeper-dig.test.ts` — 2 cases: per-file pair check + global count check). Files with create+revoke pairs: `src/camera/session.ts`, `src/ui/screens/Census.tsx`. |
| PBKDF2 + AES-GCM constant-time | PASS | Web Crypto's `subtle.decrypt` does the auth-tag comparison internally in constant time; no `===` on derived secrets in any source file. The decryption path either resolves with cleartext or throws — no userland comparison. |
| Cost tracker review (`src/agent/costs.ts`) | PASS | Floating-point accumulation is fine at realistic scale (Number.MAX_SAFE_INTEGER ≈ 9e15; worst-case 1e9 turns ×1e6 tokens still fits). No off-by-one. **Hardening opportunity (R3)**: validate `usage.input_tokens >= 0 && Number.isFinite(...)` to defend against a malformed proxy response writing NaN into localStorage. Out of scope for R2 — hasn't been observed in production logs. [✅ SHIPPED in #35] |

### Test expansion

New file: `tests/r2-deeper-dig.test.ts` — 29 cases targeting surfaces R1's `cloud-payload-ciphertext-only.test.ts` did not cover:

| Group | Cases | What it protects |
|---|---|---|
| `crypto — wrong-password fails cleanly` | 2 | Decrypt with wrong passphrase / wrong-salt-derived key throws. Catches a hypothetical regression where a passphrase typo silently returns garbage. |
| `crypto — tampered ciphertext fails` | 3 | Single-byte ciphertext flip / IV flip / truncation each rejects on decrypt. AES-GCM auth-tag invariant. |
| `crypto — round-trip succeeds with right inputs` | 2 | Hebrew JSON round-trip + PBKDF2 ≥ 600k assertion. |
| `CSP regression` | 4 | `connect-src` whitelist exact-match, no analytics, `object-src 'none'`. Any CSP widening trips CI. |
| `wrapForChameleon — drug + dose + Hebrew narrative` | 6 | RLM after each English drug-name run before punctuation, LRM around pure-Latin parens, no spurious marks on pure-Hebrew-with-digits, drug-taper `>` notation preserved. |
| `extractJsonStrategy — pathological model outputs` | 6 | Empty / truncated / preamble+fence / nested-extra / unescaped-quote-in-string / fast-path. Locks in v1.21.x JSON-recovery behavior. |
| `URL.createObjectURL / revokeObjectURL invariant` | 2 | Per-file pair check + global count check across `src/` (skill § F.7 hard constraint). |
| `costs accumulator — long-session accuracy` | 4 | 100-turn float accumulation closed-form match, zero-token no-op, session-finalize attribution, un-finalized session = no leak. |

**Test count delta**: 639 → 668 passing (+29 across 8 groups); 59 → 60 files (+1); 1 skipped unchanged.

### Bundle telemetry (post-R2)

```
entry chunk:  154,419 bytes gz (83.78% of 184,320-byte ceiling — 29,901 bytes headroom)
total assets: 164,347 bytes gz (40.12% of 409,600-byte ceiling — 245,253 bytes headroom)
biggest non-entry chunk: run-*.js at 10,028 bytes raw / 4,151 bytes gz (the lazy-loaded note-orchestration path)
```

Composition is what you'd expect for this stack:
- `index-*.js` (entry) — react + react-dom + supabase-js + router + the synchronous app code.
- `History-*.js`, `NoteViewer-*.js`, `Census-*.js` — route-level lazy chunks (already split).
- `run-*.js` — the agent loop, lazy-loaded on first capture.

**No new chunking added in R2** — the entry chunk has 30 kB of headroom and adding manual chunks now would risk pessimizing cache behavior on a stable bundle. R3 should reconsider only if entry climbs past ~165 kB gz.

### Open R3+ candidates

1. **Lazy-load `@supabase/supabase-js`** until first cloud-push attempt — biggest realistic split. Safe to attempt because the cloud-push path is asynchronous already.
2. **Bump `@supabase/supabase-js` 2.104.1 → 2.105.1** — minor, low risk; defer until R3 to keep R2 surface minimal.
3. **Add `@vitest/coverage-v8`** so `npm run test -- --coverage` works. Useful for spotting genuinely-untested files; less useful for the noise.
4. **Cost-tracker hardening**: validate `usage.input_tokens` / `output_tokens` are non-negative finite numbers before accumulating. Defends against a malformed proxy response.
5. **Strict CSP regression**: assert connect-src whitelist exactly (R2 added "contains" assertions; R3 could add a `===` exact-list assertion once we're sure no transitional domain is needed).
6. **Vite 6/7 → 8 + Vitest 4 upgrade** — clears the 2 moderate `npm audit` esbuild advisories (dev-server only, but tracked). Multi-major jump; do as a focused PR with a separate test pass.
7. **Skill-file path resolution** — figure out why `Write` to `.claude/skills/` is sandbox-blocked in this environment. Either (a) the sandbox config could be amended to allow `repo/.claude/skills/`, or (b) the central skill needs a fallback path documented.

---

## 2026-05-01 — deep audit + test expansion (v1.32.0)

### Audit findings

| Gate | Result | Detail |
|---|---|---|
| Entry chunk ≤ 180 kB gz (CI authoritative) | PASS | 154,584 bytes — 83.87% of ceiling |
| Total JS ≤ 400 kB gz | PASS | 164,511 bytes — 40.16% of ceiling |
| CSP present in index.html | PASS | meta tag present |
| No analytics | PASS | grep clean |
| No `console.log` of teudatZehut/bodyHebrew | PASS | grep clean |
| No `localStorage.setItem` of bodyHebrew | PASS | grep clean |
| PBKDF2 = 600,000 | PASS | `src/crypto/pbkdf2.ts` |
| Toranot proxy in client | PASS | `src/agent/client.ts` PROXY_URL |
| No `@anthropic-ai/sdk` runtime dep | PASS | not in package.json |
| `compressImage` in capture flow | PASS | `src/ui/screens/Capture.tsx` |
| Supabase pinned to `krmlzwwelqvlfslwltol` | PASS | `src/storage/cloud.ts` + `src/auth/auth.ts` |
| No legacy JWT anon keys | PASS | grep clean across `src/`, `public/` |
| 4 skills synced into `public/skills/` | PASS | azma-ui, szmc-clinical-notes, szmc-interesting-cases, hebrew-medical-glossary |
| RLS scoped by `auth.uid()` | PASS | `supabase/migrations/0002_ward_helper_backup_rls_harden.sql` (no DELETE policy intentionally) |

**Severity counts**: 0 critical, 0 high, 0 medium, 0 low. Clean run.

### Surfaced tradeoff (per user-mandated working rule #1)

The `audit-fix-deploy` task scaffold cited a stale **150 kB entry-chunk ceiling**. The repo authoritative ceiling is **180 kB** — codified in `.github/workflows/ci.yml` (`184320` byte literal) and `CLAUDE.md`. The bundle (154,584 bytes gzipped) **passes** the actual CI gate but would fail the stale 150 kB literal. No artificial chunking was added — that would speculatively change runtime cache behavior to satisfy a scaffold check the repo retired. If the central `~/.claude/skills/audit-fix-deploy/SKILL.md` still says 150 kB, that's drift in the central skill, not the repo.

### Test expansion

New file: `tests/cloud-payload-ciphertext-only.test.ts` — 7 cases targeting the highest-value PHI safety contract that was not directly asserted before:

1. `pushBlob` upserts contain only allowlisted columns (ciphertext / iv / salt / meta / username), never plaintext PHI like name / teudatZehut / bodyHebrew / pmh / meds.
2. PHI sentinel strings never appear in the wire payload.
3. AES-GCM IV bytes are 12 bytes per row.
4. Encrypted ciphertext bytes do NOT contain plaintext UTF-8 (catches a no-op encrypt).
5. Two encrypts of the same payload produce different IVs and different ciphertexts.
6. `username` column is **omitted entirely** for guest pushes (never stored as `null` or `""`).
7. `username` column is trimmed before storage (no whitespace lands in DB).
8. `onConflict` upsert key is the composite `(user_id, blob_type, blob_id)`.

**Test count delta**: 633 → 640 passing (+7); 58 → 59 files (+1); 1 skipped unchanged (live eval needs `ANTHROPIC_API_KEY`).

### Skill drift

Source `~/.claude/skills/<name>/SKILL.md` ↔ public `public/skills/<name>/SKILL.md` — md5 equal for all four bundled skills. No drift.

### Skill creation tradeoff

Task spec asked for a new `~/.claude/skills/ward-helper-dev/SKILL.md`. Sandbox blocked write under both `~/.claude/skills/` and the repo's `.claude/skills/` (untracked). Equivalent ward-helper-dev reference content is consolidated in this repo's `CLAUDE.md` and `IMPROVEMENTS.md` so it lives in the codebase and is discoverable to any future Claude session via the existing CLAUDE.md auto-load path.

### Bundle budget telemetry

- Entry: 154,584 bytes (83.87% of 180 kB)
- Total: 164,511 bytes (40.16% of 400 kB)
- Headroom: 29,736 bytes (entry) / 245,089 bytes (total)
- Watch list: `react-router-dom` + `@supabase/supabase-js` are the heaviest single deps. If entry approaches 90% of ceiling, split them into a vendor chunk via `rollupOptions.output.manualChunks`.

### Supabase backup success rate

No telemetry currently shipped — `saveBoth` returns a `cloudSkippedReason` to the UI but it isn't aggregated. **Future**: if cloud failure rate ever needs to be tracked, the existing `cloudSkippedReason` field is the natural place to wire a counter into IndexedDB `settings` (PHI-free; counter only).

### Notes / followups

- Vite warning: `useGlanceable.ts` is dynamically imported by `indexed.ts` but statically imported by 5+ other modules — the dynamic import is therefore a no-op. Either drop the dynamic import or refactor those static importers if a chunking benefit is actually wanted. Not a blocker.
- `tests/extraction/eval.test.ts` remains the only skipped test, gated on `ANTHROPIC_API_KEY` env var. By design — runs against the live proxy in nightly CI when the secret is present.

## v1.41+ candidates (deferred from v1.40 brainstorm 2026-05-09)

### Cloud sync for `daySnapshots`
Opt-in toggle. Requires:
- Settings toggle "סנכרן היסטוריה לענן"
- New Supabase migration: extend `ALLOWED_BLOB_TYPES` to include `'day-snapshot'`
- Sync hook on `notifyDayArchived` event
- Orphan-canary check extension

### Use-yesterday's-note seed-draft flow runtime wiring (Task 3.8 sub-task B deferred)
The infrastructure is in place: `decideSeed`/`detectReadmit` orchestrator (`src/notes/seedFromYesterdaySoap.ts`), `buildSeedBlocks` SOAP prompt helper (`src/notes/orchestrate.ts`). What's missing:
- A "השתמש בהערת אתמול" button in `RecentPatientsList`
- A `Patient → ParseFields` seed builder
- `seedContext?: SeedDecision` arg threaded through `generateNote` → `buildPromptPrefix` → `buildSoapPromptPrefix`
- A sessionStorage contract or new route for the button → NoteEditor handoff

Concrete next step: decide on the route shape (new `/seed/:patientId` vs. extend NoteEditor with sessionStorage `seedContext`).
