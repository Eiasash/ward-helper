# Kickoff (PARKED) — H3: non-IDB `NotFoundError` (Cache / Blob / OPFS)

Status: **PARKED, trigger-bound.** Not started. This is the named
follow-up the #176 investigation deferred when R1(b) v2 disfavoured the
IDB hypotheses (H1-scan-symptom / H2) and the weight shifted to **H3 or
formally unassignable**. See
`docs/audit/2026-05-17-notfounderror-harness-run.md` →
"STEP 2 — post-ship correction".

## Trigger (concrete — this is the anti-lapse binding)

Open this kickoff when **either** path fires. The two paths differ in
*arming* — stated honestly per trigger granularity:

- **ARMED (mechanism, verified).** `scripts/ward-helper-mega-bot.mjs`
  carries a `KNOWN_ISSUE_TRIGGERS` rule (`/NotFoundError/i` → this
  kickoff). On any run whose `BUGS` contains the string (the *same*
  `logBug` HIGH path that produced the original 2026-05-17 finding),
  `writeReport()` emits an **`## ⚠ ARMED KNOWN-ISSUE TRIGGER`** block at
  the **top** of `chaos-reports/ward-bot-mega/wm-*.md` **and** a stdout
  `[KNOWN-ISSUE TRIGGER ARMED]` line — both naming this doc path. The
  report self-announces; it does **not** depend on a human noticing the
  string or remembering this doc. **Verified 2026-05-17**: replaying the
  exact original finding (`unhandled-rejection` /
  `NotFoundError: A requested file or directory could not be found…`)
  fires the rule and routes here; a benign finding does not (test in the
  arming PR). *Residual (honest):* this arms **detection, not response** —
  the bot runs on the weekly-medical-pwa-qa schedule (+ on demand) and a
  human still opens this kickoff on seeing the self-announce; that is the
  correct posture for a parked-spec workflow. The unarmed dependency is
  "the bot runs" (scheduled), not "a human remembers."
- **UNBUILT (not "unarmable"): production-side detection.** Correction
  to an earlier overclaim — "structurally unarmable" was itself a
  mechanism-overclaim about ward-helper's own invariant. "No analytics,
  no 3rd-party scripts" ≠ no error capture. A **first-party, local-only**
  `addEventListener('unhandledrejection', …)` writing the last N
  `error.name`s to IndexedDB is neither analytics nor a third-party
  script — it is a local breadcrumb, and it is **buildable**, not
  precluded by the invariant. So this path is **unbuilt, a choice — not
  impossible.** The real (surmountable) design constraint is **PHI-safe
  capture**: error `message`/`stack` in a clinical app can contain
  patient data, so a breadcrumb must record `error.name` only (or a
  scrubbed shape) — exactly the discipline the #176 R2 trace shim used
  (string-literal, harness-only, name/op/store only, no message/stack).
  We are **not building it in this scope** (it is its own kickoff line,
  below); calling it impossible was wrong. It would be the *strongest*
  arming available — it catches a real clinical-session `NotFoundError`
  instead of waiting for the scheduled bot to maybe reproduce one — so
  it is explicitly recorded here as the highest-value unbuilt option,
  not dismissed.

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
