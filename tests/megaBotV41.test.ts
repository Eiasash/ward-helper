/**
 * megaBotV41.test.ts — v4.1 regression guards for the mega-bot toolchain.
 *
 * These two tests pin the bug classes that motivated v4.1:
 *
 *   1. The orchestrator's `bySubject` regex must search BOTH `b.what` and
 *      `b.evidence`. v4 bug: regex looked at evidence only, but V4 sub-bots
 *      embed `_botSubject:X` inside the `what` log line, so all 936 flags
 *      landed in `_untagged`. After v4.1, `(b.what + ' ' + b.evidence)`
 *      should match.
 *
 *   2. Schema invariant: every `scen*` export in `scripts/lib/subBotsV4.mjs`
 *      that calls `page.evaluate(` MUST also call `waitForSubject(` first
 *      (within the same function body). v4 bug class: ~195 HIGH false-
 *      positives per run from sub-bots reading body innerText before React
 *      mount. The waitForSubject helper is the canonical fix; this test
 *      catches future drift at PR-review time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ───────────────────────────────────────────────────────────────────────────
// Test 1 — bySubject regex catches `_botSubject:` in either field
// ───────────────────────────────────────────────────────────────────────────

/**
 * Replicates the v4.1 orchestrator extractor exactly so this test pins the
 * shape. Keep in sync with `scripts/ward-helper-mega-bot.mjs::writeReport()`.
 */
function extractBotSubject(b: { what?: string; evidence?: string }): string | null {
  const search = (b.what || '') + ' ' + String(b.evidence || '');
  const m = search.match(/_botSubject:(\w+)/);
  return m ? m[1] : null;
}

describe('mega-bot v4.1 — bySubject extractor pins _botSubject in either field', () => {
  it('extracts from b.what (V4 sub-bot pattern)', () => {
    // Verbatim from the wm-2026-05-10T19-16-32 run that exposed the bug.
    const flag = {
      what: 'surgery date input missing | _botSubject:orthoCalcMath',
      evidence: undefined,
    };
    expect(extractBotSubject(flag)).toBe('orthoCalcMath');
  });

  it('extracts from b.evidence (legacy pattern)', () => {
    const flag = {
      what: 'something',
      evidence: 'with details | _botSubject:emailToSelf',
    };
    expect(extractBotSubject(flag)).toBe('emailToSelf');
  });

  it('extracts when both fields present (what wins by position)', () => {
    const flag = {
      what: 'leading | _botSubject:resetPasswordLanding',
      evidence: 'trailing | _botSubject:morningRoundsPrep',
    };
    // Doesn't matter which wins as long as one is extracted; the test
    // documents the deterministic behavior (what is concatenated first).
    expect(extractBotSubject(flag)).toBe('resetPasswordLanding');
  });

  it('returns null for un-tagged flags', () => {
    expect(extractBotSubject({ what: 'no tag here', evidence: 'also none' })).toBeNull();
  });

  it('does NOT match provenance:random_click as a botSubject', () => {
    // The tagged-random-click chaos type uses `provenance:random_click`,
    // a different tag. The extractor must not mistake it for _botSubject.
    const flag = {
      what: 'random click on "..." | _provenance:random_click',
      evidence: undefined,
    };
    expect(extractBotSubject(flag)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 2 — schema invariant: every scen* in subBotsV4.mjs that does
//          page.evaluate must also do waitForSubject
// ───────────────────────────────────────────────────────────────────────────

/**
 * Parses the source of subBotsV4.mjs at lint-test time and checks per-export
 * that `page.evaluate(` and `waitForSubject(` both appear. Source-level
 * (not runtime) — catches the regression class at PR-review time which is
 * cheaper than catching it after a 30-min Opus run.
 */
function parseExportedSubBots(src: string): Array<{ name: string; body: string }> {
  // Match `export async function <name>(... ) { <body> }` — needs balanced
  // braces, so iterate character-by-character.
  const out: Array<{ name: string; body: string }> = [];
  const exportRe = /export\s+async\s+function\s+(scen\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = exportRe.exec(src)) !== null) {
    const name = m[1];
    // Find the opening brace after the parameter list.
    let i = m.index + m[0].length;
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) continue;
    let depth = 1;
    const start = i + 1;
    i++;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    out.push({ name, body: src.slice(start, i - 1) });
  }
  return out;
}

describe('mega-bot v4.1 — schema invariant: subBotsV4 race-prone reads need waitForSubject', () => {
  const src = readFileSync(
    resolve(__dirname, '..', 'scripts', 'lib', 'subBotsV4.mjs'),
    'utf8',
  );
  const subBots = parseExportedSubBots(src);

  it('parses at least 4 scen* exports (regression guard against parser drift)', () => {
    expect(subBots.length).toBeGreaterThanOrEqual(4);
    const names = subBots.map((s) => s.name).sort();
    expect(names).toContain('scenOrthoCalcMath');
    expect(names).toContain('scenResetPasswordLanding');
  });

  // Per-sub-bot invariant check.
  for (const subBot of [
    'scenOrthoCalcMath',
    'scenResetPasswordLanding',
    'scenMorningRoundsPrep',
    'scenEmailToSelf',
  ]) {
    it(`${subBot}: if it calls page.evaluate, it must call waitForSubject first`, () => {
      const found = subBots.find((s) => s.name === subBot);
      expect(found, `${subBot} missing from subBotsV4.mjs`).toBeDefined();
      const body = found!.body;
      const usesEvaluate = /page\.evaluate\s*\(/.test(body);
      const usesWaitForSubject = /waitForSubject\s*\(/.test(body);
      if (usesEvaluate) {
        expect(
          usesWaitForSubject,
          `${subBot} calls page.evaluate but does NOT call waitForSubject — would race React mount and produce false-positive HIGH flags. Add a waitForSubject(page, [...]) ratchet at the top of the function.`,
        ).toBe(true);
      }
    });
  }
});
