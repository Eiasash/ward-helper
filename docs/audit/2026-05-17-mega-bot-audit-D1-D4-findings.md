# Mega-bot audit — D1–D4 structural findings + §5 pre-run gate lock

> **Plan (spec):** `docs/audit/2026-05-17-mega-bot-audit-plan.md` (REVISED, STEP 1 PASSED).
> **Bot under audit:** `scripts/ward-helper-mega-bot.mjs` + `scripts/lib/megaPersona.mjs`, `BOT_VERSION = 'v5.1.0'` (`megaPersona.mjs:70`). Repo HEAD: `c01158f`.
> **Lane:** terminal (executor). D1–D4 key-free/no-spend. D5 spend-authorized by user 2026-05-17; gated on this doc's §5 lock + D1–D4 completion.
> **Rule 7:** every "the bot does X" below is a read of `scripts/`, cited `file:line`. No asserted conclusions.

---

## D1 — Persona fidelity: **PASS** (one named soft gap)

- `DEFAULT_PERSONA_ROTATION` (`ward-helper-mega-bot.mjs:320-324`) = 10 unique keys; `:314-319` comment confirms the 3 pre-v4 duplicates (speedrunner-2/misclicker-2/multitasker-2) **dropped & replaced** by postCallResident/dictatingAttending/intermittentConnection. The "duplicates replaced" check is **TRUE, verified against the array**. (The `megaPersona.mjs:214` / `personasV4.mjs:5` comments are *accurate, not stale* — an earlier phantom-symbol read was a scan-scope error, corrected before asserting.)
- All 10 keys resolve to defined personas: 7 base (`megaPersona.mjs:160-216`) + 3 V4 (`personasV4.mjs:31+`), exact key match → **no dead/undefined persona**. Selector: `pickPersonaKeys()` (`ward-helper-mega-bot.mjs:326-335`).
- Interaction-style envelope (the correct axis per plan §D1): delay 60→12000ms, missclick 0.0→0.20, typingSpeed fast/normal/slow/**paste**, keyboard-only (keyboardWarrior), sleep/visibility (batterySaver), fatigue (postCallResident), network-as-behavior (intermittentConnection). RTL/Hebrew = unicodeChaos (`megaPersona.mjs:209-215`). Mobile = batterySaver + `chaos-edge-swipe` (`megaPersona.mjs:960`→`chaosV4.mjs:142`).
- **Named gap:** no persona models the **shared-ward-device handoff / second-user-mid-session** pattern (ward-helper is a shared-iPad PWA). Candidate false-negative on the multi-user→passphrase surface; compounds the D2 PHI gap. *Style-not-clinical-role is intentional per §D1 — stated so it isn't misread as under-coverage.*

## D2 — Surface coverage: **PASS on mapping; one CONFIRMED false-negative gap (plan-mandated)**

- `ACTION_MENU` (`megaPersona.mjs:933-944`) = 10 actions → map to 12 of 13 real screens (`src/ui/screens/`). **`Unlock.tsx` unmapped — no action drives it.**
- `CHAOS_MENU` (`megaPersona.mjs:949-972`) = exactly **12** (incl. `chaos-random-click` w5 + `chaos-sw-swap` w1, placeholder-`fn` strings, call-site-wrapped — D4 verified). Lifecycle surfaces all covered: SW-swap / idb-quota / clear-storage / visibility / midnight / memory-pressure / network / edge-swipe.
- **PHI surface — CONFIRMED FALSE-NEGATIVE GAP (highest severity):** PHI-at-rest is flag-gated (`localStorage.phi_encrypt_v7`, `src/storage/indexed.ts:107-117`, one-way). The bot never flips it; no ACTION drives Unlock/passphrase; `grep` for `unlock|encrypt|decrypt|crypto|sealed` across entrypoint+megaPersona+scenarioGen = **one comment only** (`megaPersona.mjs:578`), zero code paths. The gap is **"never reached," not "never stressed"** — the bot runs entirely flag-off/plaintext. **The entire PR-B2 encrypt/decrypt + one-passphrase cold-start surface (the very surface #176's NotFoundError lived on, the highest blast radius in the app) is structurally invisible to the bug-finder.** Compounds the D1 device-handoff gap. *Fix (an unlock/encrypted-mode scenario + harness flag) = new bot work = OUT OF SCOPE per kickoff → parked proposal in §"Parked", not built.*

## D3 — Bug-reporter trustworthiness: **MIXED**

- **Detector-trust (RED-before-GREEN): PARTIAL.** Calibrated known-bad detector exists only for the NotFoundError class (`KNOWN_ISSUE_TRIGGERS` `ward-helper-mega-bot.mjs:102`, regression-tested `tests/megaBotKnownIssueTrigger.test.ts`, green per #190). #175 (resetPassword silent-on-fake-token) and #177 (/today grid blowout) have **no dedicated fixture/detector** — generic detection only, *not* calibrated. RED-before-GREEN is structurally proven for #176 only; #175/#177 require D5 fixture-injection.
- **FP risks:** (a) chaos-infra HIGH (`page-closed-unrecoverable` `megaPersona.mjs:150`; `chaos-sw-swap/coverage` `:1259`) are **bot self-diagnostics, not app bugs** — D6 must bucket as infra or they inflate HIGH app-findings; (b) `ward-helper/bidi-audit/no-markers` HIGH (`:1222`) is candidate benign-HIGH if it fires on legitimately marker-free content — flag for D5; (c) **no cross-cycle dedup exists** (grep clean across all 4 files) → recurring findings re-reported every run (cross-run FP-inflation, mitigated only by D5's L102-baseline diff).
- **FN risk from dedup: NONE** (no dedup ⇒ nothing swallowed — the plan's specific FN concern is vacuously clean). Dominant FN is the **D2 PHI gap**, not here.
- **Dead bucket:** the plan/D6 "🤖-marked known-issue" bucket has **no producer** — no `🤖` emitted anywhere. D6 must bucket via armed-trigger + L102-diff only.

## D4 — Chaos calibration: **MIXED, decision-forcing for §5**

- **Placeholder-`fn` dispatch: PASS.** `runPersona` (`megaPersona.mjs` ~1147-1152) special-cases `'__needs_scenario_logBug__'` (random-click) and `'__needs_swap_telemetry__'` → `chaosSwapServiceWorker()` (`:572`); the other 10 use the standard signature. Neither special injector is a broken no-op.
- **Per-injector fire telemetry: FAIL 11/12.** Only `chaos-sw-swap` has dedicated counters (`tally.chaosSwapAttempts`:603 / `chaosSwapTimeouts`:627,653 / `chaosSwapInfraMisses`:654) **and** the >80% coverage alarm (`:1259`, #143). The other 11 share a single aggregate `tally.chaos++`; `scheduler.recordFire` is non-chaos only. No per-injector count, no fire-rate floor alarm for 11/12.
- **Consequence:** the plan's §5 VALID condition "*every CHAOS_MENU injector shows fire-count > 0 (D4)*" is **unverifiable for 11/12** — the report has no per-injector count, and `pickWeighted` lets a low-weight injector fire 0× in a scoped run undetected. Per the plan's own D4 caveat, a D5 "no finding" for those 11 is **uninterpretable (silent-no-op ≡ clean)**.

---

## §5 — PRE-RUN GATE LOCK (Rule 6 / L88 — frozen 2026-05-17, BEFORE any D5 run)

> **Provenance (honest, not a silent swap):** §5 in the plan delegated `[REVIEWER TO SET]` to terminal and references "(D4)". D4 (a mandated structural prerequisite) proved the original VALID condition unmeasurable for 11/12 injectors. This restatement is dated, reasoned, and locked **before** the run — the disciplined opposite of criterion-swap-by-silence (which is changing criteria *to rationalize a result*). Original §5 text is preserved in the plan doc as the audit trail.

**Scoped diagnostic run (per plan §5 / L55 — ≪$20, ≪6h):**
- Personas: **3** — `speedrunner` (fast/clean extreme), `misclicker` (error-prone extreme, 0.20), `unicodeChaos` (RTL/Hebrew). Exercises the style-envelope extremes + RTL on minimal budget. Set via `CONFIG.personaList` (exact knob verified at launch, Rule 7).
- Budget: cost cap well under $20; short duration. Exact env knobs (`WARD_BOT_*`, persona list, duration, cost cap) verified by reading the bot's CONFIG at launch and recorded in the run log — not assumed here.

**ABORT — output discarded, do not triage — if any:**
- bot exits non-zero before completion, OR
- 108-char key gate fails / auth gate exit 2, OR
- `tests/megaBotKnownIssueTrigger.test.ts` not green on the run's commit (re-verified at launch), OR
- fewer than **all 3 scoped personas** complete ≥1 full action loop, OR
- process cost cap hit before the planned record count (truncated, unrepresentative).

**VALID (proceed to triage) only if all:**
- all 3 scoped personas completed ≥1 full action loop, AND
- `chaos-sw-swap` shows fire-count > 0 in the report (the **only** injector with checkable per-injector telemetry — D4), AND
- the run report generated and parses, AND
- cost stayed under cap.

  *(The original "every injector fire-count>0" is replaced by "chaos-sw-swap fire-count>0" because D4 proved per-injector counts don't exist for the other 11. This is a narrower, honest, measurable gate — not a weakened one to pass a result.)*

**Interpretation contract (locked before run):**
- A finding is REAL iff: reproduces on clean non-chaos replay, OR matches a known-positive fixture (#176 only — #175/#177 are uncalibrated, treat as generic), OR the armed `KNOWN_ISSUE_TRIGGERS` self-announce fired.
- A finding is a PERSONA ARTIFACT iff: reproduces only under an unrealistic persona parameter, not on clean replay.
- **Absence of a finding from any of the 11 un-telemetered injectors = "UNINTERPRETABLE, not clean"** (D4). Only `chaos-sw-swap` absence is interpretable (it has a fire counter). Trustworthy negative signal this run = `chaos-sw-swap` + the armed NotFoundError trigger + generically-detected action bugs. Everything else: silent-no-op and clean are indistinguishable — say so, do not claim coverage.
- **[POST-LOCK CLARIFICATION — written 2026-05-17 20:43:24Z, AFTER the §5 lock but BEFORE any D5 run; append-only per Rule 6 / L88, the bullets above are unchanged and remain the frozen text.]** The bullet directly above made the symmetry implicit; stated explicitly here so the run cannot be read more generously than D4 licenses. This is a **tightening, not a criterion swap** — narrowing what counts as trustworthy negative signal, decided before the run, with the original preserved verbatim (the disciplined opposite of swap-by-silence, which *loosens* a criterion to rationalize a result). **An action-bug *absence* is exactly as uninterpretable as an un-telemetered injector's absence** unless the report shows that action actually fired: `pickWeighted` lets a low-weight action (e.g. `resetPasswordLanding` w2, `orthoCalcMath` w3) fire **0×** in a 3-persona scoped run, and a 0×-fired action with "no finding" is silent-no-op ≡ clean — the identical D4 failure mode applied to `ACTION_MENU` instead of `CHAOS_MENU`. "Generically-detected action bugs" is trustworthy negative signal **only for actions where the report's `byAction` table shows fire-count ≥ 1** (`writeReport` emits `byAction`, `ward-helper-mega-bot.mjs:515`). Restated trustworthy-negative set for this run: `chaos-sw-swap` (has a fire counter) **+** the armed NotFoundError self-announce **+** action bugs **only from actions `byAction` shows fired ≥ 1×**. Every other absence — any of the 11 un-telemetered injectors *or* any action with `byAction` count 0 — is UNINTERPRETABLE (silent-no-op indistinguishable from clean); do not claim coverage for it in D6.
- chaos-infra HIGH (`:150`, `:1259`) and `🤖`-bucket: D6 buckets chaos-infra as bot-infra (NOT app bug); `🤖` bucket is dead (no producer) — D6 uses armed-trigger + L102-diff only.

---

## Parked (OUT OF SCOPE per kickoff — report, do not build)

1. **PHI-surface scenario** (D2): add an unlock/passphrase + encrypted-mode (`phi_encrypt_v7`) ACTION + harness flag so the bug-finder reaches the highest-blast-radius surface. New bot work → its own kickoff.
2. **Per-injector chaos fire telemetry** (D4): extend the report with a per-`CHAOS_MENU`-injector fire-count table + a fire-rate floor alarm for all 12 (currently only chaos-sw-swap). Without it, 11/12 injectors' absences are permanently uninterpretable. New bot work → its own kickoff.
3. **Shared-device/second-user persona** (D1) + **#175/#177 calibrated fixtures** (D3): smaller, but still new bot work.

These three are the audit's substantive output: the bug-finder is sound on the surfaces it covers, but **systematically blind to the PHI surface and unmeasured on 11/12 chaos injectors** — a D5 run is still worth doing (sw-swap + armed-trigger + action-bug signal is real), provided its negatives are read per the locked interpretation contract, not as "clean."
