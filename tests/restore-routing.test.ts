/**
 * restoreFromCloud — auth-aware route selection.
 *
 * The function picks between two pull paths based on whether the user
 * is logged in via app_users:
 *
 *   - logged in  → pullByUsername(username)   [cross-device, migration 0003]
 *   - guest      → pullAllBlobs()             [legacy per-anon-user-id]
 *
 * On a fresh install of a logged-in user, only the username path can
 * see their previous device's rows (different auth.uid()), so this
 * routing decision IS the cross-device feature.
 *
 * This file mocks `@/storage/cloud` whole and `@/auth/auth` for the
 * isLoggedIn signal — same pattern other restore tests use.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

// vi.mock factories are hoisted above module-level consts, so spies must
// be declared via vi.hoisted to be visible to the factories.
const h = vi.hoisted(() => ({
  pullAllBlobsMock: vi.fn(async () => [] as unknown[]),
  pullByUsernameMock: vi.fn(async (_u: string) => [] as unknown[]),
  getCurrentUserMock: vi.fn<
    () => { username: string; displayName: string | null; loggedInAt: number } | null
  >(() => null),
}));

vi.mock('@/storage/cloud', () => ({
  pullAllBlobs: h.pullAllBlobsMock,
  pullByUsername: h.pullByUsernameMock,
  // base64ToBytes / decryptFromCloud aren't reached when rows is empty —
  // fine to leave as identity stubs.
  base64ToBytes: vi.fn((s: string) => new Uint8Array(s.length)),
  decryptFromCloud: vi.fn(async () => ({})),
  // pushBlob and friends — unused here but module re-exports them.
  pushBlob: vi.fn(),
  encryptForCloud: vi.fn(),
}));

vi.mock('@/auth/auth', () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

vi.mock('@/crypto/pbkdf2', () => ({
  deriveAesKey: vi.fn(async () => ({}) as CryptoKey),
}));

import { restoreFromCloud } from '@/notes/save';
import { resetDbForTests } from '@/storage/indexed';

beforeEach(async () => {
  await resetDbForTests();
  h.pullAllBlobsMock.mockClear();
  h.pullByUsernameMock.mockClear();
  h.getCurrentUserMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('restoreFromCloud — guest (no app_users session)', () => {
  beforeEach(() => {
    h.getCurrentUserMock.mockReturnValue(null);
  });

  it('uses pullAllBlobs (legacy per-anon-user path)', async () => {
    const result = await restoreFromCloud('any-passphrase');
    expect(h.pullAllBlobsMock).toHaveBeenCalledTimes(1);
    expect(h.pullByUsernameMock).not.toHaveBeenCalled();
    expect(result.source).toBe('anon');
  });

  it("reports source='anon' so the UI can label the restore correctly", async () => {
    const result = await restoreFromCloud('p');
    expect(result.source).toBe('anon');
    expect(result.scanned).toBe(0);
  });
});

describe('restoreFromCloud — authed (app_users session)', () => {
  beforeEach(() => {
    h.getCurrentUserMock.mockReturnValue({
      username: 'eias',
      displayName: 'Eias Ashhab',
      loggedInAt: Date.now(),
    });
  });

  it('uses pullByUsername with the authed username', async () => {
    const result = await restoreFromCloud('any-passphrase');
    expect(h.pullByUsernameMock).toHaveBeenCalledTimes(1);
    expect(h.pullByUsernameMock).toHaveBeenCalledWith('eias');
    expect(h.pullAllBlobsMock).not.toHaveBeenCalled();
    expect(result.source).toBe('username');
  });

  it("reports source='username' so the UI can show 'cross-device' label", async () => {
    const result = await restoreFromCloud('p');
    expect(result.source).toBe('username');
    expect(result.scanned).toBe(0);
  });

  it('rejects empty passphrase regardless of auth state', async () => {
    await expect(restoreFromCloud('')).rejects.toThrow(/passphrase required/);
    // Must NOT have hit the network either way — fail-fast before pull.
    expect(h.pullByUsernameMock).not.toHaveBeenCalled();
    expect(h.pullAllBlobsMock).not.toHaveBeenCalled();
  });
});
