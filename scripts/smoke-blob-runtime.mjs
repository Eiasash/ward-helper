#!/usr/bin/env node
// @ts-check
/**
 * smoke-blob-runtime.mjs — ward-helper runtime invariant for the 4
 * encrypted-blob types (patient, note, api-key, day-snapshot). Closes
 * the runtime-layer gap of the dev/CI/runtime triad for the encrypted-
 * blob chain. Mirrors the bare-script shape of Geri's
 * scripts/smoke-api-key-restore.mjs (PR #208).
 *
 * What this asserts (per blob_type, looped — see spec §C with PR #140 Edits):
 *
 *   (1) WIRE — page.waitForResponse on
 *       /rest/v1/rpc/ward_helper_pull_by_username POST. The matching row
 *       in the response body has ciphertext+iv+salt EXACTLY equal to what
 *       seedAll produced. Catches: server returned wrong row, RLS denied
 *       (empty body 200), wire format regression, ciphertext corrupted
 *       in transit.
 *
 *   (3) PERSIST — page.waitForFunction on the IDB store / localStorage key
 *       returns the decrypted plaintext deep-equal to the fixture. Catches:
 *       decrypt threw, decrypt produced garbage, persistence step skipped.
 *
 * Obs 2 (deserialized JS value) is dropped — ward-helper has no
 * window-exposed surfaces, so the post-decrypt plaintext can only be
 * observed via persistence side-effect. Documented in spec §A.
 *
 * Why page.waitForResponse, NOT page.route: route() lets you stub /
 * transform, defeating runtime observation. Resist the next-maintainer
 * instinct to switch to route() for "easier mocking" — the whole point
 * is the REAL Supabase RPC fires and we look at it.
 *
 * Exit codes
 *   0 — all blob_types' assertions held
 *   1 — at least one blob_type failed (or harness threw)
 *   2 — setup error (missing env vars, browser launch failure)
 */

import { chromium } from 'playwright';
import { initContext, seedAll, cleanupAll, applyForcedFailMutation } from './lib/seed-blobs.mjs';
import { BLOB_SEEDS, USER_DATA_BLOB_TYPES } from '../tests/fixtures/blob-seeds.ts';

const URL = process.env.SMOKE_URL || 'https://eiasash.github.io/ward-helper/';
const HEADLESS = process.env.SMOKE_HEADLESS !== '0';
const NAV_TIMEOUT_MS = Number(process.env.SMOKE_NAV_TIMEOUT_MS || 30_000);
const RPC_TIMEOUT_MS = Number(process.env.SMOKE_RPC_TIMEOUT_MS || 15_000);
const PERSIST_TIMEOUT_MS = Number(process.env.SMOKE_PERSIST_TIMEOUT_MS || 10_000);

let ctx;
let exitCode = 0;
const failures = [];

