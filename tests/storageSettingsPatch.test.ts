/**
 * Tests for src/storage/indexed.ts::patchSettings + the 3 caller migrations
 * that depend on its field-preservation guarantee:
 *
 *   - auth.ts::persistLoginPassword (login flow)
 *   - crypto/unlock.ts::cacheUnlockBlob (password-change / re-encrypt flow)
 *   - crypto/phi.ts::loadOrCreatePhiSalt (PHI salt persistence, PR-A)
 *
 * Pre-2026-05-14 these three sites hand-listed every Settings field on
 * setSettings, which silently wiped any field they didn't name. The
 * latent example was cacheUnlockBlob wiping loginPwdXor; the would-be
 * future example was persistLoginPassword wiping phiSalt the moment PR-B
 * started persisting it.
 *
 * The regression cases here pin the field-preservation invariant — if
 * a future Settings field is added without a corresponding default in
 * patchSettings, the typed `merged: Settings` line breaks compile;
 * if a future caller drops back to setSettings without all fields, the
 * regression tests catch the wipe at runtime.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  patchSettings,
  setSettings,
  getSettings,
  resetDbForTests,
  type Settings,
} from '@/storage/indexed';
import { persistLoginPassword } from '@/auth/auth';
import { cacheUnlockBlob } from '@/crypto/unlock';
import { loadOrCreatePhiSalt } from '@/crypto/phi';

beforeEach(async () => {
  await resetDbForTests();
});

describe('patchSettings — partial update primitive', () => {
  it('writes a defaults+partial record when no prior settings exist', async () => {
    await patchSettings({ lastPassphraseAuthAt: 1700000000000 });

    const s = await getSettings();
    expect(s).toBeDefined();
    expect(s!.lastPassphraseAuthAt).toBe(1700000000000);
    expect(s!.apiKeyXor.byteLength).toBe(0);
    expect(s!.deviceSecret.byteLength).toBe(0);
    expect(s!.prefs).toEqual({});
    expect(s!.cachedUnlockBlob).toBeNull();
    expect(s!.loginPwdXor).toBeNull();
    expect(s!.phiSalt).toBeNull();
  });

  it('preserves every existing field not named in the partial', async () => {
    const seed: Settings = {
      apiKeyXor: new Uint8Array([0xaa, 0xbb]) as Uint8Array<ArrayBuffer>,
      deviceSecret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>,
      lastPassphraseAuthAt: 1700000000000,
      prefs: { someFlag: true },
      cachedUnlockBlob: null,
      loginPwdXor: new Uint8Array([9, 9, 9]) as Uint8Array<ArrayBuffer>,
      phiSalt: new Uint8Array(16).fill(7) as Uint8Array<ArrayBuffer>,
    };
    await setSettings(seed);

    // Patch a single unrelated field.
    await patchSettings({ lastPassphraseAuthAt: 1700000999000 });

    const after = await getSettings();
    expect(after!.lastPassphraseAuthAt).toBe(1700000999000);
    expect(Array.from(after!.apiKeyXor)).toEqual([0xaa, 0xbb]);
    expect(Array.from(after!.deviceSecret)).toEqual([1, 2, 3]);
    expect(after!.prefs).toEqual({ someFlag: true });
    expect(after!.cachedUnlockBlob).toBeNull();
    expect(Array.from(after!.loginPwdXor!)).toEqual([9, 9, 9]);
    expect(Array.from(after!.phiSalt!)).toEqual(Array(16).fill(7));
  });

  it('overwrites fields explicitly named in the partial', async () => {
    await patchSettings({ prefs: { a: 1 } });
    await patchSettings({ prefs: { a: 2, b: 3 } });

    const s = await getSettings();
    expect(s!.prefs).toEqual({ a: 2, b: 3 });
  });
});

describe('regression: caller migrations preserve sibling fields', () => {
  it('persistLoginPassword does NOT wipe phiSalt (PR-A invariant for PR-B)', async () => {
    // Stand in a phiSalt the way PR-B's loadOrCreatePhiSalt would have,
    // and a deviceSecret matching the post-fresh-login state (the
    // existing persistLoginPassword preserves a present deviceSecret
    // and only regenerates on first call from a fully-empty Settings).
    const salt = new Uint8Array(16).fill(0x42) as Uint8Array<ArrayBuffer>;
    const seedDeviceSecret = new Uint8Array(32).fill(0x33) as Uint8Array<ArrayBuffer>;
    await patchSettings({ phiSalt: salt, deviceSecret: seedDeviceSecret });

    await persistLoginPassword('correct horse battery staple');

    const s = await getSettings();
    // The core invariant patchSettings exists to enforce.
    expect(s!.phiSalt).toBeDefined();
    expect(Array.from(s!.phiSalt!)).toEqual(Array(16).fill(0x42));
    // And the fields persistLoginPassword IS supposed to write are present
    // and consistent — deviceSecret preserved (existing-non-empty path),
    // loginPwdXor freshly computed against it.
    expect(Array.from(s!.deviceSecret)).toEqual(Array(32).fill(0x33));
    expect(s!.loginPwdXor).toBeDefined();
    expect(s!.loginPwdXor!.byteLength).toBeGreaterThan(0);
  });

  it('cacheUnlockBlob does NOT wipe loginPwdXor (latent bug fix)', async () => {
    // Sequence: persistLoginPassword runs first (login flow), then
    // cacheUnlockBlob runs (password-change flow). Pre-migration the second
    // call would silently null out the loginPwdXor written by the first.
    await persistLoginPassword('login-pw');
    const beforeBlob = await getSettings();
    const loginPwdXorBefore = beforeBlob!.loginPwdXor;
    expect(loginPwdXorBefore).toBeDefined();
    expect(loginPwdXorBefore!.byteLength).toBeGreaterThan(0);

    await cacheUnlockBlob('passphrase-secret', 'login-pw');

    const afterBlob = await getSettings();
    expect(afterBlob!.loginPwdXor).toBeDefined();
    expect(afterBlob!.loginPwdXor!.byteLength).toBe(loginPwdXorBefore!.byteLength);
    expect(Array.from(afterBlob!.loginPwdXor!)).toEqual(Array.from(loginPwdXorBefore!));
    // And the new cachedUnlockBlob is present too.
    expect(afterBlob!.cachedUnlockBlob).toBeDefined();
    expect(afterBlob!.cachedUnlockBlob?.v).toBe(1);
  });

  it('cacheUnlockBlob does NOT wipe phiSalt', async () => {
    const salt = new Uint8Array(16).fill(0x7e) as Uint8Array<ArrayBuffer>;
    await patchSettings({ phiSalt: salt });

    await cacheUnlockBlob('passphrase-secret', 'login-pw');

    const s = await getSettings();
    expect(Array.from(s!.phiSalt!)).toEqual(Array(16).fill(0x7e));
    expect(s!.cachedUnlockBlob?.v).toBe(1);
  });

  it('loadOrCreatePhiSalt does NOT wipe loginPwdXor or deviceSecret', async () => {
    await persistLoginPassword('login-pw');
    const before = await getSettings();
    const loginPwdXorBefore = before!.loginPwdXor;
    const deviceSecretBefore = before!.deviceSecret;
    expect(loginPwdXorBefore!.byteLength).toBeGreaterThan(0);
    expect(deviceSecretBefore.byteLength).toBeGreaterThan(0);

    await loadOrCreatePhiSalt();

    const after = await getSettings();
    expect(Array.from(after!.loginPwdXor!)).toEqual(Array.from(loginPwdXorBefore!));
    expect(Array.from(after!.deviceSecret)).toEqual(Array.from(deviceSecretBefore));
    expect(after!.phiSalt?.byteLength).toBe(16);
  });
});
