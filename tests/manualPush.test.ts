import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  pushBlobMock,
  pushCanaryMock,
  checkCanaryProtectionMock,
} = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pushCanaryMock: vi.fn(),
  checkCanaryProtectionMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pushBlob: pushBlobMock,
    pushCanary: pushCanaryMock,
  };
});

vi.mock('@/storage/canaryProtection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/canaryProtection')>();
  return { ...actual, checkCanaryProtection: checkCanaryProtectionMock };
});

import { resetDbForTests, putPatient, putNote } from '@/storage/indexed';
import { saveApiKey } from '@/crypto/keystore';
import { pushAllToCloud } from '@/notes/manualPush';

beforeEach(async () => {
  await resetDbForTests();
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
  pushCanaryMock.mockReset();
  pushCanaryMock.mockResolvedValue(undefined);
  // Default: not-orphan (the happy / general-failure paths in pre-existing
  // tests rely on this). Individual tests override to 'orphan' as needed.
  checkCanaryProtectionMock.mockReset();
  checkCanaryProtectionMock.mockResolvedValue('ok');
});

describe('pushAllToCloud', () => {
  it('pushes canary, every patient, every note, and api-key', async () => {
    await putPatient({
      id: 'p1', name: 'A', teudatZehut: '1', dob: '1950-01-01', room: null,
      tags: [], createdAt: 1, updatedAt: 1,
    });
    await putNote({
      id: 'n1', patientId: 'p1', type: 'admission', bodyHebrew: 'x',
      structuredData: {}, createdAt: 1, updatedAt: 1,
    });
    await saveApiKey('sk-ant-test');

    const out = await pushAllToCloud('my-pass', 'eiass');
    expect(out.pushedCanary).toBe(true);
    expect(out.pushedPatients).toBe(1);
    expect(out.pushedNotes).toBe(1);
    expect(out.pushedApiKey).toBe(true);
    expect(out.failed).toEqual([]);

    expect(pushCanaryMock).toHaveBeenCalledTimes(1);
    // Should be: 1 patient + 1 note + 1 api-key = 3 pushBlob calls (canary went via pushCanaryMock).
    expect(pushBlobMock).toHaveBeenCalledTimes(3);
  });

  it('continues past per-row failures and reports them', async () => {
    await putPatient({
      id: 'p1', name: 'A', teudatZehut: '1', dob: '', room: null,
      tags: [], createdAt: 1, updatedAt: 1,
    });
    pushBlobMock.mockRejectedValueOnce(new Error('network'));
    pushBlobMock.mockResolvedValue(undefined);
    const out = await pushAllToCloud('p', 'eiass');
    expect(out.failed.length).toBe(1);
    expect(out.failed[0]).toMatchObject({ blob_type: 'patient', blob_id: 'p1' });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Coverage extension 2026-05-14: previously-uncovered failure branches.
  // manualPush.ts had 25% branch coverage; the 4 cases below close the
  // gap on the canary-skip, canary-push-fail, note-push-fail, and
  // api-key-push-fail paths. Each path is a real production failure mode
  // (network blip mid-backup, cloud auth rotation, schema drift, etc.).
  // ─────────────────────────────────────────────────────────────────────

  describe('failure-path coverage', () => {
    it('skips canary push when orphan-protected (different passphrase in cloud)', async () => {
      // v1.39.9 invariant: if cloud has data encrypted with a different
      // passphrase, the canary marker must survive — otherwise the user
      // can no longer recover the prior data by re-entering the original
      // passphrase. Verify pushCanary is NOT called and the result flags
      // the skip explicitly.
      checkCanaryProtectionMock.mockResolvedValue('orphan');
      await putPatient({
        id: 'p1', name: 'A', teudatZehut: '1', dob: '1950-01-01', room: null,
        tags: [], createdAt: 1, updatedAt: 1,
      });

      const out = await pushAllToCloud('different-pass', 'eiass');

      expect(out.canarySkippedOrphan).toBe(true);
      expect(out.pushedCanary).toBe(false);
      expect(pushCanaryMock).not.toHaveBeenCalled();
      // The orphan protection only blocks the canary — patient/note/api-key
      // pushes still proceed (the user's intent to back up new data is
      // honored; only the marker stays untouched).
      expect(out.pushedPatients).toBe(1);
      expect(out.failed).toEqual([]);
    });

    it('captures canary-push failure in result.failed without aborting', async () => {
      pushCanaryMock.mockRejectedValueOnce(new Error('cloud-auth-rotated'));
      await putPatient({
        id: 'p1', name: 'A', teudatZehut: '1', dob: '1950-01-01', room: null,
        tags: [], createdAt: 1, updatedAt: 1,
      });

      const out = await pushAllToCloud('my-pass', 'eiass');

      expect(out.pushedCanary).toBe(false);
      expect(out.failed).toEqual([
        expect.objectContaining({
          blob_type: 'canary',
          blob_id: '__canary__',
          reason: 'cloud-auth-rotated',
        }),
      ]);
      // Patient push continues despite canary failure.
      expect(out.pushedPatients).toBe(1);
    });

    it('captures note-push failure in result.failed (note rejected, patient OK)', async () => {
      await putPatient({
        id: 'p1', name: 'A', teudatZehut: '1', dob: '1950-01-01', room: null,
        tags: [], createdAt: 1, updatedAt: 1,
      });
      await putNote({
        id: 'n-failing', patientId: 'p1', type: 'admission', bodyHebrew: 'x',
        structuredData: {}, createdAt: 1, updatedAt: 1,
      });

      // First pushBlob call is for the patient (succeeds), second is the
      // note (fails). API-key call below would be third, but no api-key
      // is saved, so it short-circuits.
      pushBlobMock.mockResolvedValueOnce(undefined);
      pushBlobMock.mockRejectedValueOnce(new Error('schema-drift'));

      const out = await pushAllToCloud('my-pass', 'eiass');

      expect(out.pushedPatients).toBe(1);
      expect(out.pushedNotes).toBe(0);
      expect(out.failed).toEqual([
        expect.objectContaining({
          blob_type: 'note',
          blob_id: 'n-failing',
          reason: 'schema-drift',
        }),
      ]);
    });

    it('captures api-key-push failure in result.failed when pushBlob rejects on api-key', async () => {
      await saveApiKey('sk-ant-test');
      // Reject only on the api-key pushBlob call. Patient/note pushes pass.
      // pushApiKeyToCloud (in src/crypto/keystore.ts) calls pushBlob with
      // blob_type='api-key' — that's our discriminator.
      pushBlobMock.mockImplementation(async (blobType: string) => {
        if (blobType === 'api-key') throw new Error('network');
      });

      const out = await pushAllToCloud('my-pass', 'eiass');

      expect(out.pushedApiKey).toBe(false);
      expect(out.failed).toEqual([
        expect.objectContaining({
          blob_type: 'api-key',
          blob_id: '__user_default__',
          reason: 'network',
        }),
      ]);
    });
  });
});
