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

---

# STEP 1 — fresh-eye filesystem-grounded review outcome (2026-05-17)

> Append-only. The PATH B1 verdict above is NOT rewritten — this section
> records the independent review that locked it.

A **fresh terminal instance** (slug `claude/term-notfounderror-r1b-r3-r4`,
not the PATH-B1 author) verified all three load-bearing claims against the
repo, not the doc's own narration:

- **Claim 1 (verdict).** PR #182's `invalidateDb()` + `terminated()` +
  `versionchange→close()+invalidate` + `close→invalidate` confirmed in
  *current main* `src/storage/indexed.ts:134,269-284` (not just the squash
  commit). The #182 commit message itself disclaims "NotFoundError
  resolved". The verdict does not outrun the code. ✔
- **Claim 2 (calibration) — independently re-run, not trusted on faith.**
  - live `ward-v1.46.3` → **0/10 RED, uniform GREEN `["completed"]`**,
    0 NotFoundError; R2 trace shows `deleteDatabase`→`open v7` recovery.
  - `#182`-reverted local build `ward-v1.46.3-cal1` (built from a
    `git revert 6974451`; bundle fix-signature `terminated(){`/`invalidateDb`
    confirmed absent — the `idb`-lib `addEventListener('versionchange')`
    plumbing is library code, not the fix) → **10/10 RED
    `["blocked","timeout"]`**, 0 NotFoundError; reverted R2 trace carries
    the literal *"open queued behind a blocked deleteDatabase — pre-fix
    stale-connection deadlock signature"*.
  - The cross-build asymmetry **uniform-GREEN-on-fixed ∧ RED-on-reverted
    reproduces exactly**, matching the recorded numbers AND the
    load-bearing shape. `report.uniform` is `false` on the reverted build
    (`blocked`+`timeout` are two outcome strings) — that is expected and
    NOT a fail; the discriminator is `redCount` + absence of `completed`. ✔
- **Claim 3 (3 rejected contaminations structural, not motivated).**
  Verified: (1) opaque-origin `SecurityError` is a real browser behavior,
  fix in `probeOnce`, caught by the discriminating run; (2) the
  self-manufactured `NotFoundError` traced to reseed/`safeReload` racing
  the v0→v7 upgrade — and the honest consequence (the harness now produces
  **zero** NotFoundErrors, confirmed in *both* re-runs above) is the
  opposite of a motivated dismissal; (3) the `open-timeout-3s` guard
  **fired live** during the reverted re-run, exactly as designed. ✔

**GATE = PASS. This doc is LOCKED.** A locked-and-sound calibration is
**not** a closed investigation: the calibration is for the H1 *deadlock*
only; H1-vs-H2/H3/H4 on the original mega-bot fault remains OPEN and is
the subject of R1(b)/R3/R4 below.

---

# R1(b) / R3 / R4 — pre-committed gate (LOCKED 2026-05-17 17:58:14Z)

> **This section is committed to disk and git BEFORE any R1(b) iteration
> runs.** Pre-commitment is the evidence; post-hoc rationalization of a
> partial result is the failure mode the kickoff's rule 3 names. The
> commit timestamp of this section precedes the commit that adds the
> R1(b) probe code — verifiable in `git log`.

## Decisive new evidence — the original artifact is unassignable

The 2026-05-17 mega-bot finding
(`chaos-reports/ward-bot-mega/wm-2026-05-17T09-07-22.md`, gitignored) is
**only**:

```
### [HIGH] unhandled-rejection
- What:  NotFoundError: A requested file or directory could not be found
         at the time an operation was processed.
- At: 2026-05-17T09:33:32.229Z
```

