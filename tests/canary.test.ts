import { describe, it, expect, beforeEach, vi } from 'vitest';

const { pushBlobMock, pullByUsernameMock, pullAllBlobsMock, getSupabaseMock, rpcMock } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
  getSupabaseMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pushBlob: pushBlobMock,
    pullByUsername: pullByUsernameMock,
    pullAllBlobs: pullAllBlobsMock,
    getSupabase: getSupabaseMock,
  };
});

import { deriveAesKey } from '@/crypto/pbkdf2';
// Canary helpers are imported directly from @/storage/canary (not through
// the @/storage/cloud re-export). The vi.mock on @/storage/cloud doesn't
// propagate through the cloud→canary→cloud import cycle that the
// re-export creates — Vitest 4 binds each module's lexical references at
// evaluation time, and the cycle leaves canary.ts with the unmocked
// pushBlob. Importing canary directly side-steps the cycle entirely.
import { pushCanary, verifyCanary, dedupeStaleCanaries, CANARY_BLOB_ID } from '@/storage/canary';
import { encryptForCloud, type CloudBlobRow } from '@/storage/cloud';

beforeEach(() => {
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
  pullByUsernameMock.mockReset();
  pullAllBlobsMock.mockReset();
  // Default: getSupabase returns a stub client whose rpc() returns 0 rows
  // deleted. Individual dedupe tests override rpcMock per-case.
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: 0, error: null });
  getSupabaseMock.mockReset();
  getSupabaseMock.mockResolvedValue({ rpc: rpcMock } as unknown);
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

  // v1.39.16 regression test for the multi-canary read bug.
  //
  // Anon auth can mint a fresh user_id (token expiry, IDB clear, new
  // browser); each fresh user_id slips past the (user_id, blob_type,
  // blob_id) UNIQUE constraint to insert a NEW canary instead of updating
  // the existing one. Real user data showed 9 canary rows for one
  // username. Pre-v1.39.16, rows.find() picked a non-deterministic
  // canary — sometimes an old one encrypted under a stale passphrase,
  // returning 'wrong-passphrase' even when the current passphrase was
  // correct. That false orphan signal blocked all cloud canary refreshes.
  it('picks the NEWEST canary when multiple rows exist (v1.39.16)', async () => {
    // Old canary: encrypted under STALE password
    const staleSalt = crypto.getRandomValues(new Uint8Array(16));
    const staleKey = await deriveAesKey('STALE-pass', staleSalt);
    const staleSealed = await encryptForCloud(
      { v: 1, marker: 'ward-helper-canary', createdAt: 1 },
      staleKey,
      staleSalt,
    );
    const staleRow: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...staleSealed.ciphertext)),
      iv: btoa(String.fromCharCode(...staleSealed.iv)),
      salt: btoa(String.fromCharCode(...staleSealed.salt)),
      updated_at: '2026-05-06T11:36:32.060Z', // older
    } as CloudBlobRow;

    // New canary: encrypted under CURRENT password
    const currentSalt = crypto.getRandomValues(new Uint8Array(16));
    const currentKey = await deriveAesKey('current-pass', currentSalt);
    const currentSealed = await encryptForCloud(
      { v: 1, marker: 'ward-helper-canary', createdAt: 2 },
      currentKey,
      currentSalt,
    );
    const currentRow: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...currentSealed.ciphertext)),
      iv: btoa(String.fromCharCode(...currentSealed.iv)),
      salt: btoa(String.fromCharCode(...currentSealed.salt)),
      updated_at: '2026-05-07T15:29:58.382Z', // newer
    } as CloudBlobRow;

    // Stale row first: pre-v1.39.16 rows.find() returned this and
    // verify decrypted with current-pass against staleSalt → 'wrong'.
    pullByUsernameMock.mockResolvedValue([staleRow, currentRow]);
    const outOrderA = await verifyCanary('current-pass', 'eiass');
    expect(outOrderA).toBe('ok');

    // And reverse order — must STILL pick the newest by updated_at.
    pullByUsernameMock.mockResolvedValue([currentRow, staleRow]);
    const outOrderB = await verifyCanary('current-pass', 'eiass');
    expect(outOrderB).toBe('ok');
  });

  // Companion: when the current password is genuinely wrong (matches no
  // canary in the cloud), verify must still return 'wrong-passphrase'
  // — the newest-pick rule must not accidentally flip a real wrong-pass
  // into 'ok'.
  it('returns "wrong-passphrase" when none of the canaries decrypt (v1.39.16)', async () => {
    const saltA = crypto.getRandomValues(new Uint8Array(16));
    const keyA = await deriveAesKey('pass-A', saltA);
    const sealedA = await encryptForCloud({ v: 1, marker: 'ward-helper-canary', createdAt: 1 }, keyA, saltA);
    const rowA: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...sealedA.ciphertext)),
      iv: btoa(String.fromCharCode(...sealedA.iv)),
      salt: btoa(String.fromCharCode(...sealedA.salt)),
      updated_at: '2026-05-06T00:00:00.000Z',
    } as CloudBlobRow;
    const saltB = crypto.getRandomValues(new Uint8Array(16));
    const keyB = await deriveAesKey('pass-B', saltB);
    const sealedB = await encryptForCloud({ v: 1, marker: 'ward-helper-canary', createdAt: 2 }, keyB, saltB);
    const rowB: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...sealedB.ciphertext)),
      iv: btoa(String.fromCharCode(...sealedB.iv)),
      salt: btoa(String.fromCharCode(...sealedB.salt)),
      updated_at: '2026-05-07T00:00:00.000Z',
    } as CloudBlobRow;
    pullByUsernameMock.mockResolvedValue([rowA, rowB]);
    const out = await verifyCanary('TOTALLY-different-pass', 'eiass');
    expect(out).toBe('wrong-passphrase');
  });
});

