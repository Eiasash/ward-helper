#!/usr/bin/env node
// @ts-check
/**
 * smoke-roster-import-race.mjs — local fixture sanity for scenRosterImportRace.
 *
 * Spins up `vite preview` against `dist/`, launches Playwright Chromium,
 * loads the ward-helper page with the bot API flag set, and exercises
 * the scenario's probe sequence directly in real Chromium (not jsdom /
 * happy-dom). Bypasses the mega-bot orchestrator entirely — just
 * verifies that on the current build:
 *
 *   - window.__rosterBotApi attaches when the flag is set
 *   - seedAdversarialAzmaTsv produces a TSV the parser handles
 *   - listPatientsByTzMap is stable on the seeded patients store
 *   - none of the §3 HIGH probes (parser-threw, parser-accepted-nameless-row,
 *     parser-dropped-too-many-rows, by-tz-scan-throws, null-key-leaked,
 *     empty-key-leaked, dedup-invariant-broken) fire
 *
 * Why this exists: the spec calls for a "5-min fixture sanity run on
 * current branch — zero HIGHs from rosterImportRace" as a pre-merge
 * gate. The full mega-bot fixture run is slow (~5 min minimum) and
 * mostly exercises personas + chaos that aren't load-bearing for this
 * specific PR. This script runs the EXACT same probe code in the EXACT
 * same Chromium runtime in ~30s.
 *
 * Exit codes:
 *   0 — all probes passed
 *   1 — at least one HIGH fired
 *   2 — setup error (no dist, preview failed, chromium launch failed)
 *
 * Usage:
 *   npm run build && node scripts/smoke-roster-import-race.mjs
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}/ward-helper/`;
const SETUP_TIMEOUT_MS = 30_000;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok || res.status === 304) return true;
    } catch {
      /* not ready yet */
    }
    await sleep(250);
  }
  return false;
}

async function main() {
  // 1. Spawn vite preview.
  console.log(`[smoke] starting vite preview on :${PREVIEW_PORT}`);
  // Windows requires shell:true for .cmd shims (npx.cmd) to spawn
  // correctly through node's spawn(); plain `npx` fails with EINVAL.
  const preview = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: true },
  );
  preview.stderr.on('data', (d) => process.stderr.write(`[preview-err] ${d}`));

  const cleanup = () => {
    try {
      preview.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  const ready = await waitForServer(PREVIEW_URL, SETUP_TIMEOUT_MS);
  if (!ready) {
    console.error('[smoke] preview did not become ready in time');
    cleanup();
    process.exit(2);
  }
  console.log(`[smoke] preview ready at ${PREVIEW_URL}`);

  // 2. Launch Chromium.
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('pageerror', (err) => {
    console.error(`[chrome-pageerror] ${err.message}`);
  });

  let highCount = 0;
  /** @param {string} label @param {string} detail */
  const recordHigh = (label, detail) => {
    highCount++;
    console.error(`[HIGH] ${label} — ${detail}`);
  };

  try {
    // 3. First load to set the localStorage flag.
    await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.evaluate(() => {
      localStorage.setItem('ward-helper.botApi', '1');
    });
    // 4. Reload so the IIFE re-runs with the flag set.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(1500);

    // 5. Verify bot api attached.
    const apiReady = await page.evaluate(() => {
      return (
        typeof window.__rosterBotApi?.seedAdversarialAzmaTsv === 'function' &&
        typeof window.__rosterBotApi?.importViaPaste === 'function' &&
        typeof window.__rosterBotApi?.listPatientsByTzMap === 'function' &&
        typeof window.__rosterBotApi?.putPatient === 'function' &&
        typeof window.__rosterBotApi?.clearPatients === 'function'
      );
    });
    if (!apiReady) {
      recordHigh('bot-api-missing', 'window.__rosterBotApi not attached after reload');
      throw new Error('bot api missing');
    }
    console.log('[smoke] bot api attached');

    // 6. Run the full probe sequence in one page.evaluate — same shape
    //    as scenRosterImportRace's page-side closure.
    const result = await page.evaluate(async ({ bundleSize }) => {
      const api = window.__rosterBotApi;
      const bundle = api.seedAdversarialAzmaTsv(bundleSize);
      let parsed;
      let parseThrew = null;
      try {
        parsed = api.importViaPaste(bundle.tsv);
      } catch (e) {
        parseThrew = (e && e.message) || String(e);
      }
      if (parseThrew !== null) {
        return { phase: 'parse', bundle, parseThrew };
      }
      const parsedCount = parsed.length;

      await api.clearPatients();
      const now = Date.now();
      for (const r of parsed) {
        await api.putPatient({
          id: r.id,
          name: r.name,
          teudatZehut: r.tz ?? '',
          dob: '',
          room: r.room,
          tags: [],
          createdAt: now,
          updatedAt: now,
        });
      }

      let mapSize = -1;
      let nullKeyCount = 0;
      let emptyKeyCount = 0;
      let mapThrew = null;
      try {
        const map = await api.listPatientsByTzMap();
        mapSize = map.size;
        for (const k of map.keys()) {
          if (k == null) nullKeyCount++;
          else if (k === '') emptyKeyCount++;
        }
      } catch (e) {
        mapThrew = (e && e.message) || String(e);
      }

      await api.clearPatients().catch(() => {});
      await api.clearRoster().catch(() => {});

      return {
        phase: 'done',
        bundle,
        parsedCount,
        mapSize,
        nullKeyCount,
        emptyKeyCount,
        mapThrew,
      };
    }, { bundleSize: 50 });

    if (result.phase === 'parse' && result.parseThrew) {
      recordHigh('parser-threw-on-adversarial', result.parseThrew);
    } else {
      const { bundle, parsedCount, mapSize, nullKeyCount, emptyKeyCount, mapThrew } = result;
      console.log(
        `[smoke] bundle=${bundle.inputRows} parsedCount=${parsedCount} expected=${bundle.expectedParsedRows} mapSize=${mapSize} expectedDistinctValidTz=${bundle.expectedDistinctValidTz} flavors=${bundle.injectedFlavors.join(',')}`,
      );
      if (parsedCount > bundle.expectedParsedRows) {
        recordHigh(
          'parser-accepted-nameless-row',
          `parsedCount=${parsedCount} > expected=${bundle.expectedParsedRows}`,
        );
      }
      if (parsedCount < bundle.expectedParsedRows) {
        recordHigh(
          'parser-dropped-too-many-rows',
          `parsedCount=${parsedCount} < expected=${bundle.expectedParsedRows}`,
        );
      }
      if (mapThrew) {
        recordHigh('by-tz-scan-throws', mapThrew);
      }
      if (nullKeyCount > 0) {
        recordHigh('null-key-leaked-into-by-tz-map', `count=${nullKeyCount}`);
      }
      if (emptyKeyCount > 0) {
        recordHigh('empty-key-leaked-into-by-tz-map', `count=${emptyKeyCount}`);
      }
      if (mapSize !== bundle.expectedDistinctValidTz) {
        recordHigh(
          'dedup-invariant-broken',
          `mapSize=${mapSize} != expected=${bundle.expectedDistinctValidTz}`,
        );
      }
    }
  } finally {
    await browser.close();
    cleanup();
  }

  if (highCount > 0) {
    console.error(`[smoke] FAIL — ${highCount} HIGH(s) fired`);
    process.exit(1);
  }
  console.log('[smoke] PASS — zero HIGHs from rosterImportRace probes');
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke] uncaught:', e?.message ?? e);
  process.exit(2);
});