No stack. No IDB op-trace. No preceding-chaos label. The message is the
**generic `DOMException` default for `name="NotFoundError"`** — it is
*not* IndexedDB's store-specific message (Chrome emits `One of the
specified object stores was not found` for a missing store via
`transaction()`). The old mega-bot was uninstrumented for exactly the R2
evidence the #176 spec was written to add. **Consequence: the original
fault cannot be back-assigned to H1/H2/H3/H4 from the existing record.**
The generic message keeps **H3** (Blob / Cache / OPFS — spec hypothesis
#3) fully live, not merely a long shot.

## Rule-6 / calibration honesty (surfaced, not smoothed)

The kickoff's rule 2 / the brief's rule 6 want *discriminating asymmetry*
(RED on a known-bad build, GREEN otherwise) before a result is trusted.
**R1(b) is structurally uncalibratable**: reverting PR #182 yields the H1
*deadlock* (blocked delete), not H2's "transaction reaching
`objectStore()` on a schema-less handle" path; quota-fill / memory-pressure
are not deterministically simulable. The spec & kickoff already carve this
out ("H2/H3/H4 have no known-bad build; the harness's value there is the
R2 op-trace that assigns whatever fires"). **R1(b)'s rule-6 realization is
therefore R2-trace fault-assignment, NOT cross-build asymmetry.** A
uniform-no-fire sweep is honest *absence-evidence*, explicitly **NOT
"H2/H3/H4 excluded"**.

## Locked pass/fail (no post-hoc movement permitted)

1. **R0** unchanged — hard version gate, `EXPECT_WARD_VERSION` must equal
   live `sw.js`. A wrong-version run is invalid.
2. **R1(b) fire criterion.** An iteration is a *finding* (PATH A) iff an
   `unhandledrejection`/`pageerror` with
   `error.name ∈ {NotFoundError, AbortError, InvalidStateError}` fires
   **AND** the R2 op-trace tail names the in-flight scan op
   (`getAll`/`transaction` on `patients`/`notes`) or a non-IDB op (→ H3).
   A bare re-triggered rejection with **no** trace assignment is **not a
   finding** (kickoff rule 1: discriminate, don't just trigger).
3. **Fault assignment.** On a fire: `NotFoundError` + IDB
   `transaction`/`objectStore` tail → **H2**; `NotFoundError` + empty IDB
   tail + Cache/Blob/OPFS stack frame → **H3**; `InvalidStateError` on a
   closed handle → consistent with **H1** residue; `AbortError` from a
   force-closed in-flight tx → in-flight-close (H2-adjacent), recorded as
   such.
4. **R3 determinism.** Sweep = `HARNESS_ITERS=30`. For this uncalibratable
   H2 path the floor is **≥1/30 with a trace-assignable fire** = PATH A
   (a single assignable repro unlocks a fix). `0/30` with capture proven
   live every iteration = honest absence-evidence (PATH B, "not driveable
   on v1.46.3 via this harness"), **never** "excluded".
5. **R4 regression gate.** Same 30-run sweep on R0-gated `ward-v1.46.3`
   *is* R4: `0/30` literal-`NotFoundError` (incl. the R1(b) overlap path)
   = the post-fix regression gate established. A green run on an unbumped
   version is invalid by R0.
6. **Scope stop.** If R1(b) fires PATH A and the assigned root-cause fix
   lands in `src/storage/` (or any app code), that is a **NEW production
   PHI-surface fix → OUT OF SCOPE for this session**. STOP, report the
   finding + proposed fix, do not branch it. Harness/doc changes only
   ship here.

## R1(b) probe design (locked)

Raw-IDB in `page.evaluate` on the booted app page (same origin), because
the app exposes no storage API to `window`:

- **Mirror v1.46.3's connection lifecycle exactly** — the probe's own
  connection registers `terminated→invalidate`,
  `versionchange→close()+invalidate`, `close→invalidate`, lifted from
  `src/storage/indexed.ts:269-284`. Probing a pre-fix model on the
  post-fix build would be uninterpretable.
- **Widen the race window honestly** — seed ~2000 fat `patients` rows so
  `getAll('patients')` has a ~50-200 ms in-flight window (ward scale is
  ~30 ms / 50-100 rows — too narrow to race). **Fidelity gap, labelled:**
  the synthetic 2000-row scale may *manufacture* a race that does not
  exist at production ward scale; a fire here is "driveable in principle",
  not "this is what bit production".
- **Interleave:** start `getAll('patients')` on the mirrored connection,
  then fire `chaos-clear-storage` (same-page `deleteDatabase` over
  `indexedDB.databases()`, the exact production injector) at a randomized
  0–window offset so it lands mid-scan. Drain R2 trace + error capture.
- **Reuse `safeNavigate` / `assertCaptureLive`** — capture liveness proven
  per navigation (kickoff rule 4); fail-closed if the sentinel is unseen.

---

# R1(b) v1 — REJECTED as harness self-contamination (2026-05-17)

> The harness lies; read every trace. This rejection is **structural,
> not motivated** — it rejects a result that *superficially looks exactly
> like the H2 repro this investigation wants* (PATH A 30/30 on v1.46.3).

R1(b) v1 (`scripts/ward-helper-notfounderror-harness-r1b.mjs` @ commit
after the locked gate) reported **PATH A, fired 30/30** with a literal
`NotFoundError`. Trace inspection rejects it as an artifact:

- Every fired iteration's window capture carries the verbatim signature
  **`AbortError: Version change transaction was aborted in upgradeneeded
  event handler`** + **`NotFoundError: Failed to execute 'objectStore' on
  'IDBTransaction': The specified object store [was not found]`**. This is
  *the exact contamination R1(a) bug #2 already documented and rejected*
  ("reseed/reload between iterations → next iteration's `deleteDatabase`
  races the v0→v7 upgrade"). v1 put `safeNavigate`+`seedMany` **inside the
  loop** — the precise anti-pattern bug #2's fix forbids.
- The fire was a **deterministic odd/even alternation** (odd: chaos-deleted
  DB still racing the re-boot v0→v7 upgrade when the probe opened →
  `patients` absent → `NotFoundError`; even: rebuild won the race →
  `n:2000`). A real timing race is stochastic; perfect alternation is the
  harness's own teardown/rebuild cadence.
- `idbSnapshot` on fired iters = `{version:1, stores:[]}` "empty
  (post-delete, pre-reopen)" / the "open queued behind a blocked
  deleteDatabase" signature — the NotFoundError is the **probe's own**
  `transaction(['patients'])` on a schema-less handle *the harness itself*
  opened mid its *own* delete+upgrade race. Not the app's scan; not a
  chaos-driven close on the fixed connection.
- Second defect: **cross-iteration capture-buffer bleed** —
  `rec.pageerrors.slice(-6)` carried *prior* iterations' errors, so even
  the clean even-iterations reported `fired=true`. Third defect: the
  `AbortError → H2-adjacent` classifier mis-assigned that bled noise.
- Consequence: the positive control's "fire" was the *same* self-race, so
  it did **not** validly prove the detector (B2 territory for v1).

**Durable generalization (the lesson R1(a) bug #2 under-articulated):**
reseed/reload **and** between-iteration `deleteDatabase` **and**
between-iteration schema-recreation are all the *same* contamination
class. The rule is: **persistent fixtures + NO inter-iteration teardown
of the schema; if the chaos destroys the schema, the rebuild must be
fully `await`ed to completion before the next scan, with no concurrent
open racing the upgrade.**

# R1(b) v2 — pre-committed gate (LOCKED 2026-05-17 18:08:14Z)

> Committed BEFORE the v2 rebuild (git log order is the rule-3 evidence).
> Per the fresh-eye / advisor guardrail: **one rebuild attempt, max.** If
> v2 also self-contaminates, **PATH B2 ships and the investigation stops**
> — R1(b) is uncalibratable and its best-case value (weak absence-evidence)
> is already supplied by R1(a)'s deadlock calibration; iterate-to-green on
> such a tool is the failure mode.

**v2 design (locked):**
1. Navigate the app **once** (no per-iteration `safeNavigate`/reload).
2. Per iteration, entirely inside one awaited `page.evaluate`:
   `awaitSchemaReady()` — open `ward-helper` **with explicit version 7 +
   `onupgradeneeded` `createObjectStore`**, `await` success **and** the
   upgrade transaction's completion, then close the bootstrap handle.
   This isolates the chaos+scan race from the rebuild race (no concurrent
   open queues behind a blocked delete).
3. Seed N rows on the clean v7 schema (`await tx.complete`).
4. Open probe connection P; faithful=true mirrors v1.46.3 lifecycle
   (`versionchange→close()+invalidate`, `close→invalidate`).
5. Start in-flight `getAll('patients')` on P; fire
   `indexedDB.deleteDatabase('ward-helper')` (the faithful `versionchange`
   trigger) at a randomized mid-scan offset.
6. Observe in-flight outcome + a post-chaos `transaction()`/`objectStore()`
   on P. Drain trace.
7. **Per-iteration buffer isolation:** snapshot `rec.pageerrors.length` /
   `rec.rejections.length` BEFORE the probe; read only entries past that
   index. No `slice(-N)` trailing window.
8. Positive control = faithful=false (no lifecycle listeners), **same
   awaited-rebuild path** so its fire (if any) is a *clean* mechanism, not
   the upgrade-race.

**v2 LOCKED pass/fail (no post-hoc movement):**
- **Contamination re-check (hard gate, first):** if ANY fired iteration's
  trace tail or capture contains `"aborted in upgradeneeded"` or the
  probe's NotFoundError is `"One of the specified object stores was not
  found"` co-occurring with a `version:1, stores:[]` snapshot → **still
  self-contaminated → verdict B2, STOP, ship B2, no third rebuild.**