// v1.39.17: dedupeStaleCanaries — exported helper that calls the
// ward_helper_dedupe_stale_canaries SECURITY DEFINER RPC to clean up
// canary rows from prior anon-auth user_ids for the same username.
//
// Lives as a SEPARATE exported function (not embedded in pushCanary)
// because importing pushBreadcrumb here would create a circular dep
// chain: canary.ts → MobileDebugPanel → save.ts → cloud.ts → canary.ts
// — that cycle breaks vi.mock resolution in tests/auth.test.ts. The
// caller (armCanaryOnce in save.ts) does the breadcrumb wrapping where
// the cycle is already established and harmless.
describe('dedupeStaleCanaries (v1.39.17)', () => {
  it('returns 0 and skips RPC when username is null', async () => {
    const removed = await dedupeStaleCanaries(null);
    expect(removed).toBe(0);
    expect(getSupabaseMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 0 and skips RPC when username is empty string', async () => {
    const removed = await dedupeStaleCanaries('');
    expect(removed).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 0 and skips RPC when username is whitespace only', async () => {
    const removed = await dedupeStaleCanaries('   ');
    expect(removed).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('calls ward_helper_dedupe_stale_canaries with trimmed username', async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    const removed = await dedupeStaleCanaries('  eiass  ');
    expect(removed).toBe(5);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]![0]).toBe('ward_helper_dedupe_stale_canaries');
    expect(rpcMock.mock.calls[0]![1]).toEqual({ p_username: 'eiass' });
  });

  it('returns the row-count from RPC data', async () => {
    rpcMock.mockResolvedValue({ data: 9, error: null });
    expect(await dedupeStaleCanaries('eiass')).toBe(9);
    rpcMock.mockResolvedValue({ data: 0, error: null });
    expect(await dedupeStaleCanaries('eiass')).toBe(0);
  });

  it('coerces non-number RPC data to 0 (defensive)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await dedupeStaleCanaries('eiass')).toBe(0);
    rpcMock.mockResolvedValue({ data: undefined, error: null });
    expect(await dedupeStaleCanaries('eiass')).toBe(0);
    rpcMock.mockResolvedValue({ data: 'three', error: null });
    expect(await dedupeStaleCanaries('eiass')).toBe(0);
  });

  it('throws when RPC returns an error — caller decides whether to swallow', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc 500' } });
    await expect(dedupeStaleCanaries('eiass')).rejects.toMatchObject({
      message: 'rpc 500',
    });
  });

  it('propagates network throws for the same reason', async () => {
    rpcMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(dedupeStaleCanaries('eiass')).rejects.toThrow('ENOTFOUND');
  });
});
