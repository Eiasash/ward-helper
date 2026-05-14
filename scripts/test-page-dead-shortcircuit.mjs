#!/usr/bin/env node
/**
 * test-page-dead-shortcircuit.mjs — manual integration test of the PR #150
 * page-dead short-circuit contract.
 *
 * IMPORTANT (2026-05-12, post-Task-3 of persona rebound workstream): this
 * script simulates the catch block's behavior PRIOR to Task 3 of the
 * persona-rebound workstream (commit 2bc6bed). Pre-Task-3, the catch block
 * emitted a HIGH `chaos-infra/page-closed` bug and bailed via `break`.
 * Post-Task-3, the catch block calls `tryRecoverFromPageDeath` which emits
 * either `page-closed-recovered` (LOW, on rebound success) or
 * `page-closed-unrecoverable` (HIGH, on rebound failure), and the loop
 * may `continue` instead of `break`.
 *
 * The simulation in this script does NOT exercise the new Layer 2 rebound
 * path. Its assertions happen to pass under the new contract by virtue of
 * `.includes('page-closed')` substring matching, but for the wrong reason
 * (no rebound attempt is made). To test the new contract, see the unit
 * tests in `tests/megaPersonaRebound.test.ts` (covers both helper paths
 * in isolation) plus the live `npm test` suite.
 *
 * Retained as historical regression coverage for the bare-bail short-circuit
 * design. If a future change makes this file conflict with new bot logic,
 * delete it rather than retrofit — its semantics are now obsolete.
 *
 * 2026-05-12 — workstream #2 fallback test. Pre-committed in
 * STAGE3_GATES_2026-05-11.md: if the 5-min fixture produces 0 natural
 * TargetClosedError events, this script must run as the force-close
 * fallback exercise. The pre-committed criteria — bounded retry, LOW
 * count per persona ≤ 10, exit timing ≤ 30s of the closure event —
 * apply here too.
 *
 * What this exercises:
 *   1. Spins up a real Playwright browser + context + page.
 *   2. Verifies that closing the context produces an error shape that
 *      `isPageDeadError` (in scripts/lib/megaPersona.mjs) matches — i.e.,
 *      the detection contract holds against the actual Playwright error
 *      surface, not just synthetic strings.
 *   3. Simulates the persona main-loop's outer try/catch around an
 *      action-shaped page.evaluate(), with a setTimeout that closes the
 *      context mid-loop. Asserts the loop exits within ≤30s of closure,
 *      `tally.pageClosedAt` is set, exactly one HIGH `page-closed` bug
 *      is logged, and the LOW count from this persona is ≤ 10.
 *
 * Run: `node scripts/test-page-dead-shortcircuit.mjs`
 *   Exits 0 on pass, 1 on fail. Prints a structured summary.
 */

import { chromium } from 'playwright';
import { isPageDeadError } from './lib/megaPersona.mjs';

// ── Test fixtures ────────────────────────────────────────────────────────────

const URL = 'https://eiasash.github.io/ward-helper/';
const CLOSE_AFTER_MS = 3000;   // close the context 3s into the loop
const MAX_TICK_MS = 30000;     // outer safety — fail if loop runs past this
const TICK_INTERVAL_MS = 100;  // simulate ~10 actions/sec

let pass = true;
const fail = (msg) => { console.error(`FAIL: ${msg}`); pass = false; };
const ok = (msg) => { console.log(`PASS: ${msg}`); };

// ── (1) Detection contract: real Playwright error matches isPageDeadError ────

