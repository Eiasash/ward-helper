# Kickoff — NotFoundError repro-harness build (terminal lane)

> Paste this whole block into a fresh terminal Claude session. It encodes
> the role, the hard gates, and the conditional outcome paths so you don't
> improvise them mid-run.

---

You are **terminal Claude, executor lane**, working on the `ward-helper`
repo. Build the repro-harness specified in
`docs/audit/2026-05-17-notfounderror-repro-spec.md`. That spec is the
authority — read it in full first. This kickoff is the operational wrapper
around it: state verification, branch/lane, build shape, the discipline,
and the branching outcomes.

## STEP 0 — verify state before anything (do NOT trust this prompt)

Repo-state claims are citations. Before building, confirm against the live
filesystem and git — if any check fails, **STOP and report which**, do not
proceed:

1. `git fetch --all && git log -10 --oneline --all`
2. **PR 1 (stale-memo fix) is in main:** `src/storage/indexed.ts` `getDb()`
   has a `terminated` callback and `versionchange`/`close` listeners on the
   opened db; `package.json` version is `1.46.3`.
3. **PR 2 (amended spec) is in main:** the spec file's header says
   "Amended 2026-05-17" and H1 is the stale-memo hypothesis.
4. **Live:** `curl -s https://eiasash.github.io/ward-helper/sw.js | head -1`
   shows `ward-v1.46.3`, and the Pages workflow for HEAD is green.

If PR 1 or PR 2 is not merged, or live ≠ `ward-v1.46.3`: STOP. The
harness's R0 version-gate is meaningless without v1.46.3 deployed.

## Branch & lane

Branch `claude/term-notfounderror-harness`. PR to main, CI, squash-merge.
**Never push to main.** Don't touch shared-engine files or the other lane's
work. The web lane produced PR 1 + PR 2 + the amended spec; you build the
harness only.

## Build shape

A **callable Playwright harness script** under `scripts/`, alongside the
existing `scripts/ward-helper-bot-*.mjs`. NOT a vitest CI test — a browser
+ IDB chaos harness adds browser download and flake to the fast
deterministic gate (per the amended spec R2 and the
`rosterModalGridContainment.test.tsx` docstring). It is run manually /
on-dispatch, like the bots.

Implement R0–R4 from the spec as written. In particular:
- **R0 hard gate:** harness reads live `sw.js` `VERSION` and refuses to run
  unless it equals `EXPECT_WARD_VERSION`. A wrong-version run is a hard
  error, not a warning.
- **R1:** run both variants explicitly — chaos *between* clean iterations
  (probes H1 recovery) and chaos *interleaved with an in-flight scan*
  (probes H2). Bisect iteration count on whichever fires.
- **R2:** the IDB-op tracing shim is **harness-only** — it must never ship
  in app code (no-PHI-in-logs invariant). Capture `error.name` precisely:
  it is the H1 (`InvalidStateError`) vs H2 (`NotFoundError`) discriminator.

## The discipline — non-negotiable

This harness is itself a verification artifact. Four rules, learned the
hard way over the #177→#180 thread (rule 4 added 2026-05-17 after the
post-deploy smoke nearly shipped a console "clean" off an uninstrumented
read):

1. **Discriminate, don't just trigger.** A harness that reports "an
   unhandled rejection happened" without the R2 op-trace assigning it to
   H1/H2/H3/H4 is a correlate, not a finding. The deliverable is a *fault
   assignment*, not a re-triggered generic rejection.
2. **Watch it fail on a known-bad build before trusting a clean run.**
   The H1 stale-memo behavior is *known* and is fixed in v1.46.3. Before
   trusting any v1.46.3 result: check out a build with PR 1 reverted
   (pre-fix `indexed.ts`), bump it to a throwaway version, and prove the
   harness's H1 probe (delete DB from a 2nd context → next `getDb()` op
   fails) **fires RED** there. A harness that has only ever gone "clean"
   and was never shown RED on a known-bad build cannot be trusted clean.
   Honest scope: this calibrates the H1 probe only — H2/H3/H4 have no
   known-bad build to calibrate against; for those the harness's value is
   the op-trace that assigns whatever fires.
3. **Pre-commit pass/fail gates before the stochastic run.** Lock the
   determinism rule (R3) and the version gate (R0) before running, in
   writing. Post-hoc rationalization of a partial result is the failure
   mode.
