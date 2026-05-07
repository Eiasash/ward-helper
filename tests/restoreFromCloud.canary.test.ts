import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// v1.39.8: restoreFromCloud now pulls ONCE then calls verifyCanaryFromRows
// against the in-memory rows (was: verifyCanary which pulled internally,
// then a second pull). Mocks updated accordingly.
const { verifyCanaryFromRowsMock, pullByUsernameMock, pullAllBlobsMock } = vi.hoisted(() => ({
  verifyCanaryFromRowsMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    verifyCanaryFromRows: verifyCanaryFromRowsMock,
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
  verifyCanaryFromRowsMock.mockReset();
  pullByUsernameMock.mockReset();
  pullAllBlobsMock.mockReset();
});

describe('restoreFromCloud + canary', () => {
  it('returns wrongPassphrase=true and zero scans when canary fails', async () => {
    // v1.39.8: pull happens BEFORE verify (single round-trip), so on
    // wrong-pass we still see one pull. The savings is on the decrypt
    // loop, not the network round-trip.
    pullByUsernameMock.mockResolvedValue([]);
    verifyCanaryFromRowsMock.mockResolvedValue('wrong-passphrase');
    const out = await restoreFromCloud('bad-pass');
    expect(out.wrongPassphrase).toBe(true);
    expect(out.scanned).toBe(0);
    expect(pullByUsernameMock).toHaveBeenCalledTimes(1);
    expect(pullAllBlobsMock).not.toHaveBeenCalled();
  });

  it('proceeds normally when canary returns "ok" — single pull, not two', async () => {
    pullByUsernameMock.mockResolvedValue([]);
    verifyCanaryFromRowsMock.mockResolvedValue('ok');
    const out = await restoreFromCloud('right-pass');
    expect(out.wrongPassphrase).toBe(false);
    expect(out.scanned).toBe(0);
    // v1.39.8 invariant: exactly ONE pull per restore (was 2).
    expect(pullByUsernameMock).toHaveBeenCalledTimes(1);
  });

  it('proceeds when canary returns "absent" (no prior backup)', async () => {
    pullByUsernameMock.mockResolvedValue([]);
    verifyCanaryFromRowsMock.mockResolvedValue('absent');
    const out = await restoreFromCloud('any-pass');
    expect(out.wrongPassphrase).toBe(false);
    expect(out.scanned).toBe(0);
  });
});