async function checkDetectionContract() {
  console.log('\n=== (1) Detection contract test ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('about:blank');

  await context.close();

  let err;
  try {
    await page.evaluate(() => 1 + 1);
  } catch (e) {
    err = e;
  }
  await browser.close();

  if (!err) {
    fail('Expected page.evaluate after context.close() to throw');
    return;
  }
  console.log(`  caught error message: "${err.message?.slice(0, 120)}"`);
  if (!isPageDeadError(err)) {
    fail(`isPageDeadError did NOT match the real Playwright TargetClosedError. Pattern needs widening.`);
    return;
  }
  ok('isPageDeadError matches the real Playwright TargetClosedError shape');
}

// ── (2) Integration: simulated persona loop + mid-loop close ─────────────────

async function checkIntegration() {
  console.log('\n=== (2) Integration test: simulated persona loop ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  // Tally + logBug capture, mirroring megaPersona.mjs runPersona shape.
  const tally = { actions: 0, errors: 0, pageClosedAt: null };
  const bugs = [];
  const logBug = (severity, scenarioId, name, message) => {
    bugs.push({ severity, scenarioId, name, message });
  };

  // Schedule the force-close.
  setTimeout(() => context.close().catch(() => {}), CLOSE_AFTER_MS);

  // Run an action loop that mirrors the runPersona catch block exactly.
  const t0 = Date.now();
  let closureSeenAt = null;
  let actionsThisCycle = 0;
  let exitReason = 'tick-cap';

  while (Date.now() - t0 < MAX_TICK_MS) {
    actionsThisCycle++;
    try {
      // Simulate an action — page.evaluate is the realistic shape for what
      // throws when the page/context dies.
      await page.evaluate(() => document.title);
      tally.actions++;
    } catch (err) {
      tally.errors++;
      if (isPageDeadError(err)) {
        tally.pageClosedAt = actionsThisCycle;
        closureSeenAt = Date.now();
        logBug('HIGH', 'chaos-infra', `Dr.Test/page-closed`,
          `persona bailed: page closed at tick ${actionsThisCycle} during simulated-action (${(err.message || String(err)).slice(0, 80)})`);
        exitReason = 'short-circuit';
        break;
      }
      logBug('LOW', 'test', `Dr.Test/sim-action/exception`,
        `harness exception: ${err.message?.slice(0, 100)}`);
      // softRecover() simulation — no-op for the test since context is dead.
    }
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS));
  }

  const wallMs = Date.now() - t0;
  await browser.close().catch(() => {});

  console.log(`  wall: ${wallMs}ms  reason: ${exitReason}  totalActions: ${tally.actions}  errors: ${tally.errors}`);
  console.log(`  tally.pageClosedAt: ${tally.pageClosedAt}  bugs.length: ${bugs.length}`);
  console.log(`  HIGH count: ${bugs.filter((b) => b.severity === 'HIGH').length}  LOW count: ${bugs.filter((b) => b.severity === 'LOW').length}`);

  // ── Apply pre-committed criteria ──

  if (exitReason !== 'short-circuit') {
    fail(`Loop did not exit via short-circuit. Reason: ${exitReason}`);
    return;
  }
  ok('Loop exited via short-circuit (not tick-cap)');

  if (tally.pageClosedAt === null) {
    fail('tally.pageClosedAt was never set');
    return;
  }
  ok(`tally.pageClosedAt set to ${tally.pageClosedAt}`);

  const highBugs = bugs.filter((b) => b.severity === 'HIGH');
  if (highBugs.length !== 1) {
    fail(`Expected exactly 1 HIGH page-closed bug, got ${highBugs.length}`);
    return;
  }
  if (!highBugs[0].name.includes('page-closed')) {
    fail(`HIGH bug name doesn't contain 'page-closed': ${highBugs[0].name}`);
    return;
  }
  ok(`Exactly one HIGH 'page-closed' bug logged`);

  // Bounded retry: actions after closure-detection ≤ 0 (we broke immediately).
  // Pre-commit allows ≤ 2 for in-flight ticks; in this simpler test we hit 0
  // because there's no concurrent in-flight work. ≤ 2 satisfies.
  const lowBugs = bugs.filter((b) => b.severity === 'LOW');
  if (lowBugs.length > 10) {
    fail(`LOW count for this persona > 10 (got ${lowBugs.length}) — bounded-retry criterion violated. Pre-fix would have been hundreds.`);
    return;
  }
  ok(`LOW count for this persona ≤ 10 (got ${lowBugs.length})`);

  // Exit timing: ≤ 30s of closure event. Since we close at CLOSE_AFTER_MS
  // and the loop runs at TICK_INTERVAL_MS, exit should be within ~200ms of
  // the closure. We allow up to 30s per the pre-commit, but expect << 1s.
  const exitDelayMs = closureSeenAt ? closureSeenAt - (t0 + CLOSE_AFTER_MS) : null;
  if (exitDelayMs === null || exitDelayMs > 30000) {
    fail(`Loop took ${exitDelayMs}ms to detect closure after the close event (criterion: ≤ 30000ms)`);
    return;
  }
  ok(`Loop detected closure within ${exitDelayMs}ms of the close event (criterion: ≤ 30000ms)`);
}

// ── Run ──────────────────────────────────────────────────────────────────────

await checkDetectionContract();
await checkIntegration();

console.log('\n=== summary ===');
console.log(pass ? 'OVERALL: PASS' : 'OVERALL: FAIL');
process.exit(pass ? 0 : 1);
