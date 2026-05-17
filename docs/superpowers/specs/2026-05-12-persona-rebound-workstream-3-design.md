# Persona rebound — mega-bot workstream #3

**Date:** 2026-05-12
**Target bot version:** v5.1.0 (no ward-helper version bump — bot tooling only)
**Predecessors:** PR #146 (SW-swap mechanism fix), PR #147 (evaluate-throw attribution), PR #150 (TargetClosedError short-circuit), `chaos-reports/ward-bot-mega/STAGE3_GATES_2026-05-11.md`, `chaos-reports/ward-bot-mega/STAGE3_LIVE_UPDATES_RERUN_2026-05-12.md`
**Status:** approved (brainstorming gate, advisor-vetted); ready for implementation plan

## 1. Problem

The mega-bot's Stage 3 re-run (2026-05-12) bailed at 40min of a planned 2h budget. **All 10 personas hit a page-death and exited via PR #150's short-circuit.** Pre-fix Stage 3 had ~244 retry-LOWs per persona; this re-run had 0 retry-loops (PR #150 worked perfectly). But the underlying page-death cause is unaddressed: sibling chaos (`chaos-back-mash` weight=7 at `scripts/lib/megaPersona.mjs:863`, `chaosEdgeSwipeBack` from `chaosV4.mjs:141`) navigates personas off ward-helper to a non-SW-eligible state; many ticks later, a content scenario tries to interact with the wrong page and `page.evaluate` throws `Target page, context or browser has been closed`.

**Consequence for Gate 1**: real SW-swap attempts (`real_total` in `STAGE3_LIVE_UPDATES_RERUN_2026-05-12.md`) reached only N=6 — far below the pre-committed N≥60 floor needed for the gate to be conclusive. **v5 SW-swap closure remains DEFERRED** until personas survive long enough.

This spec addresses persona survival. Out of scope: closing v5 itself (that's a follow-up Stage 3 re-run after this lands).

## 2. Approach — two-layer rebound

A persona that ends up off ward-helper rebounds to base via `page.goto(BASE_URL)`. The rebound fires in two places so it covers both the common case (off-base accumulates over several ticks before death) and the rare case (death races the next tick boundary):

- **Layer 1 — top-of-tick guard**: at the start of each iteration of the action loop, `page.url()` is compared against the persona's base URL. If off-base, `page.goto(BASE_URL)` rebounds before the action picker runs. Cheap (a string check on every tick), prevents the dominant cause (interacting with wrong-page in tick N+1 after back-mash in tick N).
- **Layer 2 — catch-block one-shot rebound**: in the existing `catch (err)` block at `scripts/lib/megaPersona.mjs:1084-1101`, the `isPageDeadError(err)` branch attempts `page.goto(BASE_URL)` ONCE before bailing. If rebound succeeds → resume the loop with `continue`. If rebound itself throws → bail with a NEW bug name `page-closed-unrecoverable` (distinct from today's `page-closed`).

Both layers fall through to PR #150's bail semantics if rebound fails. Failure modes preserve the existing short-circuit; the recovery is additive.

**Anchoring assumptions (verified, not speculated):**
- Bot uses anonymous Supabase auth via `signInAnonymously()` — no `auth_login_user` orchestration in `megaPersona.mjs` or `ward-helper-mega-bot.mjs`. Confirmed by grep returning zero hits for `auth_login_user|signIn|password|login`. Anon JWT sticky in localStorage survives `page.goto`, so rebound does NOT need an auth-restore step.
- Close type is consistently `Target page, context or browser has been closed` (10/10 of the 2026-05-12 page-closed HIGHs). The catch block's `isPageDeadError` regex (`scripts/lib/megaPersona.mjs:224`) matches this string. Confirmed by grep.
- The 10 page-closed HIGHs name **non-chaos scenarios** (admission/settings/consult/history/ortho/orthoCalcMath/morningRoundsPrep) — never `chaos-back-mash` itself. Translation: the chaos navigates, the persona survives ticks 76-1022 in off-base state, then a content scenario at tick N falls off the cliff. **Layer 1 is the load-bearing intervention** because it catches the off-base state at the NEXT tick boundary, before the cliff. Layer 2 is the safety net for the residual race.

## 3. Architecture

```
runPersona() in megaPersona.mjs
  ├─ const BASE_URL = url    (existing param, passed by ward-helper-mega-bot.mjs)
  ├─ const { origin: baseOrigin, pathname: basePathname } = new URL(BASE_URL)
  │
  ├─ initial page.goto(BASE_URL)    (line 997 — existing)
  │
  └─ while (Date.now() - t0 < durationMs):
       │
       ├─ ┌── LAYER 1 — top-of-tick guard ──┐
       │  │  try {                          │
       │  │    const cur = new URL(page.url()) │
       │  │    const offBase = cur.origin !== baseOrigin │
       │  │                 || !cur.pathname.startsWith(basePathname) │
       │  │    if (offBase) {               │
       │  │      tally.rebound_attempts++          (incremented BEFORE goto)
       │  │      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 }) │
       │  │      tally.rebound_successes++         (incremented AFTER goto resolves)
       │  │    }                            │
       │  │  } catch (err) {                │
       │  │    // page.url() or page.goto threw. Fall through silently; │
       │  │    // the next action's catch (Layer 2) will handle a dead context. │
       │  │    // attempt is recorded; success is not (intended split). │
       │  │  }                              │
       │  └─────────────────────────────────┘
       │
       ├─ persona action picker (existing)
       │
       ├─ try { result = await picked.fn(...) } catch (err) {
       │     ┌── LAYER 2 — catch-block rebound ──┐
       │     │  if (isPageDeadError(err)) {      │
       │     │    const recovered = await page.goto(BASE_URL, ...) │
       │     │                            .then(() => true)  │
       │     │                            .catch(() => false) │
       │     │    if (recovered) {               │
       │     │      tally.recoveries++           │
       │     │      logBug('LOW', 'chaos-infra', `${persona.name}/page-closed-recovered`, ...) │
       │     │      continue                    │
       │     │    }                              │
       │     │    logBug('HIGH', 'chaos-infra', `${persona.name}/page-closed-unrecoverable`, ...) │
       │     │    break                          │
       │     │  }                                │
       │     └──────────────────────────────────┘
       │     // ... existing non-page-dead handling unchanged
       │  }
       │
       └─ bidi-audit drain + battery-saver cycle (existing, unchanged)
```

No new files. Single-file modification: `scripts/lib/megaPersona.mjs`. Test file added: `tests/megaPersonaRebound.test.ts`.

## 4. Components

| File | Change | Est LoC |
|---|---|---|
| `scripts/lib/megaPersona.mjs` | Add `const { baseOrigin, basePathname } = ...` at top of `runPersona`. Add Layer 1 guard block at top of `while` loop (between line 1045-ish and the action picker). Modify the `catch (err)` block at lines 1084-1101: split `isPageDeadError` branch into "try rebound → continue OR bail with `page-closed-unrecoverable`." Initialize `tally.rebound_attempts`, `tally.rebound_successes`, `tally.recoveries` to 0. Retire old `page-closed` HIGH (current line 1093) — that path is now only reachable if Layer 2's rebound throws, and the new name is more precise. | ~40 |
| `tests/megaPersonaRebound.test.ts` (new) | Vitest fixture: mock `page.url()` to return `about:blank` on first call and `BASE_URL` after rebound. Assert `page.goto` was called with BASE_URL, `tally.rebounds === 1`. Second test: mock `page.url()` to throw `TargetClosedError` (simulating Layer 1's null case), assert Layer 1 swallows silently. Third test: mock action.fn to throw `Target closed`, mock `page.goto` to resolve, assert `tally.recoveries === 1` and no `page-closed-unrecoverable` bug. Fourth test: same but mock `page.goto` to reject, assert `page-closed-unrecoverable` HIGH fires and loop breaks. | ~80 |

**No changes to:**
- `scripts/lib/chaosV4.mjs` — chaos types stay as-is (realism preserved per advisor item #3).
- `scripts/lib/subBotsV4.mjs` — sub-bot signatures unchanged.
- `scripts/ward-helper-mega-bot.mjs` — orchestrator unchanged.
- Any chaos weights — `chaos-back-mash` weight=7 stays (realism reflects real doctor behavior).

## 5. Data flow — page state machine

```
                       chaos-back-mash
                     (or chaos-edge-swipe)
       on-base ──────────────────────────→ off-base
          ▲                                    │
          │                                    │ next tick
          │  Layer 1 guard fires               │
          └────────────────────────────────────┤
                                               │
                                               │ if Layer 1 misses
                                               │ (e.g., death races
                                               │  the next-tick check)
                                               ▼
                                          page-dead
                                               │
                                       Layer 2 attempt
                                               │
                            ┌──────────────────┴──────────────────┐
                            │                                     │
                       success                                  failure
                            │                                     │
                            ▼                                     ▼
                      back to on-base                      page-closed-
                      + LOW informational bug              unrecoverable HIGH
                                                              + break
```

The state machine has three terminal states: on-base (happy path), recovered (Layer 1 or Layer 2 succeeded), unrecoverable (Layer 2's goto threw — distinct from today's `page-closed`).

## 6. Error handling

| Failure | Handling | Telemetry |
|---|---|---|
| Layer 1: `page.url()` throws (dead context) | Caught silently. Action picker runs; the action will throw inside the existing try/catch; Layer 2 handles. | No bug emitted from Layer 1; Layer 2's bug stands. |
| Layer 1: `page.goto(BASE_URL)` throws | Caught silently — the dead-context case the catch was anticipating. Same fall-through to Layer 2 on next action. | No Layer 1 bug; Layer 2 bug if action fails. |
| Layer 1: `page.goto(BASE_URL)` times out | Counts as throw; same fall-through. Timeout 15s is conservative; production goto should complete in 2-5s. | Same as above. |
| Layer 2: `page.goto(BASE_URL)` succeeds | Loop continues with `continue`. | `tally.recoveries++`; `page-closed-recovered` LOW informational. |
| Layer 2: `page.goto(BASE_URL)` throws | Loop breaks (matches PR #150 short-circuit semantics). Throw is caught via `.then(() => true).catch(() => false)` wrapper (per §3), not propagated. | `page-closed-unrecoverable` HIGH. |
| Non-page-dead error in catch block | Existing path unchanged (LOW per-action exception + `softRecover`). | No change. |

## 7. Telemetry additions

Three new per-persona tally fields, surfaced in the JSONL timeline and aggregated by `scripts/analyze-mega-run.mjs`:

- `tally.rebound_attempts` — count of Layer 1 off-base detections that triggered a goto call. Incremented BEFORE the goto, so it captures both successful and failed reboundings. Sanity range: 0-200 per 2h persona run (at chaos-back-mash weight 7 of ~total-weight 100, expect ~30-50 ticks/h of back-mash; realistic rebound-attempt rate ~10-30% of ticks accounting for back-mash that doesn't actually exit history).
- `tally.rebound_successes` — count of Layer 1 goto calls that resolved without throwing. Incremented AFTER the goto resolves. Difference between attempts and successes signals dead-context state at rebound time.
- `tally.recoveries` — count of Layer 2 rebounds (race conditions where Layer 1 missed). Expected to be 0-3 per persona per run; high values indicate the racing-death class is more frequent than estimated and Layer 1 timing needs revisiting.

**Why two Layer-1 counters, not one:** the attempts/successes split distinguishes three states that conflate under a single counter:
1. High attempts + high successes = chaos navigates off-base often, rebound recovers fine (expected, healthy)
2. High attempts + low successes = page.goto unreliable; chaos producing dead-context state often (problem with chaos, not rebound)
3. Low attempts = chaos rarely navigates off-base. Compare against the pre-fix Stage 3 rate (~30-50/h per persona, derived from chaos-back-mash weight 7 of total weight ~100). If post-fix attempts are dramatically below the pre-fix rate, that's not "chaos rebalanced naturally" — that's the diagnostic signal that chaos broke silently in a different way (e.g., back-mash now no-ops because `page.goBack` semantics changed in Playwright, or chaos dispatch wired wrong). Investigate before declaring healthy.

Single-counter "rebounds" would conflate (1) and (2), masking the real diagnostic signal in G-D.

**Sanity bounds asserted by the analyzer:**
- If `rebound_attempts + recoveries > 0.5 × actionsThisCycle` → emit chaos-infra MEDIUM "rebound rate suspiciously high" (suggests chaos weights need rebalancing). Rate uses `rebound_attempts` not `rebound_successes` so the gate isn't gamed by a high-success-rate path.
- If `rebound_successes / max(1, rebound_attempts) < 0.5` AND `rebound_attempts >= 10` → emit chaos-infra MEDIUM "rebound success ratio degraded" (indicates page.goto failing on rebound; likely chaos-induced dead-context state more severe than expected).
- If `recoveries > 5` per persona → emit chaos-infra MEDIUM "Layer 2 fired more than expected" (suggests the racing-death class is real and Layer 1 needs tightening).

Three bounds are **prospective gates** per `feedback_pre_commit_diagnostic_gates.md`: they're written here before the post-fix bot run, not amendable after seeing data.

## 8. Testing strategy

Tests live in `tests/megaPersonaRebound.test.ts` and run under existing `npm test` (vitest). Four cases:

1. **Layer 1 happy path** — mock `page.url()` to return `about:blank` once then `BASE_URL`. Mock `page.goto` to resolve. Run the rebound check function in isolation. Assert `page.goto(BASE_URL, ...)` was called and `tally.rebounds === 1`.
2. **Layer 1 dead-context** — mock `page.url()` to throw `Error('Target page... has been closed')`. Run the rebound check function. Assert no throw escapes, `tally.rebounds === 0`, and the function returns cleanly so the action picker can run.
3. **Layer 2 happy path** — simulate the `catch (err)` flow with `err = Error('Target page, context or browser has been closed')`. Mock `page.goto` to resolve. Assert `tally.recoveries === 1`, `logBug('LOW', 'chaos-infra', .../page-closed-recovered', ...)` was called, and the loop continues (the test signals continuation via a returned status).
4. **Layer 2 unrecoverable** — same setup, but mock `page.goto` to reject. Assert `tally.recoveries === 0`, `logBug('HIGH', 'chaos-infra', .../page-closed-unrecoverable', ...)` was called, and the loop signals break.

**Refactoring required to enable testing**: the Layer 1 guard logic + Layer 2 rebound logic both extracted as small pure-async functions exported from `megaPersona.mjs` (e.g., `reboundIfOffBase(page, baseOrigin, basePathname, baseUrl, tally)` and `tryRecoverFromPageDeath(page, baseUrl, persona, picked, logBug, tally)`). These can be unit-tested without spinning up Playwright. The runPersona body calls them inline.

**Live-fire verification (manual, not CI):** after the test suite passes, run the bot in fixture mode against the live URL for 10 minutes:
```
WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed WARD_BOT_FIXTURE=1 WARD_BOT_DURATION_MS=600000 \
  CHAOS_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" \
  node scripts/ward-helper-mega-bot.mjs
```
Expected: zero `page-closed-unrecoverable` HIGHs across 5 personas (fixture mode); `tally.rebounds` non-zero on personas that hit back-mash; no persona bails before 10min wall.

## 9. Expected outcome (pre-committed gates)

Per `feedback_pre_commit_diagnostic_gates.md`: these gates are written before the post-fix Stage 3 run and not amendable after seeing data.

**After this lands + a 2h Stage 3 re-run:**

| Gate | Pre-commitment | If fails |
|---|---|---|
| **G-A (persona survival)** | ≥ 8/10 personas produce ≥100 ticks each over the run. Single criterion, tick-based. Time-based "survive to durationMs" was considered and rejected because durationMs is sensitive to chaos-network slowdowns that aren't related to rebound mechanism — tick count is the cleaner signal of "persona kept doing work." | Layer 1 is missing a class — investigate before re-running. Do NOT raise the threshold. |
| **G-B (real SW-swap N)** | `real_total ≥ 60` per the existing N-floor in `STAGE3_GATES_2026-05-11.md:109-114` | Persona-uptime is sufficient but action menu weights produce too few SW-swap attempts. Out of scope for this PR — own design conversation. |
| **G-C (no unrecoverable cascade)** | Total `page-closed-unrecoverable` HIGHs across all personas ≤ 3 over 2h | Layer 2's rebound is itself failing — context death is more severe than the close-error string suggested. Needs separate diagnosis. |
| **G-D (rebound rate sane)** | `(rebound_attempts + recoveries) / actionsThisCycle ≤ 0.5` per persona — uses attempts (not successes) so a high-failure rebound path can't game the gate. | Chaos weights conflict with rebound mechanism more than expected. Out of scope for this PR. |

G-A and G-C are the load-bearing gates for "this PR works." G-B is the downstream Gate 1 closure goal (after this PR). G-D is the early-warning sanity guard.

## 10. Caveats

- **Bidi-audit coverage post-rebound is intact, no gap.** Verified during spec self-review: `auditScript` is installed via `ctx.addInitScript(...)` at `megaPersona.mjs:975`, which Playwright re-fires on every navigation in the context. After `page.goto(BASE_URL)` the auditor reinstalls automatically on the fresh document; the findings buffer starts empty (correct — no clipboard writes have happened on the new page yet). The drain at `megaPersona.mjs:1110-1123` works correctly post-rebound: first tick returns `[]` because the buffer is empty, not because the auditor is missing. Originally written as a caveat as a precaution; verified false on inspection.
- **Tally counters reset per `runPersona` invocation**: `tally.rebound_attempts`, `tally.rebound_successes`, `tally.recoveries` are scoped to a single persona run, not aggregated across runs. The analyzer is responsible for cross-persona summation.
- **No assertion that BASE_URL ends with `/`**: `URL.pathname` comparison via `startsWith` handles trailing slash correctly (`/ward-helper/` startsWith `/ward-helper`). If BASE_URL ever lacks the trailing slash, the path comparison still works because both sides parse through `new URL()`.
- **Rebound rate counter does NOT distinguish back-mash-caused rebounds from edge-swipe-caused rebounds**: the rebound counter aggregates. If a regression makes one chaos type cause 100% rebounds, the counter doesn't tell us which. Per-chaos-type rebound attribution is a future enhancement, NOT in scope.

## 11. Out of scope (explicit non-goals)

Per advisor item #3 — these are deliberately rejected:

- **Persona-specific chaos exclusion**: e.g., "Dr. Methodical wouldn't mash back, exclude back-mash from her menu." Rejected because personas model real doctor patterns including misbehavior; teaching the bot to avoid chaos that breaks it teaches it to lie.
- **Reducing `chaos-back-mash` weight from 7 → lower**: weight reflects realism, not bot ergonomics. The right answer is "let the chaos fire as often as it would in real use, and survive it" — which is this design's whole thesis.
- **Per-chaos-type rebound attribution**: the tally counter doesn't split by which chaos caused the off-base. If diagnosis ever needs that split, it's a separate enhancement.
- **Closing v5 SW-swap chaos type as production-ready**: even with this fix, v5 closure requires a post-fix Stage 3 run that clears `STAGE3_GATES_2026-05-11.md`'s G-B (≥60 N). That run is a separate workstream after this PR lands.
- **Adding a third rebound layer (page-recreation via `context.newPage()`)**: explicitly rejected — the close-error-string evidence says `Target ... closed` (full context death), and a context.newPage() against a dead context throws same. If a future failure mode needs context recreation, it's a separate design.
- **Reducing the 15s timeout on Layer 1's goto**: 15s is conservative against slow-3G chaos. If goto takes >15s, the chaos itself is degrading the network heavily and the dead-context fall-through is correct behavior.

## 12. Reasoning provenance

This spec was written after a multi-step scope discovery. Brief audit trail for future-me:

- **Original prompt**: "Resume ward-helper encrypted blob runtime design" (per `~/repos/ward-helper/.audit_logs/NEXT_SESSION_PROMPT.md`).
- **Audit found**: the encrypted-blob runtime smoke layer (PRs #139-142) and the cachedUnlockBlob + canary recovery (v1.34.0) already shipped. The four candidate scopes named in the prompt file (recovery / key-lifetime / per-blob-key / app_users plaintext) were all closed, illusory, or speculative. No concrete driver.
- **User redirected scope**: "real test that picks up bugs like humans." Surfaced that the mega-bot already finds bugs (e.g., `ortho/no-bidi` was real and shipped in v1.45.0 via the bidi-refactor today), but `STAGE3_LIVE_UPDATES_RERUN_2026-05-12.md`'s workstream #3 was named as "the next blocker": persona survival/longevity so SW-swap accumulates N≥60.
- **User picked workstream #3** over my originally-proposed W2 (classifier amendment) + W3 (cron wiring) bundle.
- **Three approaches considered**: tick-boundary URL guard (A), per-chaos afterhook (B), bound back-mash to history depth (C). Settled on A per `feedback_design_gate_option_3_bias.md` (simpler is right in disciplined system extension).
- **Advisor sharpened**: verified auth (anon-only, no auth-restore needed) and close trigger (severe but delayed; Layer 1 is load-bearing, Layer 2 is residual safety net). Flagged persona/weight tweaks as deliberate non-goals. Suggested distinct bug names for recovered vs. unrecoverable.
- **This spec reflects the advisor-vetted Option A + Layer 2 safety net + non-goal section + telemetry sanity gates.**

Memory rules applied during writing:
- `feedback_view_source_before_cite.md`: every file:line citation was opened in this session (megaPersona.mjs lines 224/863/884/997/1091/1093, chaosV4.mjs lines 141-158, the two STAGE3 reports in full).
- `feedback_pre_commit_diagnostic_gates.md`: gates G-A through G-D written in §9 as pre-commitments, not amendable after the next bot run lands data.
- `feedback_existing_utility_never_called.md`: grepped for existing "navigate to base" helper in `scripts/lib/`; none found. The inline `page.goto(url, ...)` at megaPersona.mjs:997 is the only precedent. New utility added.

## 13. Release checklist

- bot version bumped: `BOT_VERSION = 'v5.1.0'` in `scripts/lib/megaPersona.mjs:65` (currently 'v5.0.0'). Per the same line's comment, version bumps are for telemetry-shape changes; this PR adds `rebounds` and `recoveries` per-tick counters → minor bump.
- NO `package.json` version bump, NO `public/sw.js` cache marker bump (this PR ships bot tooling only; ward-helper app unchanged).
- `npm run check && npm test && npm run build` — all green.
- PR with all 13 CI gates green (no direct push to main; ward-helper CLAUDE.md invariant).
- Branch: `claude/term-persona-rebound-workstream3-design` (then `claude/term-persona-rebound-workstream3-impl` for the implementation PR).
- After merge: NO `verify-deploy.sh` check needed (no app deploy).
- After merge: kick off Stage 3 re-run with the same 2h × $50 cap budget as the 2026-05-12 attempt. Read gates G-A through G-D against the new run.

## 14. Spec self-review

- **Placeholder scan**: no `TBD`, `TODO`, or `<...>` placeholders. All file:line citations are concrete and verified during writing.
- **Internal consistency**: §3 architecture diagram matches §4 components matches §5 state machine. §6 error handling matches §9 gates (G-C = unrecoverable cascade ≤3; matches §6 row "Layer 2 throws → break").
- **Scope check**: focused on one mechanism in one file plus its test. Should produce one ~120 LoC PR + one test file. Single-implementation-plan-sized.
- **Ambiguity check**: "off-base" defined precisely in §3 (origin OR pathname mismatch via URL parse, not string comparison). Rebound bug names are distinct strings (`page-closed-recovered` LOW vs `page-closed-unrecoverable` HIGH); the old `page-closed` HIGH is retired (§4 explicit).
- **Provenance check**: §12 names the scope-discovery audit trail and the memory rules applied. Future-me can verify the claims by re-reading the cited files.
- **Pre-commitment check**: §9 gates G-A through G-D are written before the data exists and not amendable after; this matches `feedback_pre_commit_diagnostic_gates.md` anti-pattern #1.
- **One inline correction during fresh-eyes review**: §10's "first post-rebound tick has no bidi-audit coverage" caveat was originally written as a precaution; verifying against `megaPersona.mjs:975` showed `auditScript` is installed via `ctx.addInitScript`, which Playwright re-fires on every navigation. Caveat replaced with the accurate state (auditor reinstalls automatically; buffer is correctly empty post-navigation). Per `feedback_view_source_before_cite.md`, even spec-time speculation about cited behavior should be verified — flagging this as one such moment.
- **Advisor pass (2026-05-12, post-self-review)**: three blocking issues caught + fixed inline before commit. (1) §3 Layer-1 telemetry was ambiguous between "rebound attempts" and "rebound successes" — split into two counters `rebound_attempts` (incremented before goto) and `rebound_successes` (incremented after goto resolves); G-D now uses `attempts` so a high-failure path can't game the gate. (2) §9 G-A was an OR-gate ("survive duration OR ≥100 ticks") — discipline anti-pattern per `feedback_pre_commit_diagnostic_gates.md`; collapsed to a single tick-based criterion. (3) §11 had a 30min-vs-2h contradiction with §1/§13 in a "non-goals" section — removed the line (no one was proposing to change the default; the apparent non-goal was protecting nothing). Plus two minor sharpening fixes: §6 row clarified ".catch wrapper, not propagated"; §10 restructured so the verified-fact headline leads.
- **Second advisor pass (2026-05-12, post-fixes)**: confirmed first-pass fixes landed cleanly. Two additional small tightenings applied: §7 state (3) "low attempts = not a problem" language was ambiguous — could mask a regression where chaos silently broke; tightened to compare against pre-fix ~30-50/h rate as the diagnostic-distinguishing reference. §3 ASCII telemetry comments used Unicode arrow characters (`←`); dogfooded the `auditChameleonRules` invariant by replacing with plain-text parenthetical annotations. §7 numbering inconsistency (numeric "three bounds" vs four-including-G-D) explicitly skipped per advisor "skip is fine" — cosmetic, doesn't affect a future reader's gate evaluation.
