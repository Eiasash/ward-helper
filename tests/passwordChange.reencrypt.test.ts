import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    getSupabase: async () => ({ rpc: rpcMock }),
  };
});

import { resetDbForTests, patchSettings } from '@/storage/indexed';
import { changePasswordWithReencrypt } from '@/auth/auth';
import { cacheUnlockBlob, tryAutoUnlock } from '@/crypto/unlock';

beforeEach(async () => {
  await resetDbForTests();
  rpcMock.mockReset();
});

describe('changePasswordWithReencrypt', () => {
  it('re-encrypts cached blob to new password on RPC success', async () => {
    await cacheUnlockBlob('my-backup-pass', 'old-pwd');
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const out = await changePasswordWithReencrypt('eiass', 'old-pwd', 'new-pwd');
    expect(out.ok).toBe(true);
    expect(await tryAutoUnlock('old-pwd')).toBeNull();
    expect(await tryAutoUnlock('new-pwd')).toBe('my-backup-pass');
  });

  it('does not re-encrypt when RPC fails', async () => {
    await cacheUnlockBlob('my-backup-pass', 'old-pwd');
    rpcMock.mockResolvedValue({ data: { ok: false, error: 'invalid_password' }, error: null });
    const out = await changePasswordWithReencrypt('eiass', 'wrong-old', 'new-pwd');
    expect(out.ok).toBe(false);
    expect(await tryAutoUnlock('old-pwd')).toBe('my-backup-pass');
    expect(await tryAutoUnlock('new-pwd')).toBeNull();
  });

  // PR-B2.2 guard: refuse rotation when sealed PHI rows exist on disk.
  describe('phi-rotation guard (PR-B2.2)', () => {
    it('refuses when Settings.phiEncryptedV7 sentinel is true (no RPC fired)', async () => {
      await patchSettings({ phiEncryptedV7: true });
      const out = await changePasswordWithReencrypt('eiass', 'old-pwd', 'new-pwd');
      expect(out.ok).toBe(false);
      expect(out.error).toBe('phi_rotation_not_supported');
      expect(out.message).toMatch(/שינוי סיסמה לא נתמך/);
      // The RPC must NOT have been called — otherwise the server-side
      // password would change and the client-side PHI rows would orphan.
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it('proceeds normally when sentinel is null (pre-backfill install)', async () => {
      // No patchSettings → sentinel is null
      await cacheUnlockBlob('my-backup-pass', 'old-pwd');
      rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
      const out = await changePasswordWithReencrypt('eiass', 'old-pwd', 'new-pwd');
      expect(out.ok).toBe(true);
      expect(rpcMock).toHaveBeenCalledOnce();
    });

    it('proceeds normally when sentinel is false (explicit)', async () => {
      await patchSettings({ phiEncryptedV7: false });
      await cacheUnlockBlob('my-backup-pass', 'old-pwd');
      rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
      const out = await changePasswordWithReencrypt('eiass', 'old-pwd', 'new-pwd');
      expect(out.ok).toBe(true);
    });
  });
});
