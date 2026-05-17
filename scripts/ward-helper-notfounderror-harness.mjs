#!/usr/bin/env node
/**
 * ward-helper-notfounderror-harness — repro-harness for the 2026-05-17
 * mega-bot `unhandled-rejection: NotFoundError`.
 *
 * Authority: docs/audit/2026-05-17-notfounderror-repro-spec.md (AMENDED).
 * Operational wrapper + discipline: the #176 kickoff. This is a callable
 * Playwright harness (NOT a vitest CI gate) — run manually / on-dispatch,
 * like scripts/ward-helper-mega-bot.mjs.
 *
 * SCOPE OF THIS SCRIPT (honest — the verdict must not outrun the artifact):
 *   - R0  hard version gate (fetch ${BASE_URL}sw.js, refuse ≠ EXPECT).
 *   - R1  variant (a) ONLY — the deterministic H1 probe: chaos BETWEEN
 *         clean iterations (does the next app boot recover?). Variant (b)
 *         (chaos interleaved with an in-flight scan — the H2 racy path)
 *         is a NAMED FOLLOW-UP, not built here.
 *   - R2  capture: error.name/message/stack, IDB op-trace drain, schema
 *         snapshot, last-chaos label — enough to ASSIGN a surviving repro.
 *   - R3  pre-committed gate constant (below), locked before any run.
 *   - R4  post-fix verification is the same harness re-run; not a
 *         separate code path here.
 *
 * The H1 probe mechanism (mirrors tests/idbStaleConnectionInvalidation):
 *   boot app (its getDb() memo holds an open connection) → from a 2nd
 *   page in the SAME browser context call deleteDatabase('ward-helper')
 *   with a timeout. Pre-fix (no versionchange handler) the app's leaked
 *   connection blocks the delete → onblocked, never onsuccess → RED.
 *   Post-fix (PR #182 versionchange→close) the delete completes →
 *   onsuccess → GREEN. Deterministic, calibratable, app-memo-dependent.
 *
 * Run:
 *   EXPECT_WARD_VERSION=ward-v1.46.3 node scripts/ward-helper-notfounderror-harness.mjs
 *   # calibration (fix-reverted local build):
 *   HARNESS_BASE_URL=http://localhost:4173/ward-helper/ \
 *   EXPECT_WARD_VERSION=ward-v1.46.3-cal1 \
 *   node scripts/ward-helper-notfounderror-harness.mjs
 *
 * No auth, no API key, no Anthropic / proxy traffic.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

import { safeNavigate } from './lib/harnessNav.mjs';
import { TRACE_SHIM_SRC, drainTrace, snapshotIdb } from './lib/idbTraceShim.mjs';

// ---- R3: pre-committed pass/fail gate. Locked in writing BEFORE any
// stochastic run (kickoff rule 3). The H1 path is near-deterministic;
// the spec says expect ~10/10. ≥3/10 is the H2 racy floor only and does
// NOT apply to this variant-(a) probe.
const R3_H1_FLOOR = 10;          // /ITERATIONS RED required to call H1 "reproduced"
const ITERATIONS = Number(process.env.HARNESS_ITERS ?? 10);

const BASE_URL = process.env.HARNESS_BASE_URL ?? 'https://eiasash.github.io/ward-helper/';
const EXPECT_WARD_VERSION = process.env.EXPECT_WARD_VERSION ?? '';
const READY_SEL = 'nav[aria-label="ניווט ראשי"]';   // app-mounted marker (from b1-bake-witness)
const DELETE_TIMEOUT_MS = 8000;                       // blocked vs completed discriminator window
const REPORT_DIR = 'chaos-reports';
const RUN_DOC = 'docs/audit/2026-05-17-notfounderror-harness-run.md';

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

// ---- Kickoff rule 4 self-test (baked in, fail-closed): no bare
// page.goto / page.reload may exist in this harness — every navigation
// MUST go through the safeNavigate seam (which alone may call them) so
// console/error capture is provably re-armed per navigation. A future
// edit that reaches for page.goto directly is the signal the invariant
// is being skipped; this aborts the run before it can emit a verdict.
async function ruleFourSelfTest() {
  const src = await fs.readFile(new URL(import.meta.url), 'utf8');
  const offenders = src
    .split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\bpage\.(goto|reload)\s*\(/.test(l) && !l.trimStart().startsWith('//'));
  if (offenders.length) {
    throw new Error(
      `rule-4 self-test FAILED: bare page.goto/page.reload in the harness ` +
      `(must use safeNavigate): lines ${offenders.map(([n]) => n).join(', ')}`,
    );
  }
}

// ---- R0: HARD version gate. A wrong-version run is a hard error, not a
// warning (kickoff). Without this the harness would "verify" whatever is
// cached/deployed while claiming to test EXPECT_WARD_VERSION.
async function r0Gate() {
  if (!EXPECT_WARD_VERSION) {
    throw new Error('R0: EXPECT_WARD_VERSION env not set. Refusing to run — the version gate is non-negotiable.');
  }
  const swUrl = new URL('sw.js', BASE_URL).href;
  const res = await fetch(swUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`R0: GET ${swUrl} → HTTP ${res.status}. Cannot verify version.`);
  const firstLine = (await res.text()).split('\n')[0];
  const m = firstLine.match(/ward-v[\w.\-]+/);
  const live = m ? m[0] : `(unparseable: ${firstLine.slice(0, 80)})`;
  if (live !== EXPECT_WARD_VERSION) {
    throw new Error(
      `R0 HARD GATE FAILED: live ${swUrl} = "${live}", expected "${EXPECT_WARD_VERSION}". ` +
      `A version-mismatched run is invalid by R0. STOP.`,
    );
  }
  return { swUrl, live };
}

// Seed a minimal PHI-shaped fixture via raw IDB (same shape b1-bake-witness
// uses) so a surviving repro's R2 trace exercises the scan stores. Values
// are synthetic — no real PHI.
async function seed(page) {
  return page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('ward-helper');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['patients', 'notes'], 'readwrite');
      tx.objectStore('patients').put({
        id: 'nf-probe-A', name: 'בדיקה', teudatZehut: '111111111',
        dob: '01/01/1950', room: '1', tags: [], createdAt: Date.now(), updatedAt: Date.now(),
      });
      tx.objectStore('notes').put({
        id: 'nf-probe-n1', patientId: 'nf-probe-A', type: 'soap',
        bodyHebrew: 'x', structuredData: {}, createdAt: Date.now(), updatedAt: Date.now(),
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return true;
  }).catch((e) => ({ seedError: String(e) }));
}

/**
 * One H1-probe iteration (R1 variant a). App is booted on `page` (its
 * getDb() memo holds an OPEN connection). Issue deleteDatabase from a
 * fresh script context on the SAME page (same origin — an unnavigated
 * 2nd page is about:blank / opaque-origin and IndexedDB is denied there,
 * which silently misclassifies as "green"; v1 of this probe had that
 * bug — caught by the discriminating run). deleteDatabase fires
 * `versionchange` on EVERY open connection to the DB in the agent
 * cluster regardless of who issues it, so same-page is mechanically
 * identical to "another tab" for the thing PR #182 changed — and it
 * mirrors tests/idbStaleConnectionInvalidation.test.ts exactly, which
 * is the calibration authority.
 *
 * Returns { outcome: 'blocked'|'completed'|'errored'|'timeout', ... }
 *   blocked / timeout  → H1 PRESENT (app's stale connection has no
 *                        versionchange handler → never closes → blocks
 *                        the delete; pre-fix behavior) → RED
 *   completed          → H1 ABSENT  (PR #182 versionchange→close let it
 *                        through; post-fix behavior) → GREEN
 */
