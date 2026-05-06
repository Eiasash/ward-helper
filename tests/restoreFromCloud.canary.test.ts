import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { verifyCanaryMock, pullByUsernameMock, pullAllBlobsMock } = vi.hoisted(() => ({
  verifyCanaryMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    verifyCanary: verifyCanaryMock,
    pullByUsername: pullByUsernameMock,
    pullAllBlobs: pullAllBlobsMock,
  };
});

vi.mock('@/auth/auth', () => ({
  getCurrentUser: () => ({ username: 'eiass', display_name: 'E' }),
}));

import { resetDbForTests } from '@/storage/indexed';
import { restoreFromCloud } from '@/notes/save';

beforeEach(async () => {
  await resetDbForTests();
  verifyCanaryMock.mockReset();
  pullByUsernameMock.mockReset();
  pullAllBlobsMock.mockReset();
});

describe('restoreFromCloud + canary', () => {
  it('returns wrongPassphrase=true and zero scans when canary fails', async () => {
    verifyCanaryMock.mockResolvedValue('wrong-passphrase');
    const out = await restoreFromCloud('bad-pass');
    expect(out.wrongPassphrase).toBe(true);
    expect(out.scanned).toBe(0);
    expect(pullByUsernameMock).not.toHaveBeenCalled();
    expect(pullAllBlobsMock).not.toHaveBeenCalled();
  });

  it('proceeds normally when canary returns "ok"', async () => {
    verifyCanaryMock.mockResolvedValue('ok');
    pullByUsernameMock.mockResolvedValue([]);
    const out = await restoreFromCloud('right-pass');
    expect(out.wrongPassphrase).toBe(false);
    expect(out.scanned).toBe(0);
    expect(pullByUsernameMock).toHaveBeenCalledTimes(1);
  });

  it('proceeds when canary returns "absent" (no prior backup)', async () => {
    verifyCanaryMock.mockResolvedValue('absent');
    pullByUsernameMock.mockResolvedValue([]);
    const out = await restoreFromCloud('any-pass');
    expect(out.wrongPassphrase).toBe(false);
    expect(out.scanned).toBe(0);
  });
});
