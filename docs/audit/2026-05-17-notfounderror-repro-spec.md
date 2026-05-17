# Repro-harness spec — mega-bot `unhandled-rejection: NotFoundError`

Status: **SPEC. Amended 2026-05-17 after a filesystem-grounded fresh-eye
review of the original (#176).** A candidate *structural* cause was found
in `indexed.ts` and is being fixed separately (PR branch
`claude/web-idb-stale-memo-fix`, v1.46.3). That fix does **not** close this
investigation — the harness below still stands, and now has an added job:
**confirm or exclude** that fix. No further storage-layer fix until the
harness reproduces the fault deterministically.

> **Why this spec was amended.** The original ranked its top hypothesis
> ("a code path still references `by-tz`") from *the surface* — "PR-B1
> touched IDB" — without checking the code. The rewrite was complete; that
> hypothesis is dead. A spec is a verification artifact: it claims "build
> this and you reproduce the bug." If its reproduction theory is wrong the
> harness faithfully tests the wrong thing. The amendments below re-ground
> the theory in `indexed.ts`.

## The finding (2026-05-17 mega-bot run)

```
[BUG/HIGH] unhandled-rejection:  NotFoundError: A requested file or
directory could not be found at the time an operation was processed.
```

- Fired **once** in 30.3 min / 5 personas. Not reproduced since.
- Run context: `chaos-clear-storage` ×12, `chaos-idb-quota` ×18,
  `chaos-memory-pressure` ×15 fired during the window.
- Lands on the **v1.46.1 PHI-at-rest surface**: PR-B1 (#166) dropped the
  IDB `patients.by-tz` index in the **v6 → v7** migration and rewrote
  `getPatientByTz` / `listPatientsByTzMap` / `listNotesByTeudatZehut` /
  `upsertPatientByTz` to scan-and-filter. `b1-bake-witness` proved the
  **happy** scan paths only — never the chaos-perturbed IDB state where
  this fired.

## Hypotheses (ranked — AMENDED 2026-05-17)

> **Amendment — original H1 STRUCK.** "A code path still references
> `by-tz`, or a store not in the v7 schema" is refuted by `indexed.ts`:
> - `grep by-tz src/` finds **zero** live `.index('by-tz')` calls. Every
>   hit is a comment, the guarded `createIndex` (`indexed.ts:200`,
>   `!indexNames.contains`), the guarded `deleteIndex` (`indexed.ts:246`,
>   `indexNames.contains`), or an unrelated **in-memory** `byTz` Map in
>   `census.ts:47` (a JS dedup Map, not an IDB index). PR-B1's caller
>   rewrite to scan-and-filter was complete.
> - The v7 `upgrade` block does `deleteIndex` only — **no
>   `deleteObjectStore`**. v7 removes no object store, so "a store not in
>   the v7 schema" describes nothing.
> - Because both index ops are `indexNames.contains`-guarded, even a
>   from-zero full-chain replay (v0→v7, the `chaos-clear-storage` case)
>   creates then deletes `by-tz` without throwing — the migration is
>   `NotFoundError`-safe.

1. **Stale connection memo / missing connection-lifecycle handlers.**
   **[NEW — strongest code-grounded candidate.]** `getDb()` memoizes the
   open connection in module-level `dbPromise` (`indexed.ts:122`). Before
   the follow-up fix it was nulled **only** by the test-only
   `resetDbForTests()` — no production path. `openDB()` registered no
   `terminated` callback (`indexed.ts:178-261`, options object had only
   `upgrade`), and the connection got no `versionchange` / `close`
   listener. Consequence: when `chaos-clear-storage` deletes the DB, or
   `chaos-idb-quota` / `chaos-memory-pressure` triggers eviction,
   `getDb()` keeps handing out the dead connection — every later IDB op on
   the PHI surface throws — and the leaked open connection *blocks* the
   delete. This is the mechanism that turns a *transient* perturbation
   into a *persistent, unrecoverable* unhandled-rejection surface.
   **Caveat — not a conclusion:** operating on a *closed* connection
   typically throws `InvalidStateError`, not literally `NotFoundError`.
   So this is a candidate; R2's op-trace must still confirm the error
   name. Being fixed pre-harness (see Amendment to R1).
2. **Transaction outliving a DB close.** A scan transaction open when
   `chaos-clear-storage` deletes the DB / eviction force-closes it → the
   store handle is gone mid-operation. Distinct from #1: #1 is the
   recurring-and-unrecoverable mechanism; this is the single in-flight
   moment. The likeliest path to a literal `NotFoundError` if `transaction()`
   / `objectStore()` is reached on a schema-less handle.
3. **Blob / File / Cache / OPFS op, not IDB.** The DOMException text is
   generic. `URL.revokeObjectURL`, Cache API, File System Access /
   OPFS can also surface `NotFoundError`. Rule out before assuming IDB.
4. **Service-worker cache fetch** for a precached asset deleted by
   `chaos-clear-storage` (caches API).

The harness must capture enough state to **assign the fault to one of
these**, not just re-trigger a generic rejection.

## Harness requirements

### R0 — Version-bump precondition (HARD GATE, non-negotiable)

Before any run the harness MUST assert it is exercising a **freshly
versioned** build, not a stale SW cache. Rationale:
`feedback_triage_report_is_citation` — the ward-helper SW caches
cache-first on the `ward-v<version>` key; an unchanged key after a
rebuild serves the *pre-fix* bundle for ANY surface. PR A burned three
falsifications on exactly this. Unconditional, not layout-specific.

Implementation: the harness reads the live `sw.js` `VERSION` (or
`__APP_VERSION__`) and **refuses to run** unless it matches an
`EXPECT_WARD_VERSION` env arg the operator sets to the version under
test. A run against the wrong version is a hard error, not a warning.
(Also: register a fresh, no-SW context per run, or `unregister()` +
`caches.delete()` on first load, to remove cache-first entirely.)

> The stale-memo fix ships as **v1.46.3**. The harness's first run must
> set `EXPECT_WARD_VERSION=ward-v1.46.3` — see R1.

### R1 — Drive the correlated chaos against the scan paths — AMENDED

> **Amendment.** The original R1 assumed "a narrow timing window" and
> prescribed overlapping a chaos injection with an *in-flight* scan +
> bisecting the iteration count. That framing fits H2 (the racy variant),
> not the new H1. If H1 (stale memo) is the cause the repro is
> **near-deterministic, not a race**: open DB (memo set) → delete/evict
> the DB from a second context → call *any* scan → it fails, and *keeps*
> failing. **Test the deterministic memo path FIRST** — it is cheap and
> ~10/10 — before building the racy-overlap design. The overlap path
> remains the discriminator for H2.
>
> Second amendment — the harness now has a confirm/exclude job. The
> stale-memo fix lands pre-harness (v1.46.3). The harness must run
> against the **fixed** build (R0-gated to `ward-v1.46.3`) and answer:
> *does `NotFoundError` still fire?*
>   - Gone → consistent with H1 (NOT proof — absence-under-chaos is weak
>     evidence; record it as such, do not log "root cause confirmed").
>   - Persists → H1 is excluded or incomplete; R2's op-trace assigns the
>     residual to H2 / H3 / H4.

Loop: seed N patients/notes (real putPatient/putNote) → exercise the
four PR-B1 scan primitives (Census load, SOAP continuity, readmit
lookup, upsert dedup) → inject `chaos-clear-storage` / `chaos-idb-quota`
/ `chaos-memory-pressure`. Run two variants explicitly: **(a)** chaos
*between* clean iterations (probes H1 — does the next `getDb()` recover?);
**(b)** chaos *interleaved with an in-flight scan* (probes H2). Bisect
the iteration count on whichever variant fires.

### R2 — Capture enough to assign the fault

On `unhandledrejection` / `pageerror`: record `error.name`,
`error.message`, full `error.stack`, the last IDB op attempted (wrap the
storage layer with a thin tracing shim for the harness run only:
store/index name + transaction mode + timestamp), `indexedDB.databases()`
+ the live object-store/index names, and which chaos injector fired in
the preceding 5 s. Without the IDB-op trace, hypothesis 1 vs 2 vs 3 is
unassignable.

> The `error.name` is now load-bearing: H1/H2 predict `InvalidStateError`
> on a closed handle vs `NotFoundError` on a schema-less `transaction()` /
> `objectStore()`. Capture it precisely — it is the discriminator the
> original spec under-weighted.

### R3 — Determinism target — AMENDED

> **Amendment.** The "≥ 3/10 or fall back to defensive-wrap" target
> assumed a noisy race. For the H1 path expect ~10/10; `≥ 3/10` is the
> floor for the H2 racy path only — do not let a 10/10 H1 repro be
> mis-logged as "noisy".
>
> The defensive-wrap fallback (wrap the four scan primitives in
> invalidate-and-retry-once) is **no longer purely a last resort** — it
> is the natural reactive complement to the H1 fix. But it must be
> **harness-informed**: R2's op-trace tells you exactly which
> `error.name`s to treat as connection-lost. Writing the retry wrapper
> *before* the trace = guessing the error set = the blind fix this spec
> exists to prevent. If shipped before root cause is confirmed it stays
> labelled "mitigation, root cause unconfirmed".

Reproduce **≥ 3 / 10 runs** (H2 floor; H1 should hit ~10/10) before any
*root-cause* fix is written — enough to bisect and to later prove a fix.

### R4 — Post-fix verification (also version-gated)

Same harness, **bumped version** (R0 re-asserted), fix applied: the
fault must go to **0 / 30 runs** including the chaos-overlap path. A
green run on an unbumped version is invalid by R0. Note: the v1.46.3
stale-memo fix is *not* "the fix" for R4 purposes unless the harness
first proves it eliminates the repro — see R1's confirm/exclude job.

## Out of scope

- No *further* storage-layer fix in this document. The v1.46.3 stale-memo
  fix is a separate, independently-justified correctness PR — it is not
  gated on this harness and is explicitly NOT labelled "NotFoundError
  resolved".
- The tracing shim is harness-only; it must NOT ship in app code (would
  violate the no-PHI-in-logs invariant).

## Pointers

- Surface: PR-B1 #166 (schema v6→v7), `b1-bake-witness.mjs` (happy-path
  witness — the coverage gap this fills).
- Pre-harness fix: `claude/web-idb-stale-memo-fix` (v1.46.3) —
  `src/storage/indexed.ts` `getDb()` + `tests/idbStaleConnectionInvalidation.test.ts`.
- Chaos injectors: `scripts/lib/` chaos-clear-storage / chaos-idb-quota
  / chaos-memory-pressure (mega-bot action coverage table, 2026-05-17).
- Memory: `project_wardhelper_bot_run_2026-05-17`,
  `feedback_triage_report_is_citation` (R0 rationale).
