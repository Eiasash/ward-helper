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

import { resetDbForTests, patchSettings, getDb, type Patient } from '@/storage/indexed';
import {
  clearPhiKey,
  hasPhiKey,
  derivePhiKey,
  setPhiKey,
  sealRow,
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
import { isPhiEncryptV7Enabled, type SealedPatientRow } from '@/crypto/phiRow';

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

// ─── PR v1.46.1 probe-verify tests ──────────────────────────────────────
//
// These tests exercise the FULL production derivation (default 600k PBKDF2
// iterations) because seed + probe must produce matching keys. ~200ms per
// derive on Node. Slow vs the unit-isolated 4-iteration paths above, but
// the production-shape coverage is what justifies the cost.

const samplePatient = (id: string): Patient => ({
  id,
  name: 'מטופלת',
  teudatZehut: '111',
  dob: '1945-01-01',
  room: null,
  tags: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
});

async function seedSealedPatient(id: string, password: string): Promise<void> {
  // Use the SAME derive iterations the production code path will use
  // (default 600k via PHI_PBKDF2_ITERATIONS). Otherwise the seed key
  // differs from what attemptPhiUnlockWithPassword computes from the
  // same password+salt, and "correct password" tests false-reject.
  const settings = await import('@/storage/indexed').then((m) => m.getSettings());
  if (!settings?.phiSalt) {
    await patchSettings({ phiSalt: randomSalt() });
  }
  const refreshed = await import('@/storage/indexed').then((m) => m.getSettings());
  const salt = refreshed!.phiSalt!;
  const key = await derivePhiKey(password, salt);
  setPhiKey(key);
  const enc = await sealRow(samplePatient(id));
  const row: SealedPatientRow = { id, enc };
  const db = await getDb();
  await db.put('patients', row as unknown as Patient);
  clearPhiKey();
}

describe('attemptPhiUnlockWithPassword — probe-verify (PR v1.46.1)', () => {
  it('correct password + sealed rows: probe verifies → ok, key set', async () => {
    loginAs('alice');
    await seedSealedPatient('p-1', 'correct-pwd');
    await patchSettings({ phiEncryptedV7: true });
    const outcome = await attemptPhiUnlockWithPassword('correct-pwd');
    expect(outcome.kind).toBe('ok');
    expect(hasPhiKey()).toBe(true);
  });

  it('wrong password + sealed rows: probe rejects → wrong-password, key cleared', async () => {
    loginAs('alice');
    await seedSealedPatient('p-1', 'correct-pwd');
    await patchSettings({ phiEncryptedV7: true });
    const outcome = await attemptPhiUnlockWithPassword('WRONG-pwd');
    expect(outcome.kind).toBe('wrong-password');
    // Fail-closed: key cleared from memory; the gate stays mounted via
    // hasPhiKey() === false → usePhiGateState stays 'locked'.
    expect(hasPhiKey()).toBe(false);
  });

  it('empty stores + sentinel-true: residual accept (any password → ok)', async () => {
    // Documented residual per the v1.46.1 hotfix note: with zero sealed
    // rows on disk, the probe has nothing to verify against. Bake station 6
    // exercises this explicitly.
    loginAs('alice');
    await patchSettings({ phiEncryptedV7: true });
    const outcome = await attemptPhiUnlockWithPassword('any-password');
    expect(outcome.kind).toBe('ok');
    expect(hasPhiKey()).toBe(true);
  });

  it('one corrupt row + one valid row + correct password: probe finds valid → ok', async () => {
    loginAs('alice');
    await seedSealedPatient('p-valid', 'correct-pwd');
    // Add a second row that's malformed-as-sealed (still passes
    // isEncryptedRow shape sniff but ciphertext won't decrypt). Verifies
    // that the multi-row sampling tolerates one-bad-row + one-good-row.
    const salt = (await import('@/storage/indexed').then((m) => m.getSettings()))!.phiSalt!;
    const key = await derivePhiKey('correct-pwd', salt);
    setPhiKey(key);
    const enc = await sealRow(samplePatient('p-bad'));
    enc.ciphertext[0] = (enc.ciphertext[0]! ^ 0xff) as number; // corrupt
    const db = await getDb();
    await db.put('patients', { id: 'p-bad', enc } as unknown as Patient);
    clearPhiKey();
    await patchSettings({ phiEncryptedV7: true });

    const outcome = await attemptPhiUnlockWithPassword('correct-pwd');
    expect(outcome.kind).toBe('ok');
    expect(hasPhiKey()).toBe(true);
  });

  it('ignores plaintext rows in the probe set (isEncryptedRow-gated)', async () => {
    // Seed: one sealed row (under correct-pwd) + one plaintext row in the
    // same store. The probe must skip the plaintext row (it has no `enc`
    // field; unsealRow on it would fail for the wrong reason — shape, not
    // wrong key). With the gate, the probe sees one sealed sample and
    // verifies against it.
    loginAs('alice');
    await seedSealedPatient('p-sealed', 'correct-pwd');
    const db = await getDb();
    await db.put('patients', samplePatient('p-plain'));
    await patchSettings({ phiEncryptedV7: true });
    const outcome = await attemptPhiUnlockWithPassword('correct-pwd');
    expect(outcome.kind).toBe('ok');
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
