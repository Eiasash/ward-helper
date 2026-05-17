# Mega-bot audit — D5 scoped diagnostic run log

> **Governed by:** `docs/audit/2026-05-17-mega-bot-audit-D1-D4-findings.md` §5 PRE-RUN GATE LOCK (frozen) + the 2026-05-17 20:43:24Z post-lock symmetric clarification — both merged to `main` in #192 (`f1b6a42`) **before** this run, satisfying the "frozen gate must be in the audit trail before the run it governs" precondition.
> **Plan:** `docs/audit/2026-05-17-mega-bot-audit-plan.md` (#191, `c01158f`).
> **Rule 7:** every knob below is cited to the line of `scripts/ward-helper-mega-bot.mjs` that *defines* it — read at launch, not assumed.

---

## Run identity

| Field | Value |
|---|---|
| Run SHA (`git rev-parse HEAD` at launch) | `f1b6a42f3eeb0f7ebe17b369604ebbc1a7823e70` |
| Working tree at launch | clean (`git status --porcelain` empty) |
| `BOT_VERSION` | `v5.1.0` (`scripts/lib/megaPersona.mjs:70`) |
| Target URL | `https://eiasash.github.io/ward-helper/` (live prod — CONFIG default, `ward-helper-mega-bot.mjs:70`) |
| ABORT-precondition (§5): `tests/megaBotKnownIssueTrigger.test.ts` green **on this exact SHA** | **VERIFIED** — `vitest run`, 5/5 passed, clean tree at `f1b6a42` (not inherited from #190's earlier green) |

## Verified knobs (Rule 7 — read from CONFIG at launch)

| Env knob | Value set | Defining line | Why this value |
|---|---|---|---|
| `WARD_BOT_RUN_AUTHORIZED` | `yes-i-reviewed` | `:48` (`assertRunAuthorized`) | User authorized the scoped run |
| `CLAUDE_API_KEY` | (in-process, 108-char gate) | `:41`, `:57-59` | Never echoed; length verified == 108 before launch |
| `WARD_BOT_PERSONA_LIST` | `speedrunner,misclicker,unicodeChaos` | `:80` (overrides default rotation) | §5 lock: style-envelope extremes (fast/clean, error-prone 0.20, RTL/Hebrew) |
| `WARD_BOT_PERSONAS` | `3` | `:71` (`min(10,max(1,…))`) | One slot per scoped persona; `pickPersonaKeys` `:327-330` → exactly the 3 |
| `WARD_BOT_DURATION_MS` | `1800000` (30 min) | `:72` (default 1800000) | Sizing math below — makes the `chaos-sw-swap` w1 VALID gate reliably passable; 30 min ≪ the 6h full run |
| `CHAOS_COST_CAP_USD` | `8` | `:76` (code default 80) | Hard ceiling ≪ the $20 user authorization; ~4× headroom over expected ~$1–2 (3 scenario-gens), aborts cleanly if Opus balloons |
| `CHAOS_HEADLESS` | unset → headless | `:78` | Background run |
| `WARD_BOT_FIXTURE` | unset (real Opus run) | `:40` | A real diagnostic run, not the free hardcoded-scenario path |

## Sizing rationale (why 30 min is "scoped" yet gate-passable)

- Cost is bounded by **persona count, not duration**: scenario gen is 1 Opus call/persona at startup (`:384-407`); the action loop is pure Playwright, no per-iteration Opus. 3 personas ≈ 3 Opus calls total → ~$1–2 expected, `CHAOS_COST_CAP_USD=8` is a safe ceiling ≪ $20.
- `chaosRate = persona.extraChaosRate ?? 0.3` (`megaPersona.mjs:1127`). CHAOS_MENU total weight = 41 (`:949-972`); `chaos-sw-swap` weight 1 (`:972`). P(sw-swap | iteration) ≈ 0.3 × 1/41 ≈ 0.73%.
- 30 min, 3 parallel personas, ~6 s/iteration ≈ ~900 total iterations → expected `chaos-sw-swap` fires ≈ 6.6, P(zero) ≈ 0.0014. A 15-min run would risk a ~4% false-INVALID on my own gate. The bot's 30-min default is therefore the correct scoped duration.

## §5 gate (restated here for the post-run determination — text frozen in the findings doc, NOT editable now)

**ABORT (discard, do not triage) if any:** non-zero exit before completion; 108-char key gate fails / auth exit 2; regression test not green on run SHA (already verified green above); fewer than all 3 scoped personas complete ≥1 full action loop; cost cap hit before planned record count.

**VALID (proceed to D6) only if all:** all 3 personas completed ≥1 full action loop; `chaos-sw-swap` fire-count > 0 in the report; report generated & parses; cost under cap.

**Interpretation contract (locked + post-lock-clarified):** trustworthy negatives this run = `chaos-sw-swap` (fire counter) + armed NotFoundError trigger + action bugs **only from actions `byAction` shows fired ≥1×**. Every other absence (11 un-telemetered injectors OR `byAction==0` actions) = UNINTERPRETABLE, not clean — no coverage claim in D6.

---

## Post-run determination

**STATUS: COMPLETE — §5 VALID — D6 done.** Run exited code 0, 30.44 min wall, 2026-05-18 00:30:24. Report (gitignored): `chaos-reports/ward-bot-mega/wm-2026-05-17T20-53-25.md` (156 lines + 456-event timeline JSONL). Key facts extracted below because the raw report is not fresh-eye-visible via clone.

### §5 gate — applied verbatim against the report (text frozen in the D1–D4 findings doc, `main @ f1b6a42` / PR #192 — NOT edited here)

| §5 condition | Evidence (from the report) | Result |
|---|---|---|
| All 3 scoped personas ≥1 full action loop | Speedrunner **177** actions / Misclicker **85** / Unicode **194**; 0 errors; 4–13 self-recoveries | ✅ PASS |
| `chaos-sw-swap` fire-count > 0 | Action-coverage table: `chaos-sw-swap = 2` (the only D4-checkable injector) | ✅ PASS |
| Report generated & parses | Well-formed; all sections present | ✅ PASS |
| Cost under cap | $1.13 / $8 ($6.87 headroom; 3 Opus calls, no in-loop spend) | ✅ PASS |
| ABORT: non-zero exit | exit code 0 | not triggered |
| ABORT: key/auth gate | ran fully; scenario-gen executed | not triggered |
| ABORT: regression test not green on run SHA | verified green on `f1b6a42` (re-run, clean tree) | not triggered |
| ABORT: <3 personas complete | all 3 ran 85–194 loops | not triggered |
| ABORT: cost cap hit / truncated | $1.13≪$8, full 30.44 min | not triggered |

**VERDICT: §5 = VALID.** Proceed to D6 (done below). Run SHA governing this run = `f1b6a42` (the merged §5 gate).

### Run facts extracted from the gitignored report (for fresh-eye review without the raw file)

- 67 findings: **0 CRITICAL, 0 HIGH, 30 MEDIUM, 37 LOW**. Aggregate useful-actions/min 3.42 (healthy). Min-coverage scheduler: all 4 targets met.
- Action coverage — **every ACTION fired** (admission 75, soap 55, ortho 46, consult 32, settings 32, history 31, morningRoundsPrep 20, orthoCalcMath 15, emailToSelf 13, resetPasswordLanding 13) → the post-lock symmetric clause is satisfied for *all* actions (no `byAction==0` uninterpretable-action this run).
- **Grep negatives (load-bearing for D3):** zero `NotFoundError` → armed `KNOWN_ISSUE_TRIGGERS` correctly **silent** (the flag-off/plaintext app never produced the triggering condition — D2/eyeball-consistent; silent-when-it-should-be = trigger working). Zero `chaos-infra`, zero `bidi-audit/no-markers` → the two D3-flagged HIGH false-positive risks did **not** materialize (consistent with 0 HIGH). Zero `unlock/encrypt/phi` → D2's "PHI surface structurally unreached" re-corroborated by the run itself.

### Contract-mandated replay record (D6 verification — the locked REAL criterion requires "reproduces on clean non-chaos replay")

A first D6 draft inferred "2 candidate-real" without replay and invented an "infra-tinged" bucket — flagged by the transcript advisor as (i) a non-contract bucket laundered via the bot's reassuring "graceful" self-label (the symmetric form of the pick-count temptation) and (ii) an inferential shortcut on the load-bearing D3 headline. Corrected before this doc was committed:

- **Cluster A — clean non-chaos replay, DECISIVE.** `MorningArchivePrompt.tsx:35-42` `useEffect([])` reads `localStorage['ward-helper.lastArchivedDate']` **once at mount only** (intentional). Replay (set key to `2026-05-17` **before** a fresh mount → reload `?replayA=…` → observe): `bannerInDOM=true`, `archiveButtonInDOM=true` — **banner renders correctly**. The app is correct; the bot set the key *mid-session* (after mount) and expected a retroactive re-render. → **A = PERSONA-ARTIFACT** (reproduces only under the bot's unrealistic mid-session setup, not on clean replay — the exact locked criterion). Filed as bot defect **#194**.
- **Cluster B — source verification, DECISIVE (clean replay = sending a real email = explicit-permission + PHI-carve-out, so NOT done; source read substitutes, no outward action).** `Consult.tsx:225-244 emailNote()` has **no in-flight `sending` state** (await edge-fn → success flips `emailedAt` ✓, error `setError`) → genuine UX gap = **REAL**. `Save.tsx:85-97 onSendEmail()` IS wired (`sending/sent/error`) → "no status" there is observation-artifact. → **B = 1 confirmed distinct REAL** (Consult path). Filed **#193**. Exact real-vs-observation split of the ~11 raw instances is bounded-not-resolved (depends on the bot's emailToSelf target screen) — honest residual, proportionate stop.

### D6 triage — buckets per the frozen + post-lock-clarified interpretation contract (4 buckets ONLY: REAL / PERSONA-ARTIFACT / UNINTERPRETABLE-ABSENCE / chaos-infra)

67 raw flags → **6 clusters**:

| Cluster | Sev | ~N | Bucket | Rationale (contract-verbatim, replay-grounded) |
|---|---|---|---|---|
| **A** `morningRounds/banner-missing` | MED | ~19 | **PERSONA-ARTIFACT** | Clean replay: app renders banner correctly; bot's mid-session-write vs mount-gated-read is the flaw. Bot defect **#194**. NOT a ward-helper bug. |
| **B** `emailToSelf/silent-fail` | MED | ~11 | **REAL (1 distinct) + observation-artifact** | Source-verified: `Consult.tsx:225-244` no in-flight status = REAL (**#193**); `Save.tsx:85-97` wired = artifact. |
| **C** `admission/no-gen` | LOW | ~26 | **UNCLASSIFIED — meets no locked-bucket criterion** | Not chaos-infra (`:150`/`:1259` never fired — grep). Not replay-confirmed REAL, not artifact-confirmed. Clean replay scope-constrained (re-loads the shared clinical proxy + needs the extract path). Owned as not-fitting the 4 buckets — NOT relabelled "infra-tinged" (removed: that was criterion-drift via the bot's "graceful" label). |
| **D** `admission/extract-error` ("graceful") | LOW | tail | **UNCLASSIFIED — same as C** | Bot self-labelling "graceful" is honest *bot behaviour* (a D3 positive on labelling) but is **not** a contract bucket; the finding's contract status is unclassified-pending-(scope-constrained)-replay. |
| **E** `emailToSelf/no-save-btn` | LOW | few | **PERSONA-ARTIFACT (low conf)** | Speedrunner fast-extreme race. Bot LOW-rated. |
| **F** `admission/gen-blocked: missclick` | LOW | few | **PERSONA-ARTIFACT (definitional)** | "missclick" *is* Misclicker's injected 0.20 param. Bot correctly LOW-rated. **D3 positive.** |

**Contract-fidelity guard (web review check #1):** the report's Action-coverage table shows the 11 non-sw-swap chaos injectors were *selected* (e.g. chaos-idb-quota 4×). Selection ≠ execution confirmation; per the frozen D4 finding + locked contract, silent-no-op (picked-but-effect-didn't-run) is undetectable by a pick count. Contract applied **verbatim**: absence-of-findings from those 11 remains **UNINTERPRETABLE, not "clean."** (Clusters C/D `UNCLASSIFIED` is the *same* discipline applied to myself — a reassuring label does not earn a frozen bucket.)

### D3 trustworthiness verdict — THE HEADLINE (D6-brief check #4, completeness; revised post-replay)

**67 raw flags → 1 source-confirmed distinct REAL ward-helper finding** (B/Consult in-flight email status, #193). My first-draft "2 candidate-real" was **wrong**: cluster A (~19 MED, the larger candidate) was **knocked out by clean replay → PERSONA-ARTIFACT**, and is itself a **named, fixable bot defect** (#194: morningRoundsPrep sub-bot mid-session-write vs mount-gated-read → ~19 false MEDIUM per scoped run). C/D LOW tail (~26+) is **UNCLASSIFIED**, not "clean," not "infra-tinged."

- **Zero false CRITICAL/HIGH; the `c_accept`-18-FP severity-inflation disease class did NOT recur** (genuine D3 positive — held).
- **#4 positive (advisor strengthening):** per the locked+clarified contract, action-absence is interpretable when `byAction>0`. **7 of 10 ACTIONs fired ≥13× with zero findings → interpretable-CLEAN**: soap 55, ortho 46, consult 32, settings 32, history 31, orthoCalcMath 15, resetPasswordLanding 13 (the last notable — lowest-weight w2 action, forced clean by the min-coverage scheduler). morningRoundsPrep's surface is *also* app-clean (replay-proven); its flags were bot-artifact. So the app is clean on 8/10 action surfaces; the only real app finding is B (Consult email status).
- **Honest D3 verdict:** the bug-reporter has **correct severity discipline** (0 inflation, honest LOW-labelling of graceful degradation, doesn't mistake its own missclick chaos for app bugs) and **surfaces real signal** (1 source-confirmed UX gap), **but carries one systematic false-positive-generating harness defect** (#194) producing ~19 false MEDIUM/run from a single sub-bot. Trustworthy on *severity*; **not yet trustworthy on the morningRoundsPrep sub-bot's positive/negative construction.** This is the commissioned answer — a concrete, fixable bot defect, not a vague "trustworthy."

### Per-dimension verdicts D1–D5 (completeness — full commissioned answer, plan §0a)

- **D1 persona fidelity — PASS** (3 style-extremes exercised the envelope; 0 errors, healthy useful/min; named soft gap unchanged).
- **D2 surface coverage — PASS + CONFIRMED PHI false-negative gap, RE-CORROBORATED** (zero unlock/encrypt/NotFoundError; `Unlock.tsx` never reached — structurally predicted + eyeball-witnessed + run-confirmed).
- **D3 bug-reporter trustworthiness — TRUSTWORTHY ON SEVERITY, ONE NAMED HARNESS-FP DEFECT** (#194): no inflation, honest labels, 1 real finding (#193), armed trigger correctly silent — *minus* the morningRoundsPrep mid-session-write false-positive cluster. More precise than the first draft's unqualified "trustworthy."
- **D4 chaos calibration — MIXED, UNCHANGED**: only `chaos-sw-swap` interpretable (fired 2×); other 11 absences UNINTERPRETABLE (pick-count ≠ execution).
- **D5 instrumented run — VALID, clean**: 30.44 min, $1.13/$8, 0C/0H, gate passed, no abort.
- **Net (commissioned answer):** a simulator that is **severity-honest and clean on 8/10 action surfaces**, surfaced **1 real ward-helper UX bug (#193)**, but has **one fixable false-positive harness defect (#194)** and **two pre-known structural blind spots re-confirmed not closed** (PHI surface — D2; 11/12 chaos injectors — D4). The 3 parked OUT-OF-SCOPE proposals + #194 are the audit's substantive forward output.

### Scope discipline (kickoff) — issues filed (reporting = in scope; fixing = OUT OF SCOPE)

- **#193** ward-helper — Consult `emailNote` no in-flight status (REAL UX, B).
- **#194** mega-bot — morningRoundsPrep sub-bot harness false-positive (D3 bot defect, A).
- **#195** ward-helper — PWA manifest `icon-192.png` resource-size mismatch (real low-sev, eyeball).
- `dispatch.ts` 30s client-timeout possibly too tight for heavy Opus extracts — **observation, not filed** (judgement call, not a clear bug; recorded here, not chased — proportionality).
- The two replays (A clean-replay, B source-read) were the **contract-mandated D6 REAL-criterion verification**, in scope for D6 — not session expansion.

---

## Eyeball-with-DevTools (parallel human-observable channel, live, DURING the D5 run)

> Per the `feedback_eyeball_console_ritual.md` ritual — a separate real-Chrome session on `https://eiasash.github.io/ward-helper/` while the headless bot exercises the same live site. **Disjoint by design:** this session observes only the idle/cold-start path (no login, no patient, no PHI entry, no clicks into flows); the bot's headless Playwright exercises the authenticated/action flows. This is NOT the §5 post-run determination — it is a D6 input. Buckets mirror the locked interpretation contract.
>
> **Cross-checked ground truth before trusting any read** (the stale-context caveat): tab-context line lagged twice, but in-page `location.href` + `readyState:"complete"` + `<html lang="he" dir="rtl">` + React root (5 children) confirmed the live page actually loaded. Observations below are post-verification.

**(1) VERIFIED SIGNAL — corroborates the D2 CONFIRMED PHI false-negative gap (strengthens an existing finding; NOT a new bug):**
- `localStorage.phi_encrypt_v7` = **`null`** on live prod (read directly, not paraphrased). The D1–D4 doc states PHI-at-rest is one-way-gated on this flag (`src/storage/indexed.ts:107-117`) and "the bot never flips it." Live witness: the flag is unset → app runs **plaintext / encryption-OFF on a clean cold start**.
- Boot telemetry: `boot.storagePersist {granted:true}` · `boot.loadPersistedPwd {hadPersisted:false}` · `boot.phiUnlock {kind:"no-user"}` — cold start renders the **main capture screen, never the Unlock/passphrase screen**.
- Network: `phi-*.js`, `auth-*.js`, `indexed-*.js`, `xor-*.js` (crypto) all ship & load `GET 200` — the PHI/crypto code is **present but bypassed**, the exact "structurally invisible, not absent" shape D2 asserted. Inference → witnessed.

**(2) INSTRUMENT ARTIFACT — explicitly NOT a ward-helper finding:**
- Console: 5× identical `"A listener indicated an asynchronous response by returning true, but the message channel closed"`, `[EXCEPTION]` at `:0:0`, **no app stack frame** — the textbook Chrome-extension `chrome.runtime.onMessage` artifact, almost certainly the claude-in-chrome extension (the observer) itself. Bucketed as observer contamination, same discipline as the D3 chaos-infra self-diagnostic bucket. Net: console **clean of app errors** (no CSP, no `NotFoundError`/#176 class, no Supabase/auth/IDB error, no raw-error bleed).

**(3) CLEAN on the observed path / NO COVERAGE CLAIM beyond it:**
- 26 network entries (1 `data:` URI noise) → 13 http(s), **all `GET 200`**, **zero POSTs**, **zero ≥4xx**, no CSP-blocked fetch. So the duplicate-POST class (v1.39.8 lineage) is absent **on idle cold-start only** — the authenticated POST paths were deliberately not exercised here, so per the locked contract this is "absence on the observed path," NOT a coverage claim for the auth/sync POST surface.

**(4) INCIDENTAL OBSERVATIONS (for D6 awareness, not bugs):**
- `ward-helper.debugPanel` + `ward-helper.debugPanelCollapsed` in localStorage explain the on-prod debug overlay — a localStorage-gated dev affordance (same family as the `ward-helper.bidiAudit` toggle), this profile had it enabled; not default-on prod exposure.
- Sibling-app keys (`samega`, `samega_uid`, `mishpacha_mega`, `shlav_seen_help`) coexist in localStorage → all `eiasash.github.io/*` medical PWAs share one localStorage origin. A cross-app data-origin observation worth a D6 note; not a ward-helper bug. (Only key *names*/flags were read — no values, no IndexedDB, no PHI.)

---

## Escalation episode + cross-lane correction (2026-05-18, append-only — recorded WITH its disproof)

A user-shared eyeball screenshot showed a manual extract failing: `POST toranot.netlify.app/api/claude` → `dispatch.ts:192/212/196` 30s client-timeout. Terminal formed the hypothesis *"the 3-persona D5 run is saturating the shared free-tier proxy the clinical suite depends on"* and escalated it to the user as a **blocking abort decision** (recommended abort).

**That escalation was mis-framed.** The premise was an unverified, low-prior hypothesis presented as decision-forcing. Web-lane Claude pushed back; terminal then verified **independently from its own lane** (not adopting web's narration):

- Proxy probes *during the run*: `/ → 200/208ms`, `/api/claude → 405/61ms,64ms`, `OPTIONS → 204/60ms`, ward-helper `200/342ms`. Proxy healthy/fast/consistent → **saturation hypothesis disproven**.
- Bot interim: healthy, 0C/0H throughout, cost frozen $1.13 → bot not eating systematic proxy timeouts (consistent with the fast probes).

**Resolution: NO ABORT.** The user's timeout was a transient (30s client cap vs a heavy Opus extract ± momentary upstream blip); ward-helper *handled it correctly* (specific Hebrew error + recovery — not a code bug). The frozen §5/D6 contract is precisely the machinery for bucketing any infra-tinged findings; aborting would bypass machinery pre-merged for this exact case.

**Process lesson (the real defect):** a single external GET/HEAD is a *diagnostic, not load* — the eyeball no-extra-load rule (correct for clicking app flows) was over-applied to forbid the one cheap probe that resolves the premise, which is what turned "diagnose it" into "escalate it." Run the cheap external diagnostic *before* escalating a load-bearing hypothesis to a user decision; never frame an unestablished premise as "blocking/irreversible/your call." Both lanes' run-end inferences ("D6 value gone" / "findings probably real") are held to the same standard: neither pre-judges what the frozen contract adjudicates at exit.

**Two residual REAL items (parked, not chased — orthogonal to this audit):**
1. `icon-192.png` PWA-manifest resource-size mismatch — genuine low-severity ward-helper bug → carry into D6 findings.
2. The `dispatch.ts` 30s client timeout may be too tight for heavy Opus-4-7 extracts on long clinical docs — real, actionable ward-helper/proxy observation → file separately; do NOT expand this audit session.

---

## D6 build brief — binding requirements (2026-05-18, pre-run-exit, append-only)

> Cross-lane review checks folded in **before** D6 is authored so they gate the deliverable, not surprise it at review. Checks 1–3 are integrity (is D6 *honest*); check 4 is completeness (does D6 *deliver the commissioned verdict*) — raised by the filesystem-grounded reviewer lane before the PR.

D6 (and the D5+D6 results PR) MUST satisfy all four, and will be reviewed against the committed bytes at the head SHA (the same-name-collision discriminator — reviewer waits for the SHA, reviews the clone, not a relayed copy):

1. **Contract fidelity:** D6's bucketing (real / persona-artifact / chaos-infra / uninterpretable-absence) applies the frozen + post-lock-clarified interpretation contract verbatim — does NOT quietly relax it to let the run "pass."
2. **Gate-text match:** the §5 gate D6 applies is the text actually in `main @ f1b6a42` (PR #192), not a drifted/same-named copy. Cite the SHA.
3. **Honest trail:** the escalation episode is recorded with its disproof, append-only, no silent rewrite (this section + the one above are that record).
4. **Completeness — per-dimension verdicts, not a bucketed pile (plan §0a):** D6 must synthesize the audit's commissioned answer — *is the bot a faithful simulator; are its bug reports trustworthy* — as explicit per-dimension verdicts D1–D5. Specifically: the real / persona-artifact / chaos-infra split of the run's findings (~41, all M/L, sustained 0C/0H) **is the D3 bug-reporter-trustworthiness rate** — D6 must state that number and the D3 verdict, not stop at correct bookkeeping. A run that bucketed every finding correctly but never stepped back to the headline verdict would be correct and still under-deliver.
