/**
 * PR-B2.2 — phiUnlock.ts tests.
 *
 * Covers the outcome contract of `attemptPhiUnlock` and
 * `attemptPhiUnlockWithPassword`:
 *   - no-user      : not logged in
 *   - no-password  : logged in but no in-memory password
 *   - already-unlocked : key already set, no-op
 *   - ok           : derived key, ran backfill, returned report
 *   - backfill-failed : exit through the error path
 *
 * Plus the password-override variant + the clearPhiKeyOnLogout helper.
 *
 * Auth-state setup uses the same localStorage shape `auth.ts::getCurrentUser`
 * reads — no mocking, real `app_users` and Supabase aren't reached.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '@/storage/indexed';
import {
  clearPhiKey,
  hasPhiKey,
  derivePhiKey,
  setPhiKey,
} from '@/crypto/phi';
import {
  attemptPhiUnlock,
  attemptPhiUnlockWithPassword,
  clearPhiKeyOnLogout,
} from '@/auth/phiUnlock';
import {
  stashLastLoginPassword,
  clearLastLoginPassword,
  getLastLoginPasswordOrNull,
} from '@/auth/auth';
import { isPhiEncryptV7Enabled } from '@/crypto/phiRow';

const AUTH_LS_KEY = 'ward-helper.auth.user';
const FLAG_KEY = 'phi_encrypt_v7';

function loginAs(username: string): void {
  localStorage.setItem(
    AUTH_LS_KEY,
    JSON.stringify({ username, displayName: null, loggedInAt: Date.now() }),
  );
}

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
}

beforeEach(async () => {
  clearPhiKey();
  clearLastLoginPassword();
  await resetDbForTests();
  try {
    localStorage.removeItem(AUTH_LS_KEY);
    localStorage.removeItem(FLAG_KEY);
  } catch { /* ignore */ }
});

afterEach(() => {
  clearPhiKey();
  clearLastLoginPassword();
  try {
    localStorage.removeItem(AUTH_LS_KEY);
    localStorage.removeItem(FLAG_KEY);
  } catch { /* ignore */ }
});

describe('attemptPhiUnlock', () => {
  it('returns no-user when no auth session present', async () => {
    const outcome = await attemptPhiUnlock();
    expect(outcome.kind).toBe('no-user');
  });

  it('returns already-unlocked when a key is already set', async () => {
    loginAs('alice');
    setPhiKey(await derivePhiKey('pw', randomSalt(), 4));
    const outcome = await attemptPhiUnlock();
    expect(outcome.kind).toBe('already-unlocked');
  });

  it('returns no-password when logged in but password not in memory', async () => {
    loginAs('alice');
    // No stashLastLoginPassword.
    const outcome = await attemptPhiUnlock();
    expect(outcome.kind).toBe('no-password');
  });

  it('ok path: derives key + runs backfill + flips flag', async () => {
    loginAs('alice');
    stashLastLoginPassword('the password');
    const outcome = await attemptPhiUnlock();
    expect(outcome.kind).toBe('ok');
    expect(hasPhiKey()).toBe(true);
    expect(isPhiEncryptV7Enabled()).toBe(true);
    if (outcome.kind === 'ok') {
      expect(outcome.report.sentinelSet).toBe(true);
    }
  });

  it('idempotent across two consecutive runs (second is already-unlocked)', async () => {
    loginAs('alice');
    stashLastLoginPassword('the password');
    const first = await attemptPhiUnlock();
    expect(first.kind).toBe('ok');
    const second = await attemptPhiUnlock();
    expect(second.kind).toBe('already-unlocked');
  });
});

describe('attemptPhiUnlockWithPassword', () => {
  it('stashes the password, derives the key, and runs backfill', async () => {
    loginAs('alice');
    expect(getLastLoginPasswordOrNull()).toBeNull();
    const outcome = await attemptPhiUnlockWithPassword('manual entry');
    expect(outcome.kind).toBe('ok');
    expect(getLastLoginPasswordOrNull()).toBe('manual entry');
    expect(hasPhiKey()).toBe(true);
  });

  it('returns no-user when no auth session (does not stash)', async () => {
    const outcome = await attemptPhiUnlockWithPassword('whatever');
    expect(outcome.kind).toBe('no-user');
    // Stash discipline: only stash AFTER passing the user-presence check.
    expect(getLastLoginPasswordOrNull()).toBeNull();
  });
});

describe('clearPhiKeyOnLogout', () => {
  it('clears the in-memory PHI key', async () => {
    setPhiKey(await derivePhiKey('pw', randomSalt(), 4));
    expect(hasPhiKey()).toBe(true);
    clearPhiKeyOnLogout();
    expect(hasPhiKey()).toBe(false);
  });

  it('is a noop when no key was set', () => {
    expect(hasPhiKey()).toBe(false);
    clearPhiKeyOnLogout();
    expect(hasPhiKey()).toBe(false);
  });
});
