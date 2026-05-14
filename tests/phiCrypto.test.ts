/**
 * PR-A unit tests for src/crypto/phi.ts.
 *
 * Covers derivation, in-memory key lifecycle, seal/unseal round-trip,
 * decrypt-failure paths (the "must not crash" discipline), and salt
 * persistence semantics. No DB schema changes are exercised here —
 * those land in PR-B.
 *
 * `iterations: 4` is used everywhere the test derives a key. Production
 * code uses the default 600_000; the parameterisation exists solely to
 * keep this file fast.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  derivePhiKey,
  setPhiKey,
  getPhiKey,
  hasPhiKey,
  clearPhiKey,
  sealRow,
  unsealRow,
  loadOrCreatePhiSalt,
  PHI_PBKDF2_ITERATIONS,
} from '@/crypto/phi';
import { resetDbForTests, getSettings } from '@/storage/indexed';
import type { Sealed } from '@/crypto/aes';

const TEST_ITERATIONS = 4;
const PASSWORD = 'correct horse battery staple';

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
}

beforeEach(async () => {
  clearPhiKey();
  await resetDbForTests();
});

describe('derivePhiKey', () => {
  it('returns an AES-GCM CryptoKey that is non-extractable', async () => {
    const key = await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS);
    expect(key.type).toBe('secret');
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(key.usages).toEqual(expect.arrayContaining(['encrypt', 'decrypt']));
  });

  it('is deterministic for the same password + salt', async () => {
    const salt = randomSalt();
    const a = await derivePhiKey(PASSWORD, salt, TEST_ITERATIONS);
    const b = await derivePhiKey(PASSWORD, salt, TEST_ITERATIONS);
    // CryptoKeys aren't directly comparable; round-trip a payload to
    // prove the two derivations yield interchangeable keys.
    setPhiKey(a);
    const sealed = await sealRow({ probe: 'ok' });
    setPhiKey(b);
    expect(await unsealRow<{ probe: string }>(sealed)).toEqual({ probe: 'ok' });
  });

  it('exports the production iteration count as 600,000', () => {
    expect(PHI_PBKDF2_ITERATIONS).toBe(600_000);
  });
});

describe('in-memory key lifecycle', () => {
  it('starts cleared', () => {
    expect(hasPhiKey()).toBe(false);
    expect(getPhiKey()).toBeNull();
  });

  it('setPhiKey/hasPhiKey/clearPhiKey transition cleanly', async () => {
    const key = await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS);
    setPhiKey(key);
    expect(hasPhiKey()).toBe(true);
    expect(getPhiKey()).toBe(key);
    clearPhiKey();
    expect(hasPhiKey()).toBe(false);
    expect(getPhiKey()).toBeNull();
  });
});

describe('sealRow + unsealRow', () => {
  it('round-trips a Patient-shaped object', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const patient = {
      id: 'p-1',
      name: 'בדיקה שם',
      teudatZehut: '123456789',
      dob: '1950-01-01',
      room: 'A12',
      tags: ['isolation'],
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    };
    const sealed = await sealRow(patient);
    expect(await unsealRow<typeof patient>(sealed)).toEqual(patient);
  });

  it('round-trips a Note-shaped object with Hebrew + clinical text', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const note = {
      id: 'n-1',
      patientId: 'p-1',
      type: 'admission' as const,
      bodyHebrew: 'מטופלת בת 87 הגיעה למיון עם דלקת ריאות. Hb 8.3, CRP 145.',
      structuredData: { chief_complaint: 'shortness of breath' },
      createdAt: 1,
      updatedAt: 1,
    };
    const sealed = await sealRow(note);
    expect(await unsealRow<typeof note>(sealed)).toEqual(note);
  });

  it('sealRow throws if no key is set', async () => {
    await expect(sealRow({ x: 1 })).rejects.toThrow(/no PHI key set/);
  });

  it('unsealRow returns null when no key is set (does not throw)', async () => {
    // Build a syntactically-valid Sealed envelope (encrypt with one key,
    // then clear before unsealing) so we exercise the "no key" branch
    // specifically, not a "bad shape" path.
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const sealed = await sealRow({ probe: 'ok' });
    clearPhiKey();
    expect(await unsealRow<{ probe: string }>(sealed)).toBeNull();
  });

  it('unsealRow returns null on wrong-key (different password)', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const sealed = await sealRow({ probe: 'ok' });
    setPhiKey(await derivePhiKey('different-password', randomSalt(), TEST_ITERATIONS));
    expect(await unsealRow<{ probe: string }>(sealed)).toBeNull();
  });

  it('unsealRow returns null on corrupted ciphertext (GCM auth-tag fail)', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const sealed = await sealRow({ probe: 'ok' });
    const corrupted: Sealed = {
      iv: sealed.iv,
      // Flip the first byte — guaranteed to break the GCM auth tag check.
      ciphertext: new Uint8Array(sealed.ciphertext.buffer.slice(0)) as Uint8Array<ArrayBuffer>,
    };
    corrupted.ciphertext[0] = (corrupted.ciphertext[0]! ^ 0xff) as number;
    expect(await unsealRow<{ probe: string }>(corrupted)).toBeNull();
  });
});

describe('loadOrCreatePhiSalt', () => {
  it('generates and persists a 16-byte salt on first call', async () => {
    const s = await loadOrCreatePhiSalt();
    expect(s.byteLength).toBe(16);

    const persisted = await getSettings();
    expect(persisted?.phiSalt).toBeDefined();
    expect(persisted?.phiSalt?.byteLength).toBe(16);
    expect(Array.from(persisted!.phiSalt!)).toEqual(Array.from(s));
  });

  it('returns the same salt across calls — never regenerates', async () => {
    const a = await loadOrCreatePhiSalt();
    const b = await loadOrCreatePhiSalt();
    const c = await loadOrCreatePhiSalt();
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(b)).toEqual(Array.from(c));
  });

  it('preserves other Settings fields when generating a new salt', async () => {
    // Stand in some pre-existing settings (the realistic state on any
    // install older than PR-A) and confirm we don't clobber them.
    const { setSettings } = await import('@/storage/indexed');
    const seedSecret = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    await setSettings({
      apiKeyXor: new Uint8Array(0),
      deviceSecret: seedSecret,
      lastPassphraseAuthAt: 1700000000000,
      prefs: { someFlag: true },
      cachedUnlockBlob: null,
      loginPwdXor: null,
    });

    await loadOrCreatePhiSalt();

    const after = await getSettings();
    expect(Array.from(after!.deviceSecret)).toEqual([1, 2, 3, 4]);
    expect(after!.lastPassphraseAuthAt).toBe(1700000000000);
    expect(after!.prefs).toEqual({ someFlag: true });
    expect(after!.phiSalt?.byteLength).toBe(16);
  });
});