- **PATH A (genuine):** a fire whose trace tail names the in-flight
  `getAll`/`transaction` on a *populated v7* `patients` store (snapshot
  shows the v7 schema intact) with `error.name ∈ {NotFoundError,
  AbortError, InvalidStateError}` AND no upgrade-race signature → genuine
  finding. Root-cause fix is OUT OF SCOPE (scope-stop): report + park.
- **PATH B (absence-evidence):** real run 0/30 clean AND the positive
  control fired on a clean (non-upgrade-race) mechanism proving the
  detector live → honest absence-evidence: the H2 IDB-scan-vs-close path
  is not driveable to a literal `NotFoundError` on v1.46.3; combined with
  the unassignable original artifact + the generic-message analysis, the
  weight shifts toward **H3 / unassignable**, never "H2 excluded by proof".
- **B2:** real 0/30 but the control never fired on a clean mechanism →
  detector unproven → untrustworthy clean; ship B2.

---

# R1(b) v2 — RESULT: PATH B (absence-evidence), contamination-clean (2026-05-17)

Run: `HARNESS_ITERS=30 EXPECT_WARD_VERSION=ward-v1.46.3
node scripts/ward-helper-notfounderror-harness-r1b.mjs`. R0 PASS (live
`ward-v1.46.3`). Report
`chaos-reports/notfounderror-r1b-v2-2026-05-17T18-12-52-573Z.json`.

