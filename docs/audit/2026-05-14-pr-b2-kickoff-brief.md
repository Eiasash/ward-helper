# PR-B2 kickoff brief — PHI-at-rest encryption wire-up

**Created:** 2026-05-14 (end of session that shipped PRs #164/#165/#166)

**SUPERSEDED in part 2026-05-14**: this brief was the pre-split B2 plan.
After the design-stage fresh-eye gate caught 3 findings (rounds.ts
inventory miss, PHI-scope wrong on roster+daySnapshots, encrypted-row
shape wrong), B2 split into B2.1 (read seam, shipped PR #167) and B2.2
(write side, pending). For current state read:
- `docs/audit/2026-05-14-pr-b2-2-kickoff-brief.md` — live B2.2 brief
- `docs/audit/2026-05-14-pr-b2-design-pins.md` — locked design pins

This file is preserved as the historical record of what changed during
the design-stage gate.

**State of the world:** PR-A, patchSettings, and PR-B1 all in main and baked
through verify-deploy. PR-B2 is the final piece of the encrypted-blob runtime.

---

## State as of brief

- `main` at `90a3a6c` = PR-B1 squash commit (`feat(storage): PR-B1 — schema v7 drops patients.by-tz, callers scan-based`)
- Live `ward-v1.45.0` verified
- DB schema is at v7 — `patients.by-tz` is dropped in production
- 3 storage-layer functions are scan-based; `listPatientsByTzMap` exists for loop-callers
- PR-A's `src/crypto/phi.ts` is dead code in the bundle (tree-shaken)
- `Settings.phiSalt`, `loadOrCreatePhiSalt`, `derivePhiKey`, `setPhiKey`/`getPhiKey`/`hasPhiKey`/`clearPhiKey`, `sealRow`, `unsealRow` all exist + tested + unused
- `patchSettings` is the canonical Settings-update primitive; all 4 hand-list sites migrated

## Scope of PR-B2

| Item | Approx lines |
|---|---|
| `phiEncryptedV7` sentinel field on `Settings` + backfill runner | ~120 |
| Transitional read shape (`{id, enc}` vs legacy plaintext) wired into `listPatients` / `listAllNotes` / `getPatient` / `getNote` | ~80 |
| `main.tsx` wire-up: backfill runs AFTER `runV1_40_0_BackfillIfNeeded`, AFTER key derivation, sentinel-gated | ~30 |
| Cold-start unlock screen (`src/ui/screens/Unlock.tsx`) — full-screen, distinct from login | ~150 |
| App.tsx gate — render unlock instead of PHI-rendering routes when `hasPhiKey()` is false AND flag is on | ~30 |
| Auth flow integration — derive key on login, clear on logout | ~30 |
| `localStorage.phi_encrypt_v7 = '1'` flag gates: backfill trigger, read-decrypt branch, cold-start gate | ~30 |
| Decrypt-failure UX — quiet visible "1 record couldn't be loaded — retry sync" affordance | ~40 |
| Tests: migration idempotency, mixed-state read, all callers post-encryption, gate render, flag-off equivalent to today | ~300-400 |

Total: ~800-1000 lines.

## Carried-forward notes from PR #166 review — TWO DIFFERENT WEIGHTS

The next session needs to treat these at different priorities. Putting them
on one flat list is exactly the failure mode where load-bearing design
questions get mistaken for review-time footnotes. Flagging hierarchy
explicitly:

### LOAD-BEARING — first design decision of B2, before any read-path code

`listNotesByTeudatZehut` currently does `db.getAll('patients')` directly rather
than going through `listPatients()` like the other two refactored functions.
When B2 adds the transitional read layer, decryption logic will presumably
live in `listPatients()` — and `listNotesByTeudatZehut` bypasses it. The seam
shapes where the transitional layer lives:

- **Option 1**: decryption inside `listPatients()` / `listAllNotes()`. Then
  `listNotesByTeudatZehut` must be refactored to call `listPatients()` (not
  `db.getAll('patients')` direct). Single high-level seam; cleaner.
- **Option 2**: a deeper-layer wrapper around `db.getAll` / `db.get` that all
  callers cross. More invasive but every storage function stays shape-naive.
  Probably overengineered for this scope.

Lean Option 1. **This is the FIRST thing to settle in B2 — every subsequent
read-path commit depends on it.** Do not write transitional-read code before
the routing decision is made.

### REVIEW-TIME GLANCE — watch when wiring the sentinel write, lower stakes

`patchSettings` is read-modify-write under no lock. Doc comment correctly
notes ward-helper is single-tab so it's fine. PR-B2's backfill runner is
*async, post-open* — if it calls `patchSettings` to flip the `phiEncryptedV7`
sentinel while a login flow's `persistLoginPassword` is also in flight,
that's where the single-tab assumption gets stressed within a single tab.

Mitigation already implicit: backfill runs AFTER `v1_40_0` AND AFTER
successful key derivation, both of which require login complete. So
`persistLoginPassword` is done before backfill starts. The sentinel write
at backfill completion has no concurrent caller.

Probably fine. Flag the sequence explicitly in `main.tsx` so the ordering
is intentional, not incidental — that's the entire required action. Don't
build mutex/lock machinery for this; the structural ordering is the
mitigation.

## Discipline pins to carry into B2

- **`feedback_view_source_before_cite.md`** — open the cited file before writing the dependent section.
- **`feedback_existing_utility_never_called.md`** — grep `src/{camera,i18n,notes,safety,agent}/` for existing utilities before writing new ones.
- **`feedback_ship_fix_before_diagnostic.md`** — if the design produces both a fix and a diagnostic, ship the fix first.
- **NEW pin from this session**: spec authorship covers intent, not delivery granularity. Splitting a single-PR spec into B1+B2 isn't a deviation when the staging logic itself describes two states with a bake interval. Recognize where each lane's authority actually ends.

## Bake plan for B1 — EVIDENCE, NOT A CLOCK

The bake gate is doing real work: B1's whole purpose is to prove the
scan-based read paths work in real production *before* B2's encryption
layer composes on top. "One session" is the floor, not the target.

Before opening B2, look for **evidence** the scan refactor is fine:

| Surface | What to watch for |
|---|---|
| Review readmit detection | Does it still surface prior-visit patients when entering a tz that's been seen before? (`Review.tsx:242` getPatientByTz path) |
| Census import | Names auto-fill on rows where the model emitted empty `name` but the tz matches a known patient? (`Census.tsx` listPatientsByTzMap path; this is the hottest path) |
| SOAP continuity | Continuity banner shows prior admission/SOAP for the patient? (`continuity.ts:26` listNotesByTeudatZehut path) |
| Prior-notes banner on Capture/Review | "This patient has N prior notes" appears on patient reentry? (`PriorNotesBanner.tsx` listNotesByTeudatZehut path) |
| Patient save | After extract→save, is the same tz re-resolved on the next encounter rather than minting a new id? (`notes/save.ts:158` upsertPatientByTz path) |

Telemetry sources to check:
- `weekly-medical-pwa-qa` cron (Mon 09:00 Jerusalem) — first automated probe
- `auto-audit` probes — should be green; flag any latency regression
- Live clinical use — own clinical session is the best signal

If something's off with B1, you want to know it while B2 is still unwritten.
Debugging a caller regression *underneath* a fresh encryption layer is
the exact compounding the split existed to prevent.

Open B2 when there's affirmative evidence B1 is working — not just absence
of a complaint.

## Bake plan for B2 — gate for PR-C (flag removal)

PR-C's job is to remove `localStorage.phi_encrypt_v7` as a flag so the
encrypted-blob path becomes the only path. **PR-C is non-negotiably gated
on a full-cycle real-device bake of B2's flag-on path.** No code-only
signal substitutes for the bake; "tests pass + verify-deploy" is necessary
but not sufficient. The bake is the named gate, and naming it here so the
deferral isn't silent — per `feedback_pre_commit_diagnostic_gates.md`
anti-pattern #8, silence is the failure mode.

The full cycle has five stations. All five must produce affirmative
evidence on the real clinical device (SZMC iPhone, not desktop Chrome)
before PR-C opens.

| Station | What to verify |
|---|---|
| Cold start | App boots into Unlock screen when `phi_encrypt_v7=1` AND `hasPhiKey()=false`. No PHI-rendering route is reachable behind the gate. |
| Password gate | Unlock screen accepts correct password → derives key → renders PHI routes. Wrong password is rejected without panicking the app shell or corrupting in-memory state. |
| Backfill | First-run with existing plaintext rows: the backfill runner re-shapes each row to `{id, enc}` form, the sentinel flips on completion, no read errors during the window. |
| Mixed-state read | During backfill-in-progress (or a simulated half-complete state), every reader still returns correctly — encrypted rows decrypt, leftover plaintext rows pass through, no row goes missing across the boundary. |
| All-encrypted read | After backfill completion, every one of the four caller sites — `listPatients` / `listAllNotes` / `getPatient` / `getNote`, plus the `listNotesByTeudatZehut` path however the read-layer seam was resolved in B2 — returns correctly-decrypted data on patient reentry. |

For each station, log evidence before claiming the station passed.
Evidence shape: device + iOS version + timestamp + station + observed
behavior + expected behavior + verdict. "It worked on my desktop" doesn't
count; "clinical iPhone, real wifi, real patient list, evidence row
written" does.

**Path choice for the evidence log — surface this explicitly when opening
the bake session.** Two options:
- `.audit_logs/2026-MM-DD-pr-b2-bake-evidence.md` — matches existing
  ward-helper convention for workstream briefs, but `.audit_logs/` is
  gitignored. Terminal-Claude-readable from this machine; invisible to
  any fresh-clone / web-Claude review (the visibility gotcha named in
  workspace CLAUDE.md).
- `docs/audit/2026-MM-DD-pr-b2-bake-evidence.md` — tracked path, the
  documented escape hatch from workspace CLAUDE.md for evidence that
  needs cross-Claude visibility. PR-C is exactly the kind of decision
  where fresh-eye review of the bake evidence is the value.

Lean tracked (`docs/audit/`) for the bake evidence specifically — the
gate is meant to be auditable across lanes, not a terminal-only artifact.
This kickoff brief lives in `.audit_logs/` per existing pattern, which
is itself a downstream of the same visibility gotcha; flag separately if
that pattern should change for workstream briefs generally.

If any station fails, B2 needs revision before PR-C is drafted — do not
reach for the flag-removal PR as a way to force-resolve a B2 bug. The
B1→B2 split existed to keep encryption composition off a broken read
path; B2→PR-C is the same compounding logic at a higher cost.

## PR-C scope (flag removal — after the bake passes)

| Item | Approx lines |
|---|---|
| Remove `localStorage.phi_encrypt_v7` read in main.tsx; encrypted path becomes default | ~5 |
| Remove flag-off branches in listPatients / listAllNotes / getPatient / getNote (and the listNotesByTeudatZehut path) | ~30 |
| Remove backfill trigger flag-gate (backfill runs unconditionally on first sentinel-missing session) | ~10 |
| Remove flag-off branches in tests; rename "flag-on equivalent to today" tests to canonical names | ~50 |
| Update `CLAUDE.md` invariants — drop the "flag may be off" caveat, promote encryption to the unconditional invariant | ~5 |

Total: ~100 lines. Trivial code; the load-bearing piece was the bake evidence.

## Open-the-B2-session prompt

> Resuming PR-B2 — PHI-at-rest encryption wire-up. main is at the B1
> squash commit (schema v7, scan-based callers). PR-A's crypto/phi.ts
> primitives are in the bundle as dead code. patchSettings is the
> Settings-update primitive.
>
> Read these first:
> 1. ~/repos/ward-helper/.audit_logs/2026-05-14-pr-b2-kickoff-brief.md (this file)
> 2. ~/repos/ward-helper/src/crypto/phi.ts (the primitives B2 wires up)
> 3. ~/repos/ward-helper/src/storage/indexed.ts (the v7 schema + scan-based functions B2 must wrap)
> 4. The four caller files: Review.tsx, Census.tsx, continuity.ts, PriorNotesBanner.tsx
> 5. ~/repos/ward-helper/CLAUDE.md
>
> First design decision (web Claude's open question from PR #166 review):
> where does the transitional read layer live — `listPatients()` only,
> or a deeper `db.getAll` wrapper that listNotesByTeudatZehut also
> crosses? Surface that to me before writing code.
>
> Branch: `claude/term-phi-encryption-pr-b2-encrypt-wire-up`
> Branch protection: PR-based, never push to main.
> CI gate: `bash scripts/verify-deploy.sh` after merge.
