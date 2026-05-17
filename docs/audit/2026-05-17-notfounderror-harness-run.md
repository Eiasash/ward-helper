# Run evidence — #176 NotFoundError repro-harness (terminal lane)

Spec: `docs/audit/2026-05-17-notfounderror-repro-spec.md` (AMENDED).
Kickoff: the terminal-lane harness kickoff (R0–R4 + the 4 discipline rules).
Harness: `scripts/ward-helper-notfounderror-harness.mjs` + `scripts/lib/{harnessNav,idbTraceShim}.mjs`.
Date: 2026-05-17. Lane: `claude/term-notfounderror-harness`.

## Verdict — PATH B1 (calibrated)

> **Consistent with the 2026-05-17 mega-bot fault being H1 (stale
> connection memo), which v1.46.3 / PR #182 fixes. NOT "root cause
> confirmed."** Absence-under-chaos on the fixed build is weak evidence
> and is recorded as such. The calibrated H1 probe deterministically
> reproduces the *H1 deadlock mechanism* and proves PR #182 eliminates
> it; it does **not** reproduce the literal `NotFoundError` DOMException
> string the mega-bot logged (see "Scope & honest limits").

This satisfies kickoff PATH B1: the H1 probe fired RED on the
fix-reverted build; nothing fires on v1.46.3.

## R0 — version gate

Hard gate enforced: harness fetches `${HARNESS_BASE_URL}sw.js`, refuses
to run unless the `ward-v…` line equals `EXPECT_WARD_VERSION`. Both runs
below passed R0 (`ward-v1.46.3` live; `ward-v1.46.3-cal1` local preview).
A wrong-version run is a hard error, not a warning.

## R1 variant (a) — the deterministic H1 probe

Mechanism (mirrors `tests/idbStaleConnectionInvalidation.test.ts`, the
calibration authority): boot the live app (its `getDb()` memo holds an
open connection) → seed once → issue `indexedDB.deleteDatabase('ward-helper')`
from a fresh same-page script context → classify.
- `blocked` / `timeout` ⇒ the app's connection has no `versionchange`
  handler, never closes, blocks the delete forever — **pre-fix H1
  deadlock** → RED.
- `completed` ⇒ PR #182's `versionchange → close()` released it → GREEN.

Same-page (not a 2nd tab) is mechanically identical for what PR #182
changed: `deleteDatabase` fires `versionchange` on every open connection
in the agent cluster regardless of issuer.

Variant (b) (chaos interleaved with an in-flight scan — the H2 racy
path) is **NOT built here** — named follow-up.

## Results (10 iterations each, R3_H1_FLOOR = 10, pre-committed)

| Build | `indexed.ts` lifecycle handlers | Outcomes | Uniform? | Verdict |
|---|---|---|---|---|
| live `ward-v1.46.3` (PR #182 merged) | present | 10/10 `completed` | yes | GREEN |
| `ward-v1.46.3-cal1` (#182 reverted, local `vite preview`) | absent (genuine pre-fix) | 1× `blocked`, 9× `timeout` (10/10) | yes | RED |

The cross-build asymmetry **uniform-GREEN vs uniform-RED** is the
calibration. Uniformity (not "N/10 with a story") is the discriminator
that the harness is measuring the fix and not its own noise.

## Kickoff rule 2 — calibration evidence

The harness was shown **RED on a known-bad build before any clean run
was trusted**. The RED is the literal pre-fix mechanism: the leaked
immortal connection blocks `deleteDatabase` indefinitely (the
"transient perturbation → persistent unrecoverable fault" the amended
spec's H1 predicts). PR #182 flips it to uniform `completed`.

## Two harness self-contamination bugs found & fixed (epistemic honesty)

A harness is a verification artifact; it lied twice before it was
trustworthy. Both are documented because the verdict must not outrun the
artifact's credibility.

1. **Opaque-origin misclassification.** v1 issued `deleteDatabase` from
   an unnavigated `context.newPage()` (`about:blank`, opaque origin) →
   `SecurityError: access to the Indexed Database API is denied` →
   misclassified as GREEN. A harness that only ever went "green" via an
   error path is exactly the false all-clear kickoff rule 2 exists to
   catch. Caught by the discriminating-order run, not by inspection.
   Fixed: same-page `deleteDatabase`.
2. **Self-manufactured `NotFoundError`.** v2 re-seeded + `safeReload`-ed
   between iterations; the next iteration's `deleteDatabase` raced the
   v0→v7 upgrade transaction → `AbortError: Version change transaction
   was aborted in upgradeneeded` + `NotFoundError: object store not
   found`. This *looked* like a surviving PATH-A repro on v1.46.3 (2
   green then 8 RED). It was the harness racing itself. Rejected as an
   artifact because the trace **named the exact harness op** that caused
   the abort (structural, not interpretive). Fixed: seed once, no
   reseed/reload in the loop → uniform 10/10 on v1.46.3.
   - Plus a 3rd, minor: `snapshotIdb` did `db.transaction([])` on the
     just-emptied DB → `InvalidAccessError` polluting R2; and an un-timed
     `indexedDB.open` queued behind a blocked delete hung the v1
     calibration ~7 min. Both timeout/empty guarded — the hang is now a
     captured RED signature, not an infinite wait.

## R2 — fault-assignment capture (present, harness-only)

`scripts/lib/idbTraceShim.mjs` (string literal, never app source;
no-PHI by construction — op/store/mode/ts only) installed via
`addInitScript`. On `pageerror`/`unhandledrejection`: `error.name` +
message + stack, `__harnessTrace` drain, `snapshotIdb`, last-chaos
label. The `error.name` discriminator (H1 `InvalidStateError` vs H2
`NotFoundError`) is captured precisely.

## Scope & honest limits — do not let the verdict outrun this

- The calibrated probe reproduces the **H1 deadlock** (blocked delete),
  **not the literal `NotFoundError` string** the mega-bot logged once.
  The only `NotFoundError` this harness ever produced was self-inflicted
  (bug 2, rejected). Per the amended spec's own caveat, a closed/stale
  connection typically throws `InvalidStateError`; whether the original
  one-shot mega-bot `NotFoundError` is H1 vs H2/H3/H4 is **not closed**
  by this run.
- "Consistent with H1, fixed by v1.46.3" — NOT "root cause confirmed."
- Calibrated for H1 only. H2/H3/H4 have no known-bad build to calibrate
  against; for those the harness's value is the R2 op-trace on whatever
  fires, not a calibrated yes/no.
- Built/run: R0 + R1 variant (a) + R2 + rule-2 calibration.
  **Follow-ups (named, not done):** R1 variant (b) H2 racy interleave;
  R3 ≥30-run determinism sweep; R4 post-fix regression gate. Each is its
  own PR with its own scoped claim.

## Recommendation

Keep the harness as a callable, R0-gated regression probe. It is the
deterministic guard that H1 stays fixed: any future build where the H1
probe goes RED has regressed PR #182. Re-run on demand:

```
EXPECT_WARD_VERSION=ward-v1.46.3 node scripts/ward-helper-notfounderror-harness.mjs
```

This doc is verdict-shaped; per workspace CLAUDE.md it should route
through a filesystem-grounded fresh-eye review before being treated as
locked.
