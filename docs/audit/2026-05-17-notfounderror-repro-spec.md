# Repro-harness spec — mega-bot `unhandled-rejection: NotFoundError`

Status: **SPEC ONLY. Do not write a fix until this harness reproduces the
fault deterministically.** Blind-fixing a once-seen chaos-only DOMException
on the PHI-encryption surface risks papering over the wrong thing.

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

## Hypotheses (ranked — the harness must discriminate, not assume)

1. **Dropped-index reference under race.** A code path (or an in-flight
   transaction opened before a `chaos-clear-storage`/version-change)
   still references `by-tz` or a store not in the v7 schema →
   `NotFoundError` on `objectStore()/index()`. Most likely given the
   surface; the v7 migration is the only recent IDB structural change.
2. **Transaction outliving a DB close.** `chaos-clear-storage` deletes
   the DB / `chaos-idb-quota` triggers eviction while a scan transaction
   is open → the store handle is gone mid-operation.
3. **Blob/File op, not IDB.** The DOMException text is generic; a
   `URL.revokeObjectURL` / cache / FS path could also throw `NotFoundError`.
   Must be ruled out before assuming IDB.
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
test. A run against the wrong version is a hard error, not a warning —
otherwise a "fix verified" / "still repros" conclusion is meaningless.
(Also: register a fresh, no-SW context per run, or `unregister()` +
`caches.delete()` on first load, to remove cache-first entirely.)

### R1 — Drive the correlated chaos against the scan paths
Loop: seed N patients/notes (real putPatient/putNote) → exercise the
four PR-B1 scan primitives (Census load, SOAP continuity, readmit
lookup, upsert dedup) → inject `chaos-clear-storage` / `chaos-idb-quota`
/ `chaos-memory-pressure` **interleaved with an in-flight scan**, not
only between clean iterations. The 2026-05-17 single hit suggests a
narrow timing window — the harness must widen the odds by overlapping
chaos with an open transaction, then bisect the iteration count.

### R2 — Capture enough to assign the fault
On `unhandledrejection` / `pageerror`: record `error.name`,
`error.message`, full `error.stack`, the last IDB op attempted (wrap the
storage layer with a thin tracing shim for the harness run only:
store/index name + transaction mode + timestamp), `indexedDB.databases()`
+ the live object-store/index names, and which chaos injector fired in
the preceding 5 s. Without the IDB-op trace, hypothesis 1 vs 2 vs 3 is
unassignable.

### R3 — Determinism target
Reproduce **≥ 3 / 10 runs** before any fix is written (enough to bisect
and to later prove a fix). If it cannot be driven above noise, the
deliverable is instead a **defensive-wrap proposal** (wrap the four scan
primitives so a transaction-aborted/`NotFoundError` degrades to a typed
recoverable error + telemetry, never an unhandled rejection) — explicitly
labelled "mitigation, root cause unconfirmed", NOT a root-cause fix.

### R4 — Post-fix verification (also version-gated)
Same harness, **bumped version** (R0 re-asserted), fix applied: the
fault must go to **0 / 30 runs** including the chaos-overlap path. A
green run on an unbumped version is invalid by R0.

## Out of scope
- No fix in this document. No edits to the storage layer yet.
- The tracing shim is harness-only; it must NOT ship in app code
  (would violate the no-PHI-in-logs invariant).

## Pointers
- Surface: PR-B1 #166 (schema v6→v7), `b1-bake-witness.mjs` (happy-path
  witness — the coverage gap this fills).
- Chaos injectors: `scripts/lib/` chaos-clear-storage / chaos-idb-quota
  / chaos-memory-pressure (mega-bot action coverage table, 2026-05-17).
- Memory: `project_wardhelper_bot_run_2026-05-17`,
  `feedback_triage_report_is_citation` (R0 rationale).
