import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { pushBlobMock, pushCanaryMock } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pushCanaryMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pushBlob: pushBlobMock,
    pushCanary: pushCanaryMock,
  };
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
});
