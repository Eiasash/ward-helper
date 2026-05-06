import { describe, it, expect, beforeEach, vi } from 'vitest';

const { pushBlobMock, pullByUsernameMock, pullAllBlobsMock } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pushBlob: pushBlobMock,
    pullByUsername: pullByUsernameMock,
    pullAllBlobs: pullAllBlobsMock,
  };
});

import { deriveAesKey } from '@/crypto/pbkdf2';
// Canary helpers are imported directly from @/storage/canary (not through
// the @/storage/cloud re-export). The vi.mock on @/storage/cloud doesn't
// propagate through the cloud→canary→cloud import cycle that the
// re-export creates — Vitest 4 binds each module's lexical references at
// evaluation time, and the cycle leaves canary.ts with the unmocked
// pushBlob. Importing canary directly side-steps the cycle entirely.
import { pushCanary, verifyCanary, CANARY_BLOB_ID } from '@/storage/canary';
import { encryptForCloud, type CloudBlobRow } from '@/storage/cloud';

beforeEach(() => {
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
  pullByUsernameMock.mockReset();
  pullAllBlobsMock.mockReset();
});

describe('pushCanary', () => {
  it('pushes a canary blob with pinned blob_id', async () => {
    const salt = new Uint8Array(16);
    const key = await deriveAesKey('pass', salt);
    await pushCanary(key, salt, 'eiass');
    expect(pushBlobMock).toHaveBeenCalledTimes(1);
    expect(pushBlobMock.mock.calls[0]![0]).toBe('canary');
    expect(pushBlobMock.mock.calls[0]![1]).toBe(CANARY_BLOB_ID);
    expect(pushBlobMock.mock.calls[0]![3]).toBe('eiass');
  });
});

describe('verifyCanary', () => {
  it('returns "absent" when no canary row exists', async () => {
    pullByUsernameMock.mockResolvedValue([
      { blob_type: 'patient', blob_id: 'p1', ciphertext: 'AA==', iv: 'AA==', salt: 'AA==', updated_at: '' },
    ]);
    const out = await verifyCanary('any-pass', 'eiass');
    expect(out).toBe('absent');
  });

  it('returns "ok" when canary decrypts with the given passphrase', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('right-pass', salt);
    const sealed = await encryptForCloud({ v: 1, marker: 'ward-helper-canary', createdAt: 1 }, key, salt);
    const row: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...sealed.ciphertext)),
      iv: btoa(String.fromCharCode(...sealed.iv)),
      salt: btoa(String.fromCharCode(...sealed.salt)),
      updated_at: '',
    } as CloudBlobRow;
    pullByUsernameMock.mockResolvedValue([row]);
    const out = await verifyCanary('right-pass', 'eiass');
    expect(out).toBe('ok');
  });

  it('returns "wrong-passphrase" when canary fails to decrypt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('right-pass', salt);
    const sealed = await encryptForCloud({ v: 1, marker: 'ward-helper-canary', createdAt: 1 }, key, salt);
    const row: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...sealed.ciphertext)),
      iv: btoa(String.fromCharCode(...sealed.iv)),
      salt: btoa(String.fromCharCode(...sealed.salt)),
      updated_at: '',
    } as CloudBlobRow;
    pullByUsernameMock.mockResolvedValue([row]);
    const out = await verifyCanary('WRONG-pass', 'eiass');
    expect(out).toBe('wrong-passphrase');
  });
});
