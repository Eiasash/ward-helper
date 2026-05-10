import { describe, it, expect, beforeEach, vi } from 'vitest';

// v1.39.9: canaryProtection consults pullByUsername/pullAllBlobs and
// verifyCanaryFromRows from @/storage/cloud. Mock those before importing
// the module under test so the module-level state starts clean and the
// network probe is deterministic.

const { pullByUsernameMock, pullAllBlobsMock, verifyCanaryFromRowsMock } = vi.hoisted(() => ({
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
  verifyCanaryFromRowsMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pullByUsername: pullByUsernameMock,
    pullAllBlobs: pullAllBlobsMock,
    verifyCanaryFromRows: verifyCanaryFromRowsMock,
  };
});

vi.mock('@/ui/components/MobileDebugPanel', () => ({
  pushBreadcrumb: vi.fn(),
}));

import {
  checkCanaryProtection,
  getCanaryProtectionState,
  clearOrphanProtection,
  _resetCanaryProtectionForTests,
} from '@/storage/canaryProtection';

beforeEach(() => {
  pullByUsernameMock.mockReset();
  pullAllBlobsMock.mockReset();
  verifyCanaryFromRowsMock.mockReset();
  _resetCanaryProtectionForTests();
});

describe('checkCanaryProtection', () => {
  it('returns "safe" when cloud has no rows at all', async () => {
    pullByUsernameMock.mockResolvedValue([]);
    const result = await checkCanaryProtection('any-pass', 'eiass');
    expect(result).toBe('safe');
    expect(verifyCanaryFromRowsMock).not.toHaveBeenCalled();
  });

  it('returns "safe" when cloud has only the canary row (no real data)', async () => {
    pullByUsernameMock.mockResolvedValue([
      { blob_type: 'canary', blob_id: '__canary__', salt: '', iv: '', ciphertext: '' },
    ]);
    const result = await checkCanaryProtection('any-pass', 'eiass');
    expect(result).toBe('safe');
    // Reason: no non-canary rows → nothing to orphan, skip the verify call.
    expect(verifyCanaryFromRowsMock).not.toHaveBeenCalled();
  });

  it('returns "safe" when canary verifies "ok" against current passphrase', async () => {
    pullByUsernameMock.mockResolvedValue([
      { blob_type: 'canary', blob_id: '__canary__', salt: '', iv: '', ciphertext: '' },
      { blob_type: 'patient', blob_id: 'p1', salt: '', iv: '', ciphertext: '' },
    ]);
    verifyCanaryFromRowsMock.mockResolvedValue('ok');
    const result = await checkCanaryProtection('right-pass', 'eiass');
    expect(result).toBe('safe');
  });

  it('returns "safe" when canary is "absent" — caller is first to arm', async () => {
    pullByUsernameMock.mockResolvedValue([
      { blob_type: 'patient', blob_id: 'p1', salt: '', iv: '', ciphertext: '' },
    ]);
    verifyCanaryFromRowsMock.mockResolvedValue('absent');
    const result = await checkCanaryProtection('any-pass', 'eiass');
    expect(result).toBe('safe');
  });

  it('returns "orphan" when existing data + canary fails to decrypt with current pass', async () => {
    // The motivating real-world incident: 86 cloud rows, canary keyed to a
    // different passphrase. Pushing a new canary would silently lose access
    // to all 86 rows.
    pullByUsernameMock.mockResolvedValue(
      Array.from({ length: 86 }, (_, i) => ({
        blob_type: i === 0 ? 'canary' : 'patient',
        blob_id: i === 0 ? '__canary__' : `p${i}`,
        salt: '', iv: '', ciphertext: '',
      })),
    );
    verifyCanaryFromRowsMock.mockResolvedValue('wrong-passphrase');
    const result = await checkCanaryProtection('wrong-pass', 'eiass');
    expect(result).toBe('orphan');
  });

  it('caches the result — subsequent calls do NOT re-pull', async () => {
    pullByUsernameMock.mockResolvedValue([]);
    await checkCanaryProtection('any-pass', 'eiass');
    await checkCanaryProtection('any-pass', 'eiass');
    await checkCanaryProtection('any-pass', 'eiass');
    expect(pullByUsernameMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent in-flight checks into a single pull', async () => {
    let resolvePull!: (rows: unknown[]) => void;
    pullByUsernameMock.mockImplementation(
      () => new Promise((r) => { resolvePull = r; }),
    );
    const p1 = checkCanaryProtection('any-pass', 'eiass');
    const p2 = checkCanaryProtection('any-pass', 'eiass');
    const p3 = checkCanaryProtection('any-pass', 'eiass');
    resolvePull([]);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe('safe');
    expect(r2).toBe('safe');
    expect(r3).toBe('safe');
    // Only one network round-trip total despite three concurrent callers.
    expect(pullByUsernameMock).toHaveBeenCalledTimes(1);
  });

  it('falls open to "safe" on network error — never locks the user out', async () => {
    // Conservative: a transient pull failure must NOT prevent canary push.
    // The user's data integrity isn't at stake unless a verifyCanary call
    // actually returned 'wrong-passphrase'.
    pullByUsernameMock.mockRejectedValue(new Error('network down'));
    const result = await checkCanaryProtection('any-pass', 'eiass');
    expect(result).toBe('safe');
  });

  it('uses pullAllBlobs when no username is provided (legacy anon path)', async () => {
    pullAllBlobsMock.mockResolvedValue([]);
    const result = await checkCanaryProtection('any-pass', null);
    expect(result).toBe('safe');
    expect(pullAllBlobsMock).toHaveBeenCalledTimes(1);
    expect(pullByUsernameMock).not.toHaveBeenCalled();
  });

  it('treats day-snapshot rows as non-canary data (orphan-protection covers v1.42.0 blobs)', async () => {
    // Regression for v1.42.0: when only day-snapshot rows exist in the cloud
    // and the current passphrase doesn't decrypt the canary, orphan-protection
    // must trigger — otherwise enabling the toggle on a fresh device with the
    // wrong passphrase would silently overwrite the canary and lock out
    // everyone else's snapshot history.
    pullByUsernameMock.mockResolvedValue([
      { blob_type: 'canary', blob_id: '__canary__', salt: '', iv: '', ciphertext: '' },
      { blob_type: 'day-snapshot', blob_id: '2026-05-08', salt: '', iv: '', ciphertext: '' },
      { blob_type: 'day-snapshot', blob_id: '2026-05-09', salt: '', iv: '', ciphertext: '' },
    ]);
    verifyCanaryFromRowsMock.mockResolvedValue('wrong-passphrase');
    const result = await checkCanaryProtection('wrong-pass', 'eiass');
    expect(result).toBe('orphan');
  });
});

describe('getCanaryProtectionState', () => {
  it('returns "unknown" before any check', () => {
    expect(getCanaryProtectionState()).toBe('unknown');
  });

  it('reflects the result of the last check', async () => {
    pullByUsernameMock.mockResolvedValue([]);
    await checkCanaryProtection('p', 'u');
    expect(getCanaryProtectionState()).toBe('safe');
  });
});

describe('clearOrphanProtection', () => {
  it('flips orphan → safe (the explicit-override path)', async () => {
    pullByUsernameMock.mockResolvedValue([
      { blob_type: 'patient', blob_id: 'p1', salt: '', iv: '', ciphertext: '' },
    ]);
    verifyCanaryFromRowsMock.mockResolvedValue('wrong-passphrase');
    await checkCanaryProtection('wrong', 'u');
    expect(getCanaryProtectionState()).toBe('orphan');

    clearOrphanProtection();
    expect(getCanaryProtectionState()).toBe('safe');
  });

  it('is a no-op when state is "safe" or "unknown"', () => {
    expect(getCanaryProtectionState()).toBe('unknown');
    clearOrphanProtection();
    expect(getCanaryProtectionState()).toBe('unknown');
  });
});