(async () => {
  // Setup. Throws on missing env vars (exit 2 below).
  try {
    ctx = await initContext();
  } catch (e) {
    console.error('smoke-blob-runtime: setup failed:', e.message);
    process.exit(2);
  }

  console.log(`smoke-blob-runtime: seeding 5 fixtures (canary + 4 user-data) for username=${ctx.username}`);
  let seeded;
  try {
    seeded = await seedAll(ctx, process.env.TEST_PASSPHRASE);
    seeded = await applyForcedFailMutation(ctx, seeded, process.env.SMOKE_FORCE_FAIL);
  } catch (e) {
    console.error('smoke-blob-runtime: seedAll/applyForcedFailMutation failed:', e.message);
    await safeCleanup();
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const browserCtx = await browser.newContext();
  const page = await browserCtx.newPage();

  try {
    console.log(`smoke-blob-runtime: opening ${URL} (headless=${HEADLESS})`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // Arm obs 1 BEFORE the login that triggers the RPC. Predicate is per
    // PR #140's Edits §1 — pullByUsername is the cross-device path used
    // for logged-in users.
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/rest/v1/rpc/ward_helper_pull_by_username') &&
        res.request().method() === 'POST',
      { timeout: RPC_TIMEOUT_MS },
    );

    // Drive login + restore via UI form fills. First-pass selectors —
    // adjust to live UI on first run. ward-helper exposes neither auth
    // nor restore on window today, so UI-driven is the path (verified
    // during plan-writing).
    await driveLoginAndRestore(page);

    const response = await responsePromise;
    const networkBody = await response.json();

    // Loop blob_types. Each iteration runs both observations. Failure
    // within an iteration is captured to `failures[]`; the loop continues
    // so each blob's status is reported per run.
    for (const blobType of USER_DATA_BLOB_TYPES) {
      const fixture = BLOB_SEEDS[blobType];
      const expectedSealed = seeded[blobType];

      // OBS 1: wire — exact-match against seeded values.
      let obs1Failed = false;
      try {
        const row = networkBody.find((r) => r.blob_type === blobType && r.blob_id === fixture.blobId);
        if (!row) {
          throw new Error(`obs 1: row for ${blobType}/${fixture.blobId} missing from RPC response`);
        }
        if (row.ciphertext !== expectedSealed.ciphertext) {
          throw new Error(`obs 1: ciphertext mismatch [regression class: wire layer]`);
        }
        if (row.iv !== expectedSealed.iv) {
          throw new Error(`obs 1: iv mismatch [regression class: wire layer]`);
        }
        if (row.salt !== expectedSealed.salt) {
          throw new Error(`obs 1: salt mismatch [regression class: wire layer]`);
        }
        console.log(`  ✓ ${blobType} obs 1 (wire) passed`);
      } catch (e) {
        obs1Failed = true;
        failures.push({ blobType, observation: 1, message: e.message });
        console.error(`  ✗ ${blobType} ${e.message}`);
      }
      if (obs1Failed) continue; // skip obs 3 if obs 1 already failed

      // OBS 3: persistence — deterministic wait on the IDB / localStorage value.
      const expectedFailureClass = process.env.SMOKE_FORCE_FAIL === 'plaintext'
        ? 'fixture drift / harness self-test'
        : 'production decrypt path OR persistence step';

      try {
        if (fixture.persistenceLayer === 'localStorage') {
          await page.waitForFunction(
            ({ key, expected }) => localStorage.getItem(key) === expected,
            { key: fixture.persistenceKey, expected: fixture.plaintext.apiKey },
            { timeout: PERSIST_TIMEOUT_MS },
          );
        } else {
          // IDB. Open the 'ward-helper' DB, look up by blobId in the
          // fixture's persistenceKey store, deep-equal against plaintext.
          await page.waitForFunction(
            ({ store, id, expected }) =>
              new Promise((resolve) => {
                const req = indexedDB.open('ward-helper');
                req.onsuccess = () => {
                  try {
                    const tx = req.result.transaction(store, 'readonly');
                    const get = tx.objectStore(store).get(id);
                    get.onsuccess = () => {
                      const row = get.result;
                      if (!row) return resolve(false);
                      // Deep-equal via JSON round-trip; sufficient for the fixture shapes.
                      resolve(JSON.stringify(row) === JSON.stringify(expected));
                    };
                    get.onerror = () => resolve(false);
                  } catch { resolve(false); }
                };
                req.onerror = () => resolve(false);
              }),
            { store: fixture.persistenceKey, id: fixture.blobId, expected: fixture.plaintext },
            { timeout: PERSIST_TIMEOUT_MS },
          );
        }
        console.log(`  ✓ ${blobType} obs 3 (persistence) passed`);
      } catch (e) {
        const msg = `obs 3: plaintext never landed in ${fixture.persistenceLayer}.${fixture.persistenceKey} [regression class: ${expectedFailureClass}]`;
        failures.push({ blobType, observation: 3, message: msg });
        console.error(`  ✗ ${blobType} ${msg}`);
      }
    }
  } catch (e) {
    console.error('smoke-blob-runtime: harness threw:', e);
    exitCode = 1;
  } finally {
    await browser.close();
    await safeCleanup();
  }

  if (failures.length > 0) {
    console.error(`\nsmoke-blob-runtime: ${failures.length} failure(s) across ${USER_DATA_BLOB_TYPES.length} blob_types`);
    for (const f of failures) console.error(`  - ${f.blobType}/obs ${f.observation}: ${f.message}`);
    exitCode = 1;
  } else if (exitCode === 0) {
    console.log(`\nsmoke-blob-runtime: all ${USER_DATA_BLOB_TYPES.length} blob_types passed both observations.`);
  }

  process.exit(exitCode);
})();

async function driveLoginAndRestore(page) {
  // First-pass UI selectors — adjust to live UI on first run. The form is
  // ward-helper's login screen; submit triggers _rpc('auth_login_user', ...)
  // and the post-login restore prompt with a passphrase input.
  await page.fill('input[name="username"], input[type="text"]', process.env.TEST_USER);
  await page.fill('input[name="password"], input[type="password"]:not([name*="passphrase" i])', process.env.TEST_PASS);
  await page.click('button[type="submit"], button:has-text("Login"), button:has-text("התחבר")');
  // Restore prompt may appear post-login; passphrase input + Restore CTA.
  // If SMOKE_FORCE_FAIL=passphrase, deliberately use a wrong value.
  const passphrase = process.env.SMOKE_FORCE_FAIL === 'passphrase'
    ? 'WRONG-PASSPHRASE-FOR-DRY-FAIL-TEST'
    : process.env.TEST_PASSPHRASE;
  await page.fill('input[type="password"][placeholder*="ססמ" i], input[name*="passphrase" i]', passphrase);
  await page.click('button:has-text("Restore"), button:has-text("שחזר")');
}

async function safeCleanup() {
  if (!ctx) return;
  try { await cleanupAll(ctx); }
  catch (e) { console.warn(`safeCleanup: ${e.message}`); }
}
