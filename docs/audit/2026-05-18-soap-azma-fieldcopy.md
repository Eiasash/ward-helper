# SOAP → AZMA field-copy + delta-aware A/P

Date: 2026-05-18 · Branch: `claude/term-soap-azma-fieldcopy` · Author: terminal Claude
Status: **SPEC — not yet approved, no code written.** Supersedes the closed PR #201
(structural validator), which was the wrong fix for the real (SOAP) pain.

## Ground truth (anchored from a real de-identified sample + user)

- AZMA's SOAP entry has **4 separate, pre-labeled fields** (S / O / A / P). You
  paste each section into its own field.
- The **P field persists across SOAP sessions** — it carries forward until
  overwritten; S/O/A are fresh each round.
- ward-helper currently emits one note body with Hebrew section headers
  (`דיווח המטופל:` / `בדיקה גופנית וממצאי עזר:` / `מסקנה והערכה:` / `לביצוע:` /
  `תוכנית טיפול (יעדי טיפול):`). Per-section copy (`NoteEditor.onCopySection`)
  copies the body **including its header line**.

## Confirmed defects

1. **Header duplication.** Pasting a section into AZMA's pre-labeled field puts
   `דיווח המטופל:` on top of AZMA's own S label.
2. **Mis-segmentation.** `splitIntoSections`' header grammar fragments SOAP: A
   splits into `מסקנה והערכה` (capsule) + `בעיות`, and
   `תוכנית טיפול (יעדי טיפול)` is **swallowed into the P section** because its
   parentheses fail the Hebrew-label header regex. So per-section copy is not
   AZMA-4-field-ready even ignoring defect 1. (Evidence: the real sample note.)
3. **Bidi jumble.** Hebrew/English reorder on paste into AZMA's SOAP fields.
   `wrapForChameleon` was tuned for Chameleon's main note field; AZMA's SOAP
   field control may treat RLM/LRM differently. **NOT yet diagnosable —
   blocked on one concrete de-identified before→after line.**

## Decided requirements (user-anchored)

- **R1 — 4 field-ready S/O/A/P copies (UI + segmentation).** SOAP only. Each
  copy is header-less and correctly segmented:
  - S = `דיווח המטופל` body
  - O = `בדיקה גופנית וממצאי עזר` body
  - A = capsule + `בעיות` + `*domain` bullets, together
  - P = `לביצוע` body, **without** `תוכנית טיפול` (which belongs with A's goal,
    not P)
  Full-note copy and all non-SOAP types unchanged.
- **R2 — P as explicit delta.** Generated P states what CHANGED vs the prior
  SOAP's P (added / stopped / continued), so the user merges into AZMA's
  carried-forward P rather than reconciling by hand. Lean.
- **R3 — A as delta with verbosity gradient.** A is delta vs prior A, **more
  verbose than P**. First SOAP after admission = most verbose (full
  capsule + problems). Subsequent SOAPs lean toward update/delta.

> R2/R3 are largely the *intended* behavior of the existing
> `buildSoapPromptPrefix` continuity path (first-vs-subsequent; Same/Changed/
> Resolved/New trajectory for A bullets). The gap: P has no explicit
> delta framing, and the verbosity gradient isn't explicit. R2/R3 are
> **targeted prompt strengthenings, not a new delta engine.** Do not rebuild
> continuity.

- **R4 — bidi.** Fix Hebrew/English jumble on AZMA SOAP-field paste. **BLOCKED**
  pending a concrete repro.

## Constraints

- ward-helper CLAUDE.md: minimum code, nothing speculative, touch only what you
  must, PR-based (never main), `npm run check`+`test`+`build` gate, bundle
  budget, prefix order mirrors the skill (R1 changes copy/segmentation, NOT
  prompt order; R2/R3 change P/A *semantics* not section order).
- Workspace CLAUDE.md: a behavior-changing prompt edit (R2/R3) is a non-trivial
  design spec → route through filesystem-grounded fresh-eye review before lock.

## Phased plan (small, verifiable increments)

- **Phase 1 — R1 (low risk, no generation change).** SOAP-specific 4-field
  segmenter + 4 header-less copy buttons in `NoteEditor`. Pure/testable.
  Success: each of S/O/A/P pastes into its AZMA field with no header line and
  correct content (תוכנית טיפול with A's goal, not P); other note types &
  full-copy byte-identical; check+test+build green; regression fixture from the
  real de-identified note.
- **Phase 2 — R2 + R3 (behavior change, higher risk).** Targeted SOAP prompt
  edits (P-delta framing; explicit verbosity gradient). Spec locked +
  fresh-eye review first. Prefer the smallest prompt delta; eval before/after.
- **Phase 3 — R4 (bidi).** Gated on a concrete de-identified before→after.

## Open / housekeeping

- PR #201 closed (wrong direction). Its branch
  `claude/term-note-structure-validator` holds abandoned dead code
  (`validateNote.ts`, test, doc, an `orchestrate.ts` edit) — never merged,
  `main` unaffected; delete the branch in cleanup.
