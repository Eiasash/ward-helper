import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTests, getSettings, setSettings } from '@/storage/indexed';

beforeEach(async () => {
  await resetDbForTests();
});

describe('Settings.cachedUnlockBlob', () => {
  it('round-trips through IDB without the field set (back-compat)', async () => {
    await setSettings({
      apiKeyXor: new Uint8Array(0),
      deviceSecret: new Uint8Array(16),
      lastPassphraseAuthAt: null,
      prefs: {},
    });
    const out = await getSettings();
    expect(out?.cachedUnlockBlob).toBeUndefined();
  });

  it('round-trips when set', async () => {
    const blob = {
      v: 1 as const,
      ciphertext: new Uint8Array([1, 2, 3]),
      iv: new Uint8Array([4, 5, 6]),
      salt: new Uint8Array([7, 8, 9]),
    };
    await setSettings({
      apiKeyXor: new Uint8Array(0),
      deviceSecret: new Uint8Array(16),
      lastPassphraseAuthAt: null,
      prefs: {},
      cachedUnlockBlob: blob,
    });
    const out = await getSettings();
    expect(out?.cachedUnlockBlob).toEqual(blob);
  });
});
