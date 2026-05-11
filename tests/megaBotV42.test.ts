/**
 * megaBotV42.test.ts — runtime ratchet for the v4.2 mega-bot telemetry.
 *
 * Pins the per-sub-bot `waitForSubjectCalled >= iterationCompleted` invariant.
 * v4.1 introduced waitForSubject() ratchets at the source level + a static
 * schema test that every `scen*` export in subBotsV4.mjs containing
 * `page.evaluate(` also calls `waitForSubject(`. v4.2 adds the runtime
 * counterpart — the source check catches missing CALLS at PR-review time;
 * this runtime check catches PATHS the static test cannot reach (conditional
 * branches whose page.evaluate happens to skip the wait, refactor leftovers
 * where the wait moved into a non-default code path, etc.).
 *
 * Why `>=` not `==`: chaos types (back-mash, visibility cycle, midnight
 * rollover, …) can legitimately abort an iteration mid-stream AFTER the wait
 * helper was called. So sum(waitCalled) may exceed sum(iterCompleted) for any
 * given sub-bot — that is a healthy run, not a violation. The bug we want to
 * catch is the inverse: completed > waitCalled means a sub-bot path produced
 * a productive return without calling the helper, which is exactly the v4-era
 * race-the-React-mount false-positive class the ratchet was added to suppress.
 */

import { describe, it, expect } from 'vitest';
import {
  checkV42Invariant,
  V4_SUB_BOTS_REQUIRING_WAIT,
} from '../scripts/lib/v42Invariant.mjs';