async function probeOnce(page, iter) {
  const lastChaos = 'chaos-clear-storage(deleteDatabase ward-helper, same-origin)';
  let result;
  try {
    result = await page.evaluate(async (timeoutMs) => {
      return await new Promise((resolve) => {
        let settled = false;
        const done = (o) => { if (!settled) { settled = true; resolve(o); } };
        let req;
        try { req = indexedDB.deleteDatabase('ward-helper'); }
        catch (e) { return done({ outcome: 'errored', errName: e && e.name, errMsg: e && e.message }); }
        req.onsuccess = () => done({ outcome: 'completed' });
        req.onblocked = () => done({ outcome: 'blocked' });
        req.onerror = () => done({ outcome: 'errored', errName: req.error && req.error.name, errMsg: req.error && req.error.message });
        setTimeout(() => done({ outcome: 'timeout' }), timeoutMs);
      });
    }, DELETE_TIMEOUT_MS);
  } catch (e) {
    result = { outcome: 'errored', errName: 'evaluate', errMsg: String(e && e.message || e) };
  }

  // Give the app a beat to react (post-fix: versionchange→close→invalidate;
  // pre-fix: nothing — stale memo persists). Then capture R2 evidence.
  await page.waitForTimeout(1200);
  const rec = page.__harnessCapture;
  const trace = await drainTrace(page, 30);
  const idb = await snapshotIdb(page);

  const red = result.outcome === 'blocked' || result.outcome === 'timeout';
  return {
    iter, lastChaos,
    outcome: result.outcome,
    deleteErr: result.errName ? `${result.errName}: ${result.errMsg}` : null,
    red,
    // R2 fault-assignment payload — the error.name is the H1/H2 discriminator
    pageerrors: rec ? rec.pageerrors.slice(-5) : [],
    rejections: rec ? rec.rejections.slice(-5) : [],
    crashes: rec ? rec.crashes : null,
    lastIdbOps: trace.slice(-12),
    idbSnapshot: idb,
  };
}