| Stream | iters | fired | contaminated | per-iter signature |
|---|---|---|---|---|
| positive control (pre-fix model) | 3 | 0 | **0** | `scan ok n:1200` → `deleteOutcome: blocked` (the **H1 deadlock**); `newRej/PE: []` |
| real (faithful v1.46.3 mirror) | 30 | 0 | **0** | `scan ok n:2000` → `versionchange→close()+invalidate` → `deleteOutcome: completed` → post-chaos `transaction()` = **`InvalidStateError: ...connection is closing`**; `newRej/PE: []` every iter |

**v2 contamination re-check (the hard gate, FIRST): PASSED.** 0/33
iterations carried `"aborted in upgradeneeded"` or the
object-store-not-found+empty-snapshot signature. `awaitSchemaReady()` +
single-navigation + per-iteration buffer isolation structurally
eliminated the v1 self-race; `newRej/PE` is empty *every* iteration
(no cross-iteration bleed). v1's defect is fixed, verified by absence of
its exact fingerprint.

**What the clean run proves (read every trace — this is evidence of
absence for a mechanism, not mere absence of evidence):**

1. **The in-flight `getAll('patients')` ALWAYS completes** (`n:2000`,
   30/30). Per the IndexedDB spec an in-flight transaction completes
   before `IDBDatabase.close()` takes effect — H2's "scan transaction
   *outliving* a DB close" cannot manifest as a lost in-flight scan here.
