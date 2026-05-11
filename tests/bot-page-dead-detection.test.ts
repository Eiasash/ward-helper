import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs bot script doesn't ship d.ts; vitest resolves it at runtime.
import { isPageDeadError } from '../scripts/lib/megaPersona.mjs';

// 2026-05-12 — Workstream #2 verified-exercise gate per
// feedback_pre_commit_diagnostic_gates.md anti-pattern #5. The Stage 3
// cascade post-mortem identified that the persona main-loop catch was
// retrying actions on dead pages thousands of times before the 300s idle
// watchdog fired. The fix adds a short-circuit on page/context/frame-death
// errors. This test directly exercises the detection branch — without it,
// a fixture run that happens to not hit a natural page-death would
// trivial-absence its way to a pass.

describe('isPageDeadError', () => {
  it('matches TargetClosedError-shaped messages from Playwright', () => {
    expect(isPageDeadError(new Error('TargetClosedError: Target page, context or browser has been closed'))).toBe(true);
    expect(isPageDeadError(new Error('Target page, context or browser has been closed'))).toBe(true);
    expect(isPageDeadError(new Error('Browser has been closed'))).toBe(true);
  });

  it('matches frame-detachment errors', () => {
    expect(isPageDeadError(new Error('Frame has been detached'))).toBe(true);
    expect(isPageDeadError(new Error('frame has been detached'))).toBe(true);
  });

  it('matches execution-context destruction errors', () => {
    expect(isPageDeadError(new Error('Execution context was destroyed, most likely because of a navigation'))).toBe(true);
  });

  it('matches CDP protocol-error variants', () => {
    expect(isPageDeadError(new Error('Protocol error (Page.navigate): Target closed.'))).toBe(true);
  });

  it('matches page-closed wording', () => {
    expect(isPageDeadError(new Error('page has been closed'))).toBe(true);
  });

  it('does NOT match unrelated errors that should continue the loop', () => {
    expect(isPageDeadError(new Error('Element is not visible'))).toBe(false);
    expect(isPageDeadError(new Error('Timeout 4000ms exceeded'))).toBe(false);
    expect(isPageDeadError(new Error('locator.click: timeout'))).toBe(false);
    expect(isPageDeadError(new Error('Some other failure'))).toBe(false);
  });

  it('returns false for falsy / missing errors', () => {
    expect(isPageDeadError(null)).toBe(false);
    expect(isPageDeadError(undefined)).toBe(false);
    expect(isPageDeadError(new Error(''))).toBe(false);
  });

  it('handles non-Error throwables', () => {
    expect(isPageDeadError('Target page, context or browser has been closed')).toBe(true);
    expect(isPageDeadError('some random string')).toBe(false);
    expect(isPageDeadError({ message: 'TargetClosedError: ...' })).toBe(true);
  });
});
