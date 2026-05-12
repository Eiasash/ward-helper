import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-expect-error - .mjs bot script doesn't ship d.ts; vitest resolves at runtime.
import { localIsoDateOffset } from '../scripts/lib/subBotsV4.mjs';

// 2026-05-12 — workstream #2 follow-up. The `scenOrthoCalcMath` sub-bot was
// using `Date.toISOString().slice(0, 10)` to compute "today - 7 days" as a
// UTC YYYY-MM-DD string, but the app reads the resulting date input against
// LOCAL today when computing POD. At Asia/Jerusalem (UTC+2/+3) in the
// local-after-midnight, UTC-before-midnight window (00:00–02:59 winter,
// 00:00–03:59 summer DST), the UTC date lags the local date by one day.
// Result: bot injected "yesterday-7d" (8 days back in local terms), app
// computed POD 8, bot expected POD 7 → CRITICAL `pod-wrong` cascade.
//
// Three test cases below cover the failure-window case and two non-window
// cases for parity. The fix routes through `localIsoDateOffset` which uses
// `.toLocaleDateString('en-CA')` for local-time YYYY-MM-DD.
//
// Tests pinned to TZ=Asia/Jerusalem via cross-env in package.json — same
// pin as the existing orthoCalc TZ-regression block.

describe('localIsoDateOffset (TZ regression — Asia/Jerusalem)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Case A — Jerusalem early-morning (within failure window)', () => {
    // 2026-05-12 01:00 Jerusalem = 2026-05-11 22:00 UTC (winter UTC+2).
    // Pre-fix UTC arithmetic returned "2026-05-04" (UTC-date for 7d-ago
    // moment). Local-today is 2026-05-12, so app's POD = 8, bot expected 7.
    // Post-fix should return "2026-05-05" (local-date for 7d-ago).
    vi.setSystemTime(new Date('2026-05-11T23:00:00Z')); // = 2026-05-12 01:00 Jerusalem winter
    expect(localIsoDateOffset(7)).toBe('2026-05-05');
  });

  it('Case B — Jerusalem afternoon (outside failure window)', () => {
    // 2026-05-12 14:00 Jerusalem = 2026-05-12 12:00 UTC.
    // Both UTC and local arithmetic produce "2026-05-05" here.
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
    expect(localIsoDateOffset(7)).toBe('2026-05-05');
  });

  it('Case C — Jerusalem just before local midnight (outside failure window)', () => {
    // 2026-05-12 23:30 Jerusalem DST (UTC+3) = 2026-05-12 20:30 UTC.
    // Both UTC and local arithmetic produce "2026-05-05" here.
    // (Test author note 2026-05-12: initial draft used UTC 21:30 which is
    // actually 00:30 Jerusalem May 13 — inside the failure window — and
    // helper correctly returned "2026-05-06". The test caught the
    // author's own UTC↔Jerusalem confusion; same class of TZ mistake
    // as the production bug. Adjusted UTC time to genuinely sit before
    // local midnight.)
    vi.setSystemTime(new Date('2026-05-12T20:30:00Z'));
    expect(localIsoDateOffset(7)).toBe('2026-05-05');
  });

  it('Case D — offset 0 returns today (no offset)', () => {
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
    expect(localIsoDateOffset(0)).toBe('2026-05-12');
  });

  it('Case E — offset 1 returns yesterday locally (regression for MorningArchivePrompt sibling pattern)', () => {
    // Sibling code at subBotsV4.mjs:167 and megaPersona.mjs:899 uses the
    // same .toLocaleDateString('en-CA') pattern with offset=1. This test
    // mirrors that expectation against the extracted helper.
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
    expect(localIsoDateOffset(1)).toBe('2026-05-11');
  });
});