describe('mega-bot v4.2 — per-sub-bot waitForSubject ratchet', () => {
  it('passes when every iteration of a v4 sub-bot is preceded by waitForSubject', () => {
    const timeline = [
      { botSubject: 'emailToSelf', waitForSubjectCalled: true, iterationCompleted: true },
      { botSubject: 'emailToSelf', waitForSubjectCalled: true, iterationCompleted: true },
      { botSubject: 'morningRoundsPrep', waitForSubjectCalled: true, iterationCompleted: true },
      { botSubject: 'orthoCalcMath', waitForSubjectCalled: true, iterationCompleted: true },
    ];
    const r = checkV42Invariant(timeline);
    expect(r.violators).toEqual([]);
    expect(r.perSubBot.emailToSelf).toEqual({ waitCalled: 2, iterCompleted: 2 });
    expect(r.perSubBot.morningRoundsPrep).toEqual({ waitCalled: 1, iterCompleted: 1 });
    expect(r.perSubBot.orthoCalcMath).toEqual({ waitCalled: 1, iterCompleted: 1 });
    // resetPasswordLanding initialized to zeros even though never fired in this fixture.
    expect(r.perSubBot.resetPasswordLanding).toEqual({ waitCalled: 0, iterCompleted: 0 });
  });

  it('FAILS when a v4 sub-bot completes an iteration without calling waitForSubject', () => {
    const timeline = [
      { botSubject: 'emailToSelf', waitForSubjectCalled: false, iterationCompleted: true },
      { botSubject: 'emailToSelf', waitForSubjectCalled: true, iterationCompleted: true },
    ];
    const r = checkV42Invariant(timeline);
    expect(r.violators).toHaveLength(1);
    expect(r.violators[0]?.[0]).toBe('emailToSelf');
    expect(r.violators[0]?.[1]).toEqual({ waitCalled: 1, iterCompleted: 2 });
  });

  it('allows aborted iterations (waitCalled but not completed) — chaos can legitimately interrupt', () => {
    // Three iterations: chaos aborted iter 1 and 2 after the wait; iter 3 ran
    // through to completion. Wait fired 3 times, completion fired once → ratchet OK.
    const timeline = [
      { botSubject: 'orthoCalcMath', waitForSubjectCalled: true, iterationCompleted: false },
      { botSubject: 'orthoCalcMath', waitForSubjectCalled: true, iterationCompleted: false },
      { botSubject: 'orthoCalcMath', waitForSubjectCalled: true, iterationCompleted: true },
    ];
    const r = checkV42Invariant(timeline);
    expect(r.violators).toEqual([]);
    expect(r.perSubBot.orthoCalcMath).toEqual({ waitCalled: 3, iterCompleted: 1 });
  });

  it('ignores sub-bots not in the v4 allowlist (v1-v3 core sub-bots, chaos events)', () => {
    const timeline = [
      // v1-v3 core sub-bots — bespoke poll loops, not waitForSubject. They
      // would emit waitForSubjectCalled:false, iterationCompleted:true legitimately.
      { botSubject: 'admission', waitForSubjectCalled: false, iterationCompleted: true },
      { botSubject: 'soap', waitForSubjectCalled: false, iterationCompleted: true },
      { botSubject: 'consult', waitForSubjectCalled: false, iterationCompleted: true },
      { botSubject: 'history', waitForSubjectCalled: false, iterationCompleted: true },
      { botSubject: 'settings', waitForSubjectCalled: false, iterationCompleted: true },
      // Chaos types — also legitimately false on both fields.
      { botSubject: 'chaos-back-mash', waitForSubjectCalled: false, iterationCompleted: true },
    ];
    const r = checkV42Invariant(timeline);
    expect(r.violators).toEqual([]);
    // None of the above appear in perSubBot — only v4 allowlist names do,
    // each pre-initialized to zeros.
    expect(Object.keys(r.perSubBot).sort()).toEqual(
      [...V4_SUB_BOTS_REQUIRING_WAIT].sort()
    );
    for (const name of V4_SUB_BOTS_REQUIRING_WAIT) {
      expect(r.perSubBot[name]).toEqual({ waitCalled: 0, iterCompleted: 0 });
    }
  });

  it('handles malformed/null/undefined events without throwing', () => {
    // Robustness — JSONL parse errors null out lines, and partially-populated
    // events should not crash the analyzer.
    const timeline = [
      null,
      undefined,
      {},
      { botSubject: null },
      { botSubject: undefined },
      { botSubject: 123 as unknown as string },  // wrong type — defensive guard
      { botSubject: 'emailToSelf', waitForSubjectCalled: true, iterationCompleted: true },
    ];
    const r = checkV42Invariant(timeline as Parameters<typeof checkV42Invariant>[0]);
    expect(r.violators).toEqual([]);
    expect(r.perSubBot.emailToSelf).toEqual({ waitCalled: 1, iterCompleted: 1 });
  });

  it('catches the live-bug shape — multi-violator across two v4 sub-bots', () => {
    // Synthetic but realistic: orthoCalcMath had a refactor that moved waitForSubject
    // behind a feature flag; emailToSelf had a new error-recovery path that returned
    // after logBug without calling the helper. This is exactly the kind of regression
    // the static schema test in megaBotV41 cannot catch (the calls EXIST in the
    // source, but the runtime path skips them).
    const timeline = [
      // emailToSelf: 1 healthy, 2 violations
      { botSubject: 'emailToSelf', waitForSubjectCalled: true, iterationCompleted: true },
      { botSubject: 'emailToSelf', waitForSubjectCalled: false, iterationCompleted: true },
      { botSubject: 'emailToSelf', waitForSubjectCalled: false, iterationCompleted: true },
      // orthoCalcMath: 2 healthy, 1 violation
      { botSubject: 'orthoCalcMath', waitForSubjectCalled: true, iterationCompleted: true },
      { botSubject: 'orthoCalcMath', waitForSubjectCalled: true, iterationCompleted: true },
      { botSubject: 'orthoCalcMath', waitForSubjectCalled: false, iterationCompleted: true },
      // morningRoundsPrep: clean
      { botSubject: 'morningRoundsPrep', waitForSubjectCalled: true, iterationCompleted: true },
    ];
    const r = checkV42Invariant(timeline);
    expect(r.violators).toHaveLength(2);
    const violatorMap = Object.fromEntries(r.violators);
    expect(violatorMap.emailToSelf).toEqual({ waitCalled: 1, iterCompleted: 3 });
    expect(violatorMap.orthoCalcMath).toEqual({ waitCalled: 2, iterCompleted: 3 });
    // morningRoundsPrep is NOT a violator.
    expect(violatorMap.morningRoundsPrep).toBeUndefined();
  });
});

describe('mega-bot v4.2 — V4_SUB_BOTS_REQUIRING_WAIT allowlist shape', () => {
  it('contains exactly the four v4 sub-bots and is frozen', () => {
    // Pins the allowlist size and contents — adding a v4 sub-bot must update
    // both subBotsV4.mjs (where the export lives) and this test in the same diff.
    expect([...V4_SUB_BOTS_REQUIRING_WAIT].sort()).toEqual([
      'emailToSelf',
      'morningRoundsPrep',
      'orthoCalcMath',
      'resetPasswordLanding',
    ]);
    // The export is frozen so accidental mutation at runtime is impossible.
    expect(Object.isFrozen(V4_SUB_BOTS_REQUIRING_WAIT)).toBe(true);
  });
});
