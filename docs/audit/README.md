# docs/audit/ — durable session-handoff artifacts

This directory is the canonical, **git-tracked** location for the
artifacts a multi-session workstream depends on:

- Kickoff briefs for upcoming PRs (open-the-session prompts, scope,
  bake plans, design questions).
- Locked design pins (decisions that survive across sessions and must
  not drift).
- Post-PR retrospectives and bake-evidence reports.
- Tombstones for obsolete kickoff prompts (preserved with a tombstone
  header pointing to the successor).

## Why this directory exists, not `.audit_logs/`

`.audit_logs/` is gitignored (see workspace-level `.gitignore`). That's
fine for ephemeral artifacts (overnight chaos-bot reports, scratch
session notes), but it makes the directory invisible to:

- A fresh-clone web-Claude review
- A `claude/term2-*` parallel terminal session starting from origin
- A future-Claude session that starts cold without local disk state
- Any reviewer doing the cross-session "is the design I'm reviewing
  the one we locked?" check

A handoff doc that the next session's reviewer can't see is an
honor-system promise. The whole point of the three-gate fresh-eye
cadence (memory: `feedback_three_gate_fresh_eye_cadence.md`, or its
consolidated successor about repo-state-claims-as-citations) is to
verify against filesystem state — and that verification has to be
able to reach the briefs being verified.

So: **anything load-bearing for a future session goes here, in
`docs/audit/`. Truly ephemeral things stay in `.audit_logs/`.**

## Naming convention

- Date-tagged: `<YYYY-MM-DD>-<topic>.md`
- Kickoff briefs: `<date>-pr-<id>-kickoff-brief.md`
- Design pins: `<date>-pr-<id>-design-pins.md`
- Tombstones: `<date>-<topic>-OBSOLETE.md` with a tombstone header
  pointing to the successor file (do not delete obsoleted files in
  this directory — preserve as historical record).

## What does NOT belong here

- Overnight chaos-bot reports → `.audit_logs/` (ephemeral)
- Scratch session notes → `.audit_logs/`
- PR body drafts → `.audit_logs/` (one-shot consumed by `gh pr create`)
- Live URL / Chameleon paste-target fixtures → `.audit_logs/`
- Anything that becomes meaningless once the next session starts

## Pre-existing tracked docs

`docs/` already holds some tracked handoff artifacts at root level
(e.g. `NEXT_SESSION_BRIEF-morning-rounds-prep.md`,
`WEB_CLAUDE_HANDOFF-2026-05-09.md`). Going forward, the convention is
to land new ones under `docs/audit/` to keep the tracked-handoff
surface organized. The root-level pre-existing files can stay where
they are (don't churn for cleanliness).
