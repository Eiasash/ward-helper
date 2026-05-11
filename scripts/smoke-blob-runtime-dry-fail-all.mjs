#!/usr/bin/env node
// @ts-check
/**
 * smoke-blob-runtime-dry-fail-all.mjs — meta-test.
 *
 * Runs the smoke under each of the 3 SMOKE_FORCE_FAIL modes and asserts
 * each one fails with the expected regression-class string. Exits 0
 * only if 3/3 fail correctly. Protects against the silent-rot class:
 * assertions that fire-but-don't-actually-assert, mocks that swallow
 * errors, or mode 2/3 collapsing into the same failure message.
 *
 * Invoked via `npm run smoke:blob-runtime:dry-fail-all` (uses tsx so
 * the spawned smoke can import .ts source files).
 */

import { spawnSync } from 'node:child_process';

const MODES = [
  { mode: 'ciphertext', expectedSubstring: 'regression class: wire layer' },
  { mode: 'passphrase', expectedSubstring: 'regression class: production decrypt path OR persistence step' },
  { mode: 'plaintext', expectedSubstring: 'regression class: fixture drift / harness self-test' },
];

let allCorrect = true;

for (const { mode, expectedSubstring } of MODES) {
  console.log(`\n=== SMOKE_FORCE_FAIL=${mode} ===`);
  // Use tsx so the spawned smoke can resolve .ts imports (matches the
  // npm script's launcher). Falls back gracefully if tsx isn't found.
  const result = spawnSync('npx', ['tsx', 'scripts/smoke-blob-runtime.mjs'], {
    env: { ...process.env, SMOKE_FORCE_FAIL: mode },
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  const output = (result.stdout || '') + '\n' + (result.stderr || '');

  if (result.status === 0) {
    console.error(`FAIL: mode '${mode}' was expected to fail but the smoke passed (exit 0)`);
    allCorrect = false;
    continue;
  }
  if (!output.includes(expectedSubstring)) {
    console.error(`FAIL: mode '${mode}' failed but message didn't include expected substring: "${expectedSubstring}"`);
    console.error('--- last 30 lines of output ---');
    console.error(output.split('\n').slice(-30).join('\n'));
    allCorrect = false;
    continue;
  }
  console.log(`OK: mode '${mode}' failed with expected regression-class message.`);
}

if (!allCorrect) {
  console.error('\nMeta-test FAILED: not all 3 modes failed correctly. Smoke assertions may have rotted.');
  process.exit(1);
}
console.log('\nMeta-test PASSED: 3/3 forced-fail modes failed with distinct regression-class messages.');
process.exit(0);
