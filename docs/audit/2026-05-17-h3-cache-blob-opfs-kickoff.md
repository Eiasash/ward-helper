# Kickoff (PARKED) — H3: non-IDB `NotFoundError` (Cache / Blob / OPFS)

Status: **PARKED, trigger-bound.** Not started. This is the named
follow-up the #176 investigation deferred when R1(b) v2 disfavoured the
IDB hypotheses (H1-scan-symptom / H2) and the weight shifted to **H3 or
formally unassignable**. See
`docs/audit/2026-05-17-notfounderror-harness-run.md` →
"STEP 2 — post-ship correction".

## Trigger (concrete — this is the anti-lapse binding)

Open this kickoff when **any** of the following fires:

- A `[HIGH] unhandled-rejection: NotFoundError` (or any `NotFoundError`)
  appears in `chaos-reports/ward-bot-mega/wm-*.md` (the mega-bot already
  runs via the weekly-medical-pwa-qa routine + on demand; its existing
  HIGH-finding triage routing — see memory
  `project_wardhelper_bot_run_2026-05-17` — routes here).
- A `NotFoundError` surfaces in production telemetry / a real
  clinical-session error report.

Until a trigger fires, the #176 horizon stays **downgraded** (not
deadline-tier) because the H3 surface is structurally bounded to
non-persisted-PHI, self-healing failure (severity prior below). The
downgrade is *backstopped by this trigger*, not by closure.

## In scope (when triggered)

1. **SW Cache API** — `public/sw.js`: `caches.open(VERSION).addAll(SHELL)`
   (install), `caches.delete(stale-version)` (activate),
   `caches.match() ‖ fetch()` (fetch). Race a `caches.delete()` /
   version-swap against an in-flight `caches.match()` / `addAll()`.
2. **`URL.createObjectURL` / `revokeObjectURL`** — `src/camera/session.ts`,
   `src/ui/screens/{Census,Settings}.tsx`. Blob-URL lifecycle vs.
   navigation / chaos.
3. **OPFS / File System Access** — *none today*; in scope only if ever
   added. Re-grep `getDirectory|showSaveFilePicker|FileSystemWritable`
   at trigger time.

## Out of scope (already done — do not re-litigate)

- **IDB scan-vs-chaos-close** — R1(a) calibrated (H1 deadlock real, fixed
  by PR #182); R1(b) v2 contamination-clean 0/30 (PATH B). The IDB
  surface yields `InvalidStateError` / blocked-delete, **never** the
  generic-message `NotFoundError`. Closed for this kickoff's purposes.

## Severity prior (2026-05-17 code-grounded triage — carry forward)

The H3 surface **cannot cause persisted-PHI loss**:

- Cache API `SHELL` = static app-shell + bundle = **PHI-free** (PHI is
  IndexedDB AES-GCM + Supabase ciphertext only). `caches.match()` has an
  **explicit network fallback** (`r || fetch(e.request)`) — a miss is
  self-healing, not a thrown `NotFoundError`.
- `revokeObjectURL` on a stale/absent URL is a **silent no-op**, not a
  throw. The blob URLs *do* hold PHI in memory (AZMA screenshots) but are
  **never persisted** (hard invariant: "screenshots never written to any
  storage; in-memory only, revoked after the API call"). A transient
  mishandling is **bounded by that existing in-memory invariant** — an
  H3 `NotFoundError` does not relax it.
- `chaos-clear-storage` never calls `caches.delete()` — it does
  `deleteDatabase` + `sessionStorage.clear()`. The original production
  fault, if H3, came from a *different* path (SW lifecycle, blob race) —
  identify it from a real stack at trigger time.

Net: worst case = a transient app-shell / screenshot-handling hiccup
that self-heals. That bounds severity, it does **not** identify the
fault — the original artifact remains unassignable (no stack, no
op-trace; generic `DOMException` default message).

## Starting probes (NAMED, not designed — design at kickoff)

- A chaos run that issues `caches.delete(VERSION)` mid-`fetch` and mid
  SW `addAll`, with the R2 trace shim extended to log Cache API ops.
- A blob-URL lifecycle probe: `createObjectURL` → navigate/chaos →
  observe `revokeObjectURL` + any consumer reading a revoked URL.
- Reuse the #176 discipline verbatim: R0 version gate, pre-committed
  pass/fail before the run, contamination re-check first
  (`feedback_idb_chaos_harness_contamination_class` generalises),
  capture-liveness per navigation, **the harness lies — read every
  trace**.

## Out of scope for the *triggering* session

A fix is a separate PR with its own merge-path decision (PHI-surface
fixes need explicit human authorization per the #176 prior-session
rule). This kickoff produces a fault assignment + fix proposal, not a
fix.
