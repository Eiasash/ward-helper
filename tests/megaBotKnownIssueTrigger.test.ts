/**
 * Regression guard — the #176 H3 known-issue trigger is ARMED, by test,
 * not by a hand-checked assertion.
 *
 * History (why this test exists): the trigger was first "verified" with a
 * `node -e` that RE-IMPLEMENTED the predicate against a hand-built object.
 * A fresh-eye review correctly flagged that as layer-N of a recursion: a
 * copy structurally cannot catch a producer/consumer field-layout
 * mismatch, and "armed without a test is armed-until-the-next-refactor."
 * This test drives the REAL functions:
 *   real logBug()  →  real matchedKnownIssues()  →  real knownIssueReportLines()
 * with the EXACT call shape the real producer uses
 * (`scripts/lib/diagnostics.mjs:60`:
 *   `logBug('HIGH', scenarioId, 'unhandled-rejection', <msg>)` — 4 args,
 *   `evidence` omitted) and the EXACT original 2026-05-17 finding string.
 * If a future logBug/diagnostics field-layout drift silently disarms the
 * trigger, THIS fails — not a clinical-session triage six months later.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeEach } from 'vitest';

import {
  logBug,
  BUGS,
  matchedKnownIssues,
  knownIssueReportLines,
  KNOWN_ISSUE_TRIGGERS,
} from '../scripts/ward-helper-mega-bot.mjs';

const KICKOFF = 'docs/audit/2026-05-17-h3-cache-blob-opfs-kickoff.md';
// The exact string the 2026-05-17 mega-bot logged (verbatim, from the
// repro-spec / run-evidence docs — the generic DOMException default).
const ORIGINAL =
  'NotFoundError: A requested file or directory could not be found at the time an operation was processed.';

describe('#176 H3 known-issue trigger — armed via the REAL logBug path', () => {
  beforeEach(() => {
    BUGS.length = 0; // real shared module array; isolate each case
  });

  it('fires on the EXACT original finding via the real producer→router→renderer chain', () => {
    // Identical shape to scripts/lib/diagnostics.mjs:60 — 4 args, no evidence.
    logBug('HIGH', 'syn-wm-test-1', 'unhandled-rejection', ORIGINAL);

    // Real router over the real BUGS the real logBug just populated.
    const matched = matchedKnownIssues(BUGS);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.t.kickoff).toBe(KICKOFF);

    // Real renderer — the block writeReport() actually emits.
    const block = knownIssueReportLines(BUGS).join('\n');
    expect(block).toContain('⚠ ARMED KNOWN-ISSUE TRIGGER');
    expect(block).toContain(KICKOFF);
  });

  it('is discriminating — a benign finding produces no routing block', () => {
    logBug('MEDIUM', 'syn-wm-test-2', 'morningRounds/banner-missing',
      'MorningArchivePrompt banner did not render', 'lastArchivedDate=yesterday');
    expect(matchedKnownIssues(BUGS)).toHaveLength(0);
    expect(knownIssueReportLines(BUGS)).toEqual([]);
  });

  it('still fires when the string lands in `what` with `evidence` undefined (the real diagnostics shape)', () => {
    // Pins the producer contract the trigger depends on: diagnostics.mjs
    // passes the message as arg4 (`what`) and omits arg5 (`evidence`).
    logBug('HIGH', 's', 'unhandled-rejection', `__x__ ${ORIGINAL}`);
    const bug = BUGS[0]!;
    expect(bug.where).toBe('unhandled-rejection');
    expect(bug.what).toContain('NotFoundError');
    expect(bug.evidence).toBeUndefined();
    expect(knownIssueReportLines(BUGS).join('\n')).toContain(KICKOFF);
  });

  it('the trigger registry stays minimal (YAGNI — one rule until a 2nd real trigger)', () => {
    expect(KNOWN_ISSUE_TRIGGERS).toHaveLength(1);
    expect(KNOWN_ISSUE_TRIGGERS[0]!.match.test('NotFoundError')).toBe(true);
  });

  it('producer-side contract guard: diagnostics.mjs still routes unhandled rejections through logBug `what`', () => {
    // The reviewer's exact concern: does the REAL producer deposit the
    // string where the router reads it? Pin diagnostics.mjs:60's call
    // shape at the source so a refactor that moves the message into
    // `evidence` (or renames `where`) trips here, not in production.
    // vitest runs from the package root; resolve from cwd (import.meta.url
    // is not a file: URL under the happy-dom transform).
    const diag = readFileSync(resolve(process.cwd(), 'scripts/lib/diagnostics.mjs'), 'utf8');
    expect(diag).toMatch(
      /logBug\(\s*['"]HIGH['"]\s*,\s*scenarioId\s*,\s*['"]unhandled-rejection['"]\s*,/,
    );
  });
});
