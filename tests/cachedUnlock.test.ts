import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTests, setSettings } from '@/storage/indexed';
import {
  cacheUnlockBlob,
  tryAutoUnlock,
  clearUnlockCache,
  reencryptUnlockCache,
} from '@/crypto/unlock';

beforeEach(async () => {
  await resetDbForTests();
  await setSettings({
    apiKeyXor: new Uint8Array(0),
    deviceSecret: new Uint8Array(16),
    lastPassphraseAuthAt: null,
    prefs: {},
  });
});

describe('cacheUnlockBlob / tryAutoUnlock', () => {
  it('round-trips passphrase through login-password key', async () => {
    await cacheUnlockBlob('my-backup-pass', 'login-pwd');
    const out = await tryAutoUnlock('login-pwd');
    expect(out).toBe('my-backup-pass');
  });

  it('returns null on wrong login password', async () => {
    await cacheUnlockBlob('my-backup-pass', 'login-pwd');
    const out = await tryAutoUnlock('wrong-pwd');
    expect(out).toBeNull();
  });

  it('returns null when no cache exists', async () => {
    const out = await tryAutoUnlock('any-pwd');
    expect(out).toBeNull();
  });

  it('clearUnlockCache removes the blob', async () => {
    await cacheUnlockBlob('p', 'l');
    await clearUnlockCache();
    expect(await tryAutoUnlock('l')).toBeNull();
  });

  it('reencryptUnlockCache moves cache from old to new login password', async () => {
    await cacheUnlockBlob('my-backup-pass', 'old-pwd');
    await reencryptUnlockCache('old-pwd', 'new-pwd');
    expect(await tryAutoUnlock('old-pwd')).toBeNull();
    expect(await tryAutoUnlock('new-pwd')).toBe('my-backup-pass');
  });

  it('reencryptUnlockCache is a no-op when no cache exists', async () => {
    await reencryptUnlockCache('old-pwd', 'new-pwd');
    expect(await tryAutoUnlock('new-pwd')).toBeNull();
  });
});