2. **Post-fix (faithful mirror): `versionchange→close()` fires, the
   delete `completes` orderly, and reaching `transaction()` on the closed
   handle throws `InvalidStateError`** ("The database connection is
   closing") — **never `NotFoundError`.** This is *exactly* the amended
   spec's H1/H2 caveat ("a closed connection typically throws
   `InvalidStateError`, not literally `NotFoundError`"), now empirically
   confirmed 30/30.
3. **Pre-fix model (positive control): the same race yields the H1
   *blocked-delete deadlock*** (`deleteOutcome: blocked`), **not** an H2
   `NotFoundError`. This is the *same* mechanism R1(a) already calibrated
   and PR #182 already fixes. The detector + chaos plumbing are proven
   live (the delete fired and was observed blocked) — so 0/30 is honest
   absence-evidence, **not** B2.

## STEP 2 — the H1-vs-H2/H3/H4 answer

The IDB scan-vs-chaos-close surface produces **H1 (pre-fix blocked
delete)** or **`InvalidStateError` (post-fix orderly close)** —
**never the generic-message `NotFoundError`** the mega-bot logged. The
*only* `NotFoundError` any version of this harness ever produced was
harness self-contamination (R1(a) bug #2 and R1(b) v1), rejected
structurally both times.

Combined with the decisive STEP-0/STEP-2 evidence that the **original
artifact is unassignable** (no stack, no op-trace, uninstrumented old
mega-bot; message is the *generic* `DOMException` default, not
IndexedDB's store-specific string), the conclusion is:

> **H1 is real and fixed (R1(a) calibrated; PR #182).** But the one-shot
> 2026-05-17 mega-bot `NotFoundError` is **NOT** demonstrably H1's
> scan-path symptom (that symptom is `InvalidStateError`, proven here)
> and **NOT** H2 (that surface yields H1/`InvalidStateError`, never
> `NotFoundError`). The evidence now points **away from H1-scan-symptom
> and H2, toward H3** (a non-IDB generic-`DOMException` source: Cache API
> / Blob / `URL.revokeObjectURL` / OPFS / SW precache deleted by
> `chaos-clear-storage`) **or remains formally unassignable** from the
> uninstrumented original record. **H1-vs-H2/H3/H4 cannot be *closed* on
> the original artifact** — but it is no longer symmetrically open: H2
> and the H1-scan-symptom are now positively disfavored on this surface.

**Status:** the current build is **protected** (PR #182 fixes the real
H1 deadlock; R1(a) calibrated 0/10-GREEN-fixed / 10/10-RED-reverted) and
**surveilled** (R1(a) = keep-forever H1 regression probe; R1(b) v2 =
contamination-clean H2 absence-probe + R4 gate). **R4 SATISFIED**: 0/30
literal `NotFoundError` on R0-gated `ward-v1.46.3` including the R1(b)
overlap path.

> **Note on `idbSnapshot {version:1, stores:[]}` / `schemaIntact=false`
> on real iterations:** this is the **benign post-delete state**, not
> schema corruption. The harness's chaos *legitimately deletes* the DB
> by design; the snapshot is taken after the delete completed. The
> classifier reports `schemaIntact=false` precisely so a benign
> post-close `InvalidStateError` is NOT mis-flagged as a finding — that
> is the gate working, not a defect.

**No new production fix is implicated by this harness.** Structural
confirmation: `getDb()` guards `if (!dbPromise)` and `invalidateDb()`
sets `dbPromise = null`, so the *next* `getDb()` re-opens a fresh
connection; every scan primitive does `await getDb()` per call and never
caches a handle across a `versionchange→close()` boundary. The surface
is therefore structurally protected from the **persistent,
unrecoverable** fault PR #182 targets (the H1 deadlock). A *transient*
`InvalidStateError` at the exact close-race instant remains possible but
self-heals on the next `getDb()` — not a `NotFoundError`, not persistent.
R1(b) v2 found the post-#182 surface behaves correctly (orderly close,
in-flight scan completes, self-healing memo); the scope-stop branch does
not fire — no parked PHI-surface fix. **If H3 is ever pursued, that is a
NEW investigation with its own kickoff** (a Cache/Blob/OPFS probe is a
different harness); explicitly out of scope here.

## Recommendation (updated)

Keep BOTH harnesses as callable R0-gated regression probes:

```
EXPECT_WARD_VERSION=ward-v1.46.3 node scripts/ward-helper-notfounderror-harness.mjs       # R1(a) H1 deadlock guard
HARNESS_ITERS=30 EXPECT_WARD_VERSION=ward-v1.46.3 node scripts/ward-helper-notfounderror-harness-r1b.mjs   # R1(b) v2 H2 absence-probe / R4 gate
```

Any future build where R1(a) goes RED has regressed PR #182. Any future
build where R1(b) v2's contamination re-check trips, or it fires
non-contaminated, is a genuine new signal worth a kickoff.

---

# STEP 2 — post-ship correction (2026-05-17): H3 severity-triage + horizon trigger + authority split

> Append-only. The "STEP 2 answer" above is NOT rewritten. This section
> corrects three under-justified moves in that conclusion, raised by
> in-session review immediately after PR #187 merged (`cfb45b8`).

**The hole.** The conclusion promoted **H3** to the most-weighted live
hypothesis for the original production `NotFoundError`, then downgraded
the #176 horizon from deadline-tier — while (a) H3 is **not surveilled**
(R1(a)/R1(b) watch only the IDB surface), (b) no **severity** read of H3
was done, and (c) the deferral had **no trigger** — violating this
session's own trigger-bound-deferral discipline. The downgrade was
asserted, not earned.

## Fix 1 — H3 severity prior (code-grounded, not asserted)

Full grep of the non-IDB `NotFoundError`-capable surface
(`caches.*`/`cache.*`, `create/revokeObjectURL`, `navigator.storage`,
OPFS/FileSystem):

- **SW Cache API** (`public/sw.js`): `SHELL` is static app-shell +
  bundle — **PHI-free** (PHI = IDB AES-GCM + Supabase ciphertext only).
  `caches.match()` has explicit network fallback → a miss self-heals,
  does not throw. `chaos-clear-storage` never calls `caches.delete()`.
- **`revokeObjectURL`** (`camera/session.ts`, `Census/Settings.tsx`):
  on a stale/absent URL it is a **silent no-op**, not a throw. The blob
  URLs *do* hold PHI in memory (AZMA screenshots) but are **never
  persisted** (hard invariant). A transient mishandling is **bounded by
  that existing in-memory invariant** — an H3 `NotFoundError` does not
  relax it. (Precise claim: *no persisted-PHI loss*, not "zero PHI".)
- **No OPFS / File System Access** usage exists today.

→ H3's worst case is a **transient, self-healing app-shell / screenshot
hiccup — not persisted-PHI loss**. This *bounds severity by code
structure* (not by observation; the original artifact is still
unassignable). The downgrade is justified **only with this read attached
+ the trigger below**.

## Fix 2 — concrete reopen trigger (anti-lapse)

The H3 follow-up is parked at
[`docs/audit/2026-05-17-h3-cache-blob-opfs-kickoff.md`](2026-05-17-h3-cache-blob-opfs-kickoff.md)
with a **concrete trigger**: any `NotFoundError` in
`chaos-reports/ward-bot-mega/wm-*.md` (the mega-bot already runs via the
weekly-medical-pwa-qa routine; its existing HIGH-finding triage routing
— memory `project_wardhelper_bot_run_2026-05-17` — routes there) **or**
a production-telemetry `NotFoundError`. The downgrade is *backstopped by
this trigger*, not by closure.

## Fix 3 — authority split (H2 is disfavoured by TWO independent arguments)

Keep these separate; do not let one borrow the other's weight:

- **(a) String-provenance argument** — the mega-bot message is the
  *generic* `DOMException` `NotFoundError` default ("A requested file or
  directory could not be found…"), **not** IndexedDB's store-specific
  string ("One of the specified object stores was not found"). This is
  **independent of any harness/calibration**, near-certain on its own
  terms, and disfavours H2 (and the H1-scan-symptom) **generally**.
- **(b) R1(b) mechanism observation** — 30/30 `InvalidStateError` on the
  post-fix mirror + the pre-fix control showing the **H1 blocked-delete**
  (never an H2 `NotFoundError`) prove the IDB scan-vs-close path
  **structurally cannot emit `NotFoundError`**. This is *mechanism
  evidence* (stronger than mere 0/30 absence) but is **bounded to the IDB
  surface only** — it does not disfavour non-IDB (H3) sources, and R1(b)
  had no H2/H3 positive control (only H1 did, via the reverted-#182
  build). The 0/30 *count* alone earns little; the *mechanism* finding is
  what (b) contributes.

Net unchanged: H2 + H1-scan-symptom disfavoured; **H3 OR formally
unassignable**; original artifact cannot be closed. What changes: the
downgrade is now *earned* (severity-bounded + trigger-backstopped), and
"surveilled" is honestly scoped — **the IDB surface is surveilled; H3 is
trigger-bound-parked, not surveilled.**

### 2026-05-17 — trigger ARMED (verified). Recursion test, third pass.

> Append-only. Fix 2's text above is **not** rewritten — it is the audit
> trail of the iteration. A second in-session review pressed the right
> question: Fix 2 *claimed* the trigger "inherits the existing mega-bot
> triage routing" — but that was an unverified **mechanism claim**, the
> exact class wrong twice already ("surveilled"; then "inherits
> routing"). Verified against the repo, not asserted:

- **It was NOT armed.** `ward-helper-mega-bot.mjs` classified by
  *severity* only; `analyze-mega-run.mjs` had zero `NotFoundError`/route
  logic; the cited "triage routing" was a **manual Claude-session**
  artifact (`chaos-reports/TRIAGE-*.md`, *gitignored* — invisible to a
  fresh-eye clone). Fix 2 reproduced the scope-overclaim one layer down:
  "trigger-bound" where the trigger was parked-and-hoping.
- **Now armed (mechanism).** Added `KNOWN_ISSUE_TRIGGERS`
  (`/NotFoundError/i` → `docs/audit/2026-05-17-h3-cache-blob-opfs-kickoff.md`)
  to `scripts/ward-helper-mega-bot.mjs`: `writeReport()` emits a
  top-of-report `## ⚠ ARMED KNOWN-ISSUE TRIGGER` block + a stdout
  `[KNOWN-ISSUE TRIGGER ARMED]` line on any run whose `BUGS` contains the
  string (same `logBug` HIGH path as the original finding). One rule, the
  one the evidence requires (YAGNI; do not generalise until a second real
  trigger).
- **Verified empirically (the recursion test).** Replaying the *exact*
  original 2026-05-17 finding string fires the rule and routes to the
  kickoff path; a benign finding does **not** fire (discriminating).
  Re-runnable: `node -e` predicate test in the arming PR description.
- **Residual, stated honestly.** This arms **detection, not response**:
  the bot runs on the weekly-medical-pwa-qa schedule (+ on demand) and a
  human opens the kickoff on the self-announce — correct for a parked
  workflow. The remaining dependency is "the bot runs" (scheduled), not
  "a human remembers a doc." The **production-telemetry** path is
  *structurally unarmable* (ward-helper "no analytics" invariant — no
  automated telemetry exists); it remains user-initiated, by design, not
  as a gap.

**The boundary-honesty fix held on the third pass — by verification, not
assertion.** That is the whole point: the test of "the dishonesty lived
in the scope of the claim" is whether the next claim was *checked*. It
was.