async function main() {
  const startedAt = Date.now();
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const report = {
    spec: 'docs/audit/2026-05-17-notfounderror-repro-spec.md (AMENDED)',
    baseUrl: BASE_URL,
    expectVersion: EXPECT_WARD_VERSION,
    startedAt: new Date(startedAt).toISOString(),
    r0: null,
    variant: 'R1(a) — chaos between clean iterations (H1 recovery probe)',
    r3Gate: { R3_H1_FLOOR, iterations: ITERATIONS },
    iterations: [],
    redCount: 0,
    verdict: null,
    durationMs: 0,
  };

  // Rule-4 self-test BEFORE anything — an un-seamed navigation makes
  // every downstream "clean" verdict untrustworthy.
  await ruleFourSelfTest();

  // R0 — hard gate BEFORE launching a browser.
  report.r0 = await r0Gate();
  console.log(`R0 OK — ${report.r0.swUrl} = ${report.r0.live} == EXPECT`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  // R2 — install the harness-only trace shim + route unhandledrejection
  // THROUGH the console pipe (so harnessNav's sentinel proves BOTH live).
  await context.addInitScript(TRACE_SHIM_SRC);
  await context.addInitScript(`
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      try {
        console.error('[HARNESS_REJECTION] ' + JSON.stringify({
          name: r && r.name || null,
          message: (r && r.message || String(r)).slice(0, 400),
          stack: (r && r.stack || '').slice(0, 1200)
        }));
      } catch (_) { console.error('[HARNESS_REJECTION] {"name":"(unserializable)"}'); }
    });
  `);

  const page = await context.newPage();
  try {
    // Clean boot — app's getDb() memo opens & holds a connection.
    // Seed ONCE. Re-seeding (or reloading) between iterations re-opens
    // the DB and races the v0→v7 upgrade against the next iteration's
    // deleteDatabase, which the harness then mis-reports as a NotFoundError
    // "finding" (the v1 self-contamination — see harness-run.md). The H1
    // signal is "did the delete block?", which does not need persistent
    // fixtures past iter 1.
    await safeNavigate(page, BASE_URL, { readySel: READY_SEL });
    await seed(page);

    // No reload / reseed in the loop. Variant (a) = chaos (delete)
    // between clean observations; the app reacts (post-fix: versionchange
    // → close → invalidate; pre-fix: nothing, stale memo persists). The
    // post-delete wait inside probeOnce gives the app time to react.
    // Pass criterion (advisor / rule 1): outcome must be UNIFORM across
    // iterations on a given build — "8/10 with a story" means the race
    // is still present. Uniform completed = post-fix; uniform blocked =
    // pre-fix; that asymmetry across builds is the calibration.
    for (let i = 1; i <= ITERATIONS; i += 1) {
      const r = await probeOnce(page, i);
      report.iterations.push(r);
      if (r.red) report.redCount += 1;
      console.log(
        `  iter ${i}/${ITERATIONS}: delete=${r.outcome} ${r.red ? 'RED' : 'green'}` +
        (r.rejections.length ? ` rej=[${r.rejections.map((x) => x.name).join(',')}]` : '') +
        (r.pageerrors.length ? ` pageerr=[${r.pageerrors.map((x) => x.name).join(',')}]` : ''),
      );
    }
    const outcomes = new Set(report.iterations.map((it) => it.outcome));
    report.uniform = outcomes.size === 1;
    report.distinctOutcomes = [...outcomes];

    // Verdict against the PRE-COMMITTED R3 gate (no post-hoc rationalization).
    const anyNotFound = report.iterations.some((it) =>
      [...it.rejections, ...it.pageerrors].some((e) => e.name === 'NotFoundError'));
    if (report.redCount >= R3_H1_FLOOR) {
      report.verdict = {
        path: 'RED',
        statement:
          `H1 probe RED ${report.redCount}/${ITERATIONS} (≥ R3_H1_FLOOR=${R3_H1_FLOOR}). ` +
          `On ${EXPECT_WARD_VERSION}: the app's connection still blocks a ` +
          `2nd-context delete — stale-memo behavior present. This is the ` +
          `CALIBRATION-EXPECTED result on a fix-reverted build; on the ` +
          `fixed build it means PR #182 did not take.`,
      };
    } else if (anyNotFound) {
      report.verdict = {
        path: 'A',
        statement:
          `NotFoundError observed on ${EXPECT_WARD_VERSION} while the H1 ` +
          `delete-block signal did NOT fire (${report.redCount}/${ITERATIONS}). ` +
          `H1 is fixed here, so a surviving NotFoundError is NOT H1 — assign ` +
          `to H2/H3/H4 from the R2 op-trace below. Do NOT write a fix in ` +
          `this PR (kickoff PATH A).`,
      };
    } else {
      report.verdict = {
        path: 'B (pending calibration)',
        statement:
          `H1 probe GREEN ${report.redCount}/${ITERATIONS} and no NotFoundError ` +
          `on ${EXPECT_WARD_VERSION}: the 2nd-context delete completes — ` +
          `consistent with H1 being fixed by PR #182. This is WEAK evidence ` +
          `(absence-under-chaos); it is "consistent with H1 fixed", explicitly ` +
          `NOT "root cause confirmed". Trustworthy ONLY once the same harness ` +
          `is shown RED on the fix-reverted build (kickoff rule 2 / PATH B1). ` +
          `An uncalibrated GREEN is PATH B2 — not a clean verdict.`,
      };
    }
  } catch (e) {
    report.fatalError = String(e?.stack ?? e).slice(0, 1500);
    report.verdict = { path: 'ERROR', statement: report.fatalError };
  } finally {
    await context.close();
    await browser.close();
  }

  report.durationMs = Date.now() - startedAt;
  const outPath = path.join(REPORT_DIR, `notfounderror-harness-${ts()}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== NotFoundError harness ===');
  console.log(`Base:     ${BASE_URL}`);
  console.log(`Version:  ${EXPECT_WARD_VERSION} (R0 ${report.r0 ? 'PASS' : 'FAIL'})`);
  console.log(`Variant:  ${report.variant}`);
  console.log(`RED:      ${report.redCount}/${ITERATIONS}  (R3_H1_FLOOR=${R3_H1_FLOOR})`);
  console.log(`Verdict:  ${report.verdict?.path}`);
  console.log(report.verdict?.statement ?? '');
  console.log(`Report:   ${outPath}`);

  // Exit code contract: 0 = ran cleanly & produced a verdict; 1 = RED
  // (H1 reproduced — expected on calibration build, alarming on fixed);
  // 2 = harness error. Callers/CI key on this.
  if (report.verdict?.path === 'ERROR') process.exit(2);
  process.exit(report.redCount >= R3_H1_FLOOR ? 1 : 0);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
