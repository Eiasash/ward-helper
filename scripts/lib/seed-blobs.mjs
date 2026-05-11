// @ts-check
/**
 * Encrypted-blob smoke seeding. Pure Node ESM (no browser imports).
 *
 * Imports src/crypto primitives directly so the harness reproduces the
 * production wire format. When the format bumps to v:2 (or src/crypto's
 * AES-GCM signature changes), this module fails first — that's the
 * intended schema-version drift detection per spec §B.
 *
 * Usage:
 *   const ctx = await initContext();
 *   const seeded = await seedAll(ctx, process.env.TEST_PASSPHRASE);
 *   // ... drive the smoke against ctx.username ...
 *   await cleanupAll(ctx);
 *
 * setupBurner is intentionally absent — burner is pre-seeded ONCE in
 * Supabase via manual SQL paste (see plan Pre-flight section). This
 * mirrors Geri's smoke shape; programmatic burner provisioning was
 * ruled out as overshoot.
 *
 * TS-IMPORT NOTE: This .mjs imports .ts source files. Run via `tsx`
 * (added in Task 3 npm scripts) or Node 22.7+ with
 * `--experimental-strip-types`. Plain `node script.mjs` will fail with
 * 'Unknown file extension .ts' on import.
 */

import { createClient } from '@supabase/supabase-js';
import { deriveAesKey } from '../../src/crypto/pbkdf2.ts';
import { aesEncrypt } from '../../src/crypto/aes.ts';
import { BLOB_SEEDS, USER_DATA_BLOB_TYPES, CANARY_PRECONDITION } from '../../tests/fixtures/blob-seeds.ts';

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Establish Supabase service-role client + burner identity.
 * Mints a synthetic UUID for seeded rows' user_id; pullByUsername
 * matches on the username column (per migration 0003), so binding
 * to a real auth.uid() is unnecessary.
 */
export async function initContext() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TEST_USER', 'TEST_PASS', 'TEST_PASSPHRASE'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`seed-blobs initContext: missing env vars: ${missing.join(', ')}`);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return {
    supabase,
    username: process.env.TEST_USER,
    syntheticUserId: crypto.randomUUID(),
  };
}

/**
 * Seed canary + the 4 user-data fixtures. Returns the seeded
 * { ciphertext, iv, salt } per blob_type so obs 1 can compare exact
 * byte-equal values.
 *
 * Order matters: canary first so restoreFromCloud's line-367 fast-fail
 * check has a valid canary to verify. Without this, the smoke exits
 * with wrongPassphrase: true and obs 3 times out for wrong reasons.
 */
export async function seedAll(ctx, passphrase) {
  const { supabase, username, syntheticUserId } = ctx;
  const seeded = {};

  // 1. Canary precondition
  const canarySealed = await encryptOne(
    { ...CANARY_PRECONDITION.plaintext, createdAt: Date.now() },
    passphrase,
  );
  await insertBlob(supabase, syntheticUserId, username, 'canary', CANARY_PRECONDITION.blobId, canarySealed);

  // 2. The 4 user-data fixtures
  for (const blobType of USER_DATA_BLOB_TYPES) {
    const fixture = BLOB_SEEDS[blobType];
    const sealed = await encryptOne(fixture.plaintext, passphrase);
    await insertBlob(supabase, syntheticUserId, username, blobType, fixture.blobId, sealed);
    seeded[blobType] = sealed;
  }

  return seeded;
}

async function encryptOne(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(passphrase, salt);
  const { iv, ciphertext } = await aesEncrypt(JSON.stringify(plaintext), key);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

async function insertBlob(supabase, userId, username, blobType, blobId, sealed) {
  const { error } = await supabase
    .from('ward_helper_backup')
    .upsert({
      user_id: userId,
      username,
      blob_type: blobType,
      blob_id: blobId,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      salt: sealed.salt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,blob_type,blob_id' });
  if (error) throw new Error(`insertBlob ${blobType}/${blobId} failed: ${error.message}`);
}

/**
 * Tear down: delete every ward_helper_backup row carrying the burner's
 * username. Catches both seedAll's rows AND any rows the smoke's runtime
 * UI login pushed (canary auto-arm at login, etc.). Idempotent.
 *
 * Does NOT delete the app_users row — that's pre-seeded and reused.
 */
export async function cleanupAll(ctx) {
  const { supabase, username } = ctx;
  const { error } = await supabase
    .from('ward_helper_backup')
    .delete()
    .eq('username', username);
  if (error) console.warn(`cleanupAll: ${error.message} (ignored — re-run if needed)`);
}
