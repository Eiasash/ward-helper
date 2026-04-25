import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

// Mock cloud + crypto + costs + settings hook BEFORE importing saveBoth, so
// the module under test resolves the mocked versions.
vi.mock('@/storage/cloud', () => ({
  encryptForCloud: vi.fn(async (_obj: unknown, _key: CryptoKey, _salt: Uint8Array) => ({
    ciphertext: new Uint8Array([1, 2, 3]),
    iv: new Uint8Array([4, 5, 6]),
    salt: new Uint8Array([7, 8, 9]),
  })),
  pushBlob: vi.fn(async () => undefined),
}));
vi.mock('@/crypto/pbkdf2', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    deriveAesKey: vi.fn(async () => ({ type: 'secret' } as unknown as CryptoKey)),
  };
});
vi.mock('@/agent/costs', () => ({
  finalizeSessionFor: vi.fn(),
}));
vi.mock('@/ui/hooks/useSettings', () => ({
  getPassphrase: vi.fn(() => null),
}));

import { saveBoth } from '@/notes/save';
import { listPatients, listNotes, resetDbForTests } from '@/storage/indexed';
import * as cloud from '@/storage/cloud';
import * as costs from '@/agent/costs';
import * as settings from '@/ui/hooks/useSettings';

beforeEach(async () => {
  await resetDbForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveBoth — local-only path (no passphrase)', () => {
  it('writes patient + note to IndexedDB and returns both ids', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const result = await saveBoth(
      { name: 'דוד כהן', teudatZehut: '123456789', age: 80, room: '12A' },
      'admission',
      'גוף ההסבה בעברית',
    );
    expect(result.patientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.noteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.cloudPushed).toBe(false);

    const patients = await listPatients();
    const [p] = patients;
    expect(p).toBeDefined();
    expect(p!.name).toBe('דוד כהן');
    expect(p!.teudatZehut).toBe('123456789');
    expect(p!.room).toBe('12A');
    const notes = await listNotes(result.patientId);
    expect(notes).toHaveLength(1);
    const [n] = notes;
    expect(n!.patientId).toBe(result.patientId);
    expect(n!.type).toBe('admission');
    expect(n!.bodyHebrew).toBe('גוף ההסבה בעברית');
  });

  it('does NOT call cloud encrypt/push when no passphrase is set', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await saveBoth({ name: 'X' }, 'consult', 'body');
    expect(cloud.encryptForCloud).not.toHaveBeenCalled();
    expect(cloud.pushBlob).not.toHaveBeenCalled();
  });

  it('finalizes the cost session against the new patientId', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const result = await saveBoth({ name: 'Y' }, 'discharge', 'body');
    expect(costs.finalizeSessionFor).toHaveBeenCalledWith(result.patientId);
  });

  it('handles missing optional fields without crashing', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const result = await saveBoth({}, 'case', '');
    const [p] = await listPatients();
    expect(p).toBeDefined();
    expect(p!.name).toBe('');
    expect(p!.teudatZehut).toBe('');
    expect(p!.room).toBeNull();
    expect(result.cloudPushed).toBe(false);
  });

  it('dedupes by ת.ז. — second save for the same teudatZehut reuses the patientId', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const r1 = await saveBoth(
      { name: 'דוד כהן', teudatZehut: '123456789', room: '12A' },
      'admission',
      'first body',
    );
    const r2 = await saveBoth(
      { name: 'דוד כהן', teudatZehut: '123456789', room: '12B' },
      'soap',
      'second body',
    );
    expect(r2.patientId).toBe(r1.patientId);
    const patients = await listPatients();
    expect(patients).toHaveLength(1);
    expect(patients[0]!.room).toBe('12B'); // latest non-empty value wins
  });

  it('preserves existing fields when a follow-up save has sparse extract', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const r1 = await saveBoth(
      { name: 'מרים גולן', teudatZehut: '987654321', room: '5A' },
      'admission',
      'first body',
    );
    // Second save: extract lost name + room (only tz survived).
    const r2 = await saveBoth(
      { teudatZehut: '987654321' },
      'soap',
      'second body',
    );
    expect(r2.patientId).toBe(r1.patientId);
    const [p] = await listPatients();
    expect(p!.name).toBe('מרים גולן'); // not clobbered to ''
    expect(p!.room).toBe('5A');         // not clobbered to null
  });

  it('normalizes whitespace in teudatZehut on write so the index resolves consistently', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const r1 = await saveBoth(
      { name: 'A', teudatZehut: '  111111111  ' },
      'admission',
      'b1',
    );
    const r2 = await saveBoth(
      { name: 'A', teudatZehut: '111111111' },
      'soap',
      'b2',
    );
    expect(r2.patientId).toBe(r1.patientId);
    const patients = await listPatients();
    expect(patients).toHaveLength(1);
    expect(patients[0]!.teudatZehut).toBe('111111111'); // stored normalized
  });
});

describe('saveBoth — cloud-push path (passphrase set)', () => {
  it('encrypts patient + note and pushes both blobs when passphrase present', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue('correct horse battery staple');
    const result = await saveBoth({ name: 'Z' }, 'admission', 'body');
    expect(result.cloudPushed).toBe(true);
    expect(cloud.encryptForCloud).toHaveBeenCalledTimes(2);
    expect(cloud.pushBlob).toHaveBeenCalledTimes(2);
    const calls = (cloud.pushBlob as ReturnType<typeof vi.fn>).mock.calls;
    const types = calls.map((c) => c[0]);
    expect(types.sort()).toEqual(['note', 'patient']);
  });

  it('still saves locally AND reports the failure reason when cloud push throws', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue('pass');
    (cloud.pushBlob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('PGRST205: table does not exist'),
    );
    const result = await saveBoth({ name: 'fallback' }, 'admission', 'body');
    expect(result.cloudPushed).toBe(false);
    expect(result.cloudSkippedReason).toContain('PGRST205');
    const patients = await listPatients();
    expect(patients).toHaveLength(1); // local persist still happened
  });

  it('reports "no-passphrase" (not a real error) when passphrase missing', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const result = await saveBoth({ name: 'Q' }, 'soap', 'body');
    expect(result.cloudPushed).toBe(false);
    expect(result.cloudSkippedReason).toBe('no-passphrase');
  });

  it('derives the AES key only once even though it encrypts two blobs', async () => {
    (settings.getPassphrase as ReturnType<typeof vi.fn>).mockReturnValue('k');
    const derive = (await import('@/crypto/pbkdf2')).deriveAesKey as unknown as ReturnType<typeof vi.fn>;
    (derive as ReturnType<typeof vi.fn>).mockClear?.();
    await saveBoth({ name: 'once' }, 'admission', 'body');
    // One derivation shared across patient + note encryption — saves ~300ms
    // of PBKDF2 on every save. Regression guard.
    if ((derive as ReturnType<typeof vi.fn>).mock) {
      expect((derive as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    }
  });
});
