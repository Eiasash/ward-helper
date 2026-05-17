# Mega-bot audit plan — ward-helper persona-simulation bug-finder

> **Repo path on commit:** `docs/audit/2026-05-17-mega-bot-audit-plan.md`
> **Author lane:** web-Claude (plan content). **Reviewer lane:** terminal — STEP 1 fresh-eye review done against repo HEAD `e6928ce`.
> **Status:** REVISED — STEP 1 fresh-eye review **PASSED (conditional, now satisfied)**. 3 citation defects found by terminal and **applied by the reviewer lane** (terminal is the only repo-write lane; web sandbox has no PAT). Each fix was independently verified by terminal against `e6928ce` before applying — not taken on the author's word. Author-lane content is otherwise unchanged. D1–D4 executable (key-free); D5 key+spend-gated.
> **Provenance note (honest):** author≠reviewer independence was exercised at STEP 1 (the review caught the D3 wrong-file citation). The 3 corrections are non-substantive citation-accuracy fixes (filename / line-number / comment-pointer), repo-verified by the reviewer; they are not authored content. Substantive plan content remains web-Claude's.
> **Bot under audit:** `scripts/ward-helper-mega-bot.mjs` + `scripts/lib/megaPersona.mjs`, `BOT_VERSION = 'v5.1.0'` (megaPersona.mjs:70). Repo HEAD at drafting/review: `e6928ce` (#190).

---

## 0. Intent (user, verbatim)

> "This is auditing a bot system that simulates thru various profiles and personas real human usage of the website and reports bugs."

## 0a. Interpretation — PINNED ASSUMPTION (reviewer: ACCEPTED, not vetoed)

The audit **subject is the bot system itself** — not ward-helper-the-app. The question this audit answers:

> Does the persona simulation faithfully stand in for real ward-helper usage, and are the bot's bug reports trustworthy (low false-positive, adequate surface coverage / low false-negative)?

Ward-helper bugs surfaced by the run are a **byproduct**, triaged under D6 — not the audit's primary target. If the intent were "run the bot to find ward-helper bugs" (instrument, not subject), D1–D4 become optional and D5–D6 are the whole plan; the plan degrades gracefully either way. **Reviewer verdict:** the verbatim intent's grammatical object of "auditing" is *a bot system* → §0a is faithful to the actual words. ACCEPTED.

---

## 1. Scope

**In:** persona fidelity, action/chaos surface coverage, bug-reporter trustworthiness, chaos-injector calibration, one instrumented bot run, finding triage.

**Out:** rewriting the bot, adding personas/scenarios, ward-helper feature work, the parked H3 workstream (`docs/audit/2026-05-17-h3-cache-blob-opfs-kickoff.md` — opens only on its armed trigger, not here), Tier-2 PHI re-encryption.

**Success criterion:** a written verdict per dimension D1–D6, each backed by a runnable/readable artifact (test path, command, or `file:line`) — no asserted conclusions (Rule 7).

---

## 2. Constraints folded from horizon (user-scope MEMORY.md, relayed by terminal)

| Ref | Constraint | Effect on this plan |
|-----|-----------|--------------------|
| L88 | Rule-6: pass/fail decision tree written **before** any stochastic run; 8 anti-patterns incl. criterion-swap-by-silence | §5 decision tree is mandatory and frozen before STEP 3 |
| L101 | mega-bot is direct `api.anthropic.com` only — 108-char key gate, no dotenv, no proxy fallback, never echo key, brittle on stale key | STEP 3 prerequisite: user sets `CLAUDE_API_KEY` in terminal env; D5 abort-gate checks the 108-char gate |
| L55 | `CHAOS_COST_CAP_USD` ≈ $20 is **process-level** (all workers, one Node process), for a full ~6h / ~4500-record run | D5 recommends a scoped run first; cost/duration sized against run scope, not assumed |
| L102 | Prior run baseline 2026-05-17 (v1.46.1 crypto sound; findings → #176/#177/#175) | D5 compares the new run against this baseline; D3 uses #176/#177/#175 as known-positive fixtures |
| L106 | #176 NotFoundError closed (#187–#190); ARMED `KNOWN_ISSUE_TRIGGERS` self-announce live + regression-tested (`tests/megaBotKnownIssueTrigger.test.ts`) | D3 treats the armed trigger as **green and cited** — verify it fires in the run, do not re-litigate the mechanism |
| L71 | ⚠️ STALE — "v5 sequencing" tense is dead; `BOT_VERSION = v5.1.0`, v5 shipped | This is **not** a build plan. Do not inherit L71's tense. |
| L106 | ⚠️ OVERCLAIM — "runs on weekly-medical-pwa-qa schedule" is wrong; that schedule is Geri/IM/FM only | ward-helper mega-bot is authorization-gated, manual/on-demand, **no cadence**. Plan asserts no schedule. |

---

## 3. Audit dimensions

D1–D4 are **structural** — readable now, no API key, no spend. D5 is the run (key-gated). D6 consumes D5.

### D1 — Persona fidelity (key-free)

**Question:** do the personas span the real ward-helper interaction envelope?

- [ ] Enumerate the live persona roster: base set (`megaPersona.mjs:159`, `export const PERSONAS`) + V4 set (`personasV4.mjs`, imported :43). Confirm the exact count and that the 3 duplicates the comment at `megaPersona.mjs:214` documents replacing in `DEFAULT_PERSONA_ROTATION` were **actually** replaced — verify `DEFAULT_PERSONA_ROTATION` itself, not the comment; flag any dead/duplicate persona.
- [ ] Tabulate each persona's behavioral parameters (`missclickRate`, `typingSpeed`, `minDelay`/`maxDelay`). Verdict: do they span fast↔slow, clean↔error-prone, single↔multitask? Note that personas model **interaction style, not job role** — that is the correct axis for a bug-finder; assess on style coverage, not clinical-role coverage.
- [ ] Confirm RTL/Hebrew input is exercised (Dr. Unicode) and mobile/touch behavior is exercised (Dr. Battery-Saver + `chaos-edge-swipe`). Ward-helper is Hebrew-RTL and PWA — both must be represented.

**Output:** envelope-coverage table + named gaps (or "none").

### D2 — Surface coverage (key-free)

**Question:** does the action/chaos menu touch every critical ward-helper surface?

- [ ] Map `ACTION_MENU` (`megaPersona.mjs:933` — admission/soap/ortho/consult/history/settings/emailToSelf/morningRoundsPrep/orthoCalcMath/resetPasswordLanding) against ward-helper's real feature set.
- [ ] **Explicitly check the PHI surface.** The encrypt/decrypt + one-passphrase cold-start path (the entire PR-B2 workstream) is high-blast-radius. If no scenario drives encrypt/decrypt under realistic load, that is a named **false-negative gap** — record it; do not silently pass.
- [ ] Cross-check `CHAOS_MENU` (`megaPersona.mjs:949`, 12 injectors) covers the lifecycle surfaces: SW swap, IDB quota, storage clear, visibility/midnight rollover, memory pressure.

**Output:** surface×scenario coverage matrix + uncovered-surface list.

### D3 — Bug-reporter trustworthiness (key-free, with run cross-check in D5)

**Question:** does `logBug` → report produce real signal, not noise?

- [ ] **Detector-trust check (RED before GREEN):** confirm the bot goes RED on a known-bad input before any GREEN is trusted. Use #176/#177/#175 (L102) as known-positive fixtures — replay or fixture-inject and confirm each is reported at correct severity.
- [ ] **False-positive sweep:** the chaos-doctor-bot `c_accept` 18-FP incident is the disease class. Audit `logBug` severity assignment and the `chaos-infra` category for noise — does any path log HIGH for benign behavior?
- [ ] **Armed trigger:** `KNOWN_ISSUE_TRIGGERS` (`ward-helper-mega-bot.mjs:102` — the entrypoint, NOT `megaPersona.mjs`) self-announce — treat as green (regression-tested, `tests/megaBotKnownIssueTrigger.test.ts`). Verify only that it **fires in the live run** when a `NotFoundError` occurs and stays silent otherwise.
- [ ] Confirm cross-cycle dedup (🤖 marker) does not swallow a genuinely new finding.

**Output:** FP/FN verdict + severity-calibration notes.

### D4 — Chaos calibration (key-free)

**Question:** is each chaos injector actually firing, at the intended rate?

- [ ] For each of the 12 `CHAOS_MENU` injectors, confirm a fire-counter exists and is surfaced in the run report. **Absence of a bug from an injector is evidence only if the injector is proven armed** — an injector that silently no-ops looks identical to a clean surface.
- [ ] Confirm the `chaos-sw-swap` >80% end-of-run threshold alarm exists (per the #143 design) and check whether comparable threshold alarms exist for the other injectors; flag injectors with no fire-rate telemetry.

**Output:** per-injector armed/fire-rate table.

### D5 — Instrumented bot run (KEY-GATED — held)

- [ ] **Prerequisite (user):** `CLAUDE_API_KEY` set in terminal env (108-char gate, L101). Web-Claude never handles the key value.
- [ ] **Prerequisite (user):** explicit go on the run scope + spend (see §5).
- [ ] **Recommended scope:** a **scoped diagnostic run** first (subset of personas / capped record count, ≪ $20, ≪ 6h) to validate the D1–D4 structural conclusions against live behavior. Escalate to the full ~6h/~4500-record run (~$20, L55) only if the scoped run is clean and a production corpus is wanted.
- [ ] Run against the §5 decision tree. Compare findings against the L102 baseline.

### D6 — Triage (post-run)

- [ ] Bucket every finding: **real ward-helper bug** / **known issue** (armed-trigger or 🤖-marked) / **bot false positive** / **persona artifact** (reproducible only under unrealistic persona behavior — a D1/D3 finding, not a ward-helper bug).
- [ ] Real ward-helper bugs → issues. Bot FPs / persona artifacts → feed back into the D1/D3 verdict.

---

## 5. STEP 3 pass/fail decision tree (Rule 6 / L88 — FROZEN before run)

Written before launch. Not editable mid-run (criterion-swap-by-silence is a named anti-pattern).

**Run is ABORTED — output discarded, do not triage — if any:**
- bot exits non-zero before completion, OR
- 108-char key gate fails / auth gate returns exit 2, OR
- `tests/megaBotKnownIssueTrigger.test.ts` was not green on the run's commit, OR
- fewer than [REVIEWER TO SET — e.g. all] personas complete ≥1 full action loop, OR
- process cost cap is hit before the planned record count (run truncated, not representative).

**Run is VALID (proceed to triage) only if all:**
- every persona completed ≥1 full action loop, AND
- every `CHAOS_MENU` injector shows fire-count > 0 in the report (D4), AND
- the run report generated and parses, AND
- cost stayed under cap.

**A finding is REAL (not FP) if:**
- it reproduces on a clean non-chaos replay, OR
- it matches a known-positive fixture (#176/#177/#175), OR
- the armed `KNOWN_ISSUE_TRIGGERS` self-announce fired for it.

**A finding is a PERSONA ARTIFACT (not a ward-helper bug) if:**
- it reproduces only under a specific persona's unrealistic parameter (e.g. only at `missclickRate` no real user has) and not on clean replay.

> **[REVIEWER TO SET — persona-completion threshold]:** terminal owns the run env; sets this at D5 prep, before the run, in writing (Rule 6). Left unset deliberately by the author lane.

---

## 6. Prerequisites, gates, lane routing

| Item | Owner | State |
|------|-------|-------|
| Fresh-eye review of this plan | terminal (reviewer lane) | **DONE** — conditional PASS, 3 citation fixes applied + verified |
| `CLAUDE_API_KEY` in terminal env | user | absent — blocks D5 only |
| Run scope + spend authorization | user | pending — needed for D5 only |
| D1–D4 structural audit | terminal (executor) | **unblocked on this commit** — no key, no spend |

**Routing:** web-Claude authored; terminal fresh-eye-reviewed (caught + verified 3 citation defects) and committed the corrected doc (only repo-write lane). D1–D4 executable on commit. D5 holds until the user sets the key and authorizes scope/spend. D6 follows D5.

---

## 7. Out-of-scope (explicit)

Bot rewrites; new personas/scenarios; ward-helper feature changes; the parked H3 Cache/Blob/OPFS workstream; Tier-2 PHI re-encryption; any change to the armed-trigger mechanism (green, cited, not re-litigated).