4. **Re-arm and catch-all-verify console capture after EVERY
   navigate/reload (hard step, non-negotiable).** Rule 2 proves the
   detector *can* fire — a component contract. This proves it *stayed*
   armed across the run — a system invariant. Both individually green
   does NOT mean the run was valid (compositional-invariant gap). The
   console-capture buffer anchors at first-call *per page load*; every
   `navigate`/`reload` the harness performs across R0–R4 silently resets
   it, so a filtered (error-signature) read immediately after a reload
   returns "no messages" whether the page is genuinely clean **or merely
   uninstrumented** — an indistinguishable false all-clear, and the
   harness reloads on nearly every iteration. Therefore: after every
   navigation, *before* trusting any filtered read, issue a catch-all
   `.` read. **0 messages ⇒ buffer was reset → re-arm (one anchoring
   read) before any filtered read is meaningful; N messages ⇒ capture is
   live and a filtered read matching nothing is a true negative.** A
   harness that filtered-reads without this per-navigation proof emits a
   silent false GREEN at *every* reload — the same false all-clear rule
   2 guards against for the *build*, multiplied across every iteration
   of the *run*. Bake the catch-all-verify into the navigation helper
   itself so no R0–R4 code path can skip it.
   *Tool note:* the catch-all `.`-read + 0/N semantics above is the
   **claude-in-chrome MCP** idiom (per-page-load buffer). A **Playwright**
   harness has no such API — `page.on('console'|'pageerror')` listeners
   persist across navigation. The faithful Playwright realization of the
   same invariant: in the single `safeNavigate(page,url)` helper,
   idempotently attach console/pageerror/crash + an `unhandledrejection`
   capture to the page *before its first navigation*, then *after every*
   navigation assert capture liveness via a sentinel `console` round-trip
   (`page.evaluate(()=>console.debug(SENTINEL))` → assert the listener
   observed it within a timeout) and **fail-closed** if the sentinel is
   not seen. Same invariant — prove armed per navigation, never assume —
   different mechanism. No bare `page.goto`/`page.reload` anywhere in
   R0–R4; a harness self-test greps to enforce that.

## Conditional outcomes — follow the matching path

**PATH A — `NotFoundError` reproduces on v1.46.3** (≥3/10, or ~10/10 if
it's an H1-shaped path that survived the fix):
- Capture the full R2 trace. Since H1 is fixed in v1.46.3, a surviving
  repro is **not H1** — assign it to H2/H3/H4 from the op-trace.
- Do NOT write the root-cause fix in this PR. A deterministic repro
  *unlocks* a fix; the fix is its own PR with its own review. Deliver: the
  harness + a run-evidence doc + the fault assignment + a fix proposal.

**PATH B — `NotFoundError` does NOT reproduce on v1.46.3** after honest
effort (both R1 variants, bisected):
- **B1** — the harness's H1 probe *did* fire on the fix-reverted build but
  nothing fires on v1.46.3: log this as **"consistent with the cause being
  H1, fixed by v1.46.3"** — explicitly NOT "root cause confirmed."
  Absence-under-chaos is weak evidence; say so. Recommend keeping the
  harness as a callable regression probe.
- **B2** — you cannot drive *anything* above noise, including the H1 probe
  on the reverted build: the harness itself is not trustworthy. Report
  that honestly; do not ship a "clean" verdict from an uncalibrated
  harness.

**Defensive-wrap (spec R3)** — only if PATH A reproduces but the root
cause is genuinely unassignable even with the trace. Then it's a separate
PR labelled "mitigation, root cause unconfirmed", harness-informed (R2's
trace tells you which `error.name`s to treat as connection-lost).

## Done criteria

- Harness script committed under `scripts/`, R0-gated, runnable with
  `EXPECT_WARD_VERSION`.
- Calibration evidence: harness RED on the fix-reverted build (rule 2).
- A run-evidence doc under `docs/audit/2026-05-17-notfounderror-harness-run.md`
  with: per-run results, the PATH taken, and either the fault assignment
  (A) or the honest consistent-with / uncalibrated verdict (B).
- PR opened; CI green; nothing left merged-but-unverified.

## Scope boundary

No root-cause fix to the storage layer in this PR. No edits to app code
except the harness script. The v1.46.3 stale-memo fix already shipped and
is independently justified — it does not depend on this harness, and this
harness does not get to declare it "the NotFoundError fix" unless PATH A/B
evidence supports it.
