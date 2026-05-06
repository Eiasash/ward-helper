import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { pushBlobMock, pullByUsernameMock } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return { ...actual, pushBlob: pushBlobMock, pullByUsername: pullByUsernameMock };
});

import { resetDbForTests, setSettings } from '@/storage/indexed';
// Canary helpers come from @/storage/canary directly — the @/storage/cloud
// re-export creates a cycle that breaks vi.mock binding (see canary.test.ts
// header comment for the full explanation).
import { verifyCanary, pushCanary } from '@/storage/canary';
import { cacheUnlockBlob, tryAutoUnlock } from '@/crypto/unlock';
import { deriveAesKey } from '@/crypto/pbkdf2';

beforeEach(async () => {
  await resetDbForTests();
  await setSettings({
    apiKeyXor: new Uint8Array(0),
    deviceSecret: new Uint8Array(16),
    lastPassphraseAuthAt: null,
    prefs: {},
  });
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
  pullByUsernameMock.mockReset();
});

describe('passphrase activation end-to-end', () => {
  it('first activation: absent canary → push canary, cache unlock blob', async () => {
    pullByUsernameMock.mockResolvedValue([]);
    const status = await verifyCanary('my-pass', 'eiass');
    expect(status).toBe('absent');

    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('my-pass', salt);
    await pushCanary(key, salt, 'eiass');
    await cacheUnlockBlob('my-pass', 'my-login-pwd');

    expect(pushBlobMock).toHaveBeenCalledWith('canary', '__canary__', expect.anything(), 'eiass');
    expect(await tryAutoUnlock('my-login-pwd')).toBe('my-pass');
  });
});
