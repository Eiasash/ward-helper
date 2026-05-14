/**
 * PR-B2.1 unit tests for src/crypto/phiRow.ts.
 *
 * Covers:
 *   - The synchronous shape sniff (`isEncryptedRow`) — positive +
 *     negative cases, with the PINNED malformed-row passthrough
 *     contract (a row that matches neither shape cleanly goes down
 *     the plaintext path, NOT to unsealRow).
 *   - `decryptRowIfEncrypted` — plaintext passthrough, encrypted
 *     round-trip, decrypt-failure null, undefined/null inputs.
 *   - `decryptRowsIfEncrypted` — empty input, all-plaintext fast path,
 *     mixed shapes, decrypt-failure filter.
 *   - `isPhiEncryptV7Enabled` — default off, on when localStorage set,
 *     off on access failure.
 *
 * `iterations: 4` everywhere a key is derived (matches phiCrypto.test.ts).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isEncryptedRow,
  decryptRowIfEncrypted,
  decryptRowsIfEncrypted,
  isPhiEncryptV7Enabled,
} from '@/crypto/phiRow';
import type { SealedPatientRow, SealedNoteRow } from '@/crypto/phiRow';
import {
  derivePhiKey,
  setPhiKey,
  clearPhiKey,
  sealRow,
} from '@/crypto/phi';
import { resetDbForTests } from '@/storage/indexed';
import type { Sealed } from '@/crypto/aes';

const TEST_ITERATIONS = 4;
const PASSWORD = 'correct horse battery staple';

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
}

beforeEach(async () => {
  clearPhiKey();
  await resetDbForTests();
  // Reset the flag to off between tests.
  try {
    localStorage.removeItem('phi_encrypt_v7');
  } catch {
    // happy-dom typically provides localStorage; defensive in case env varies.
  }
});

afterEach(() => {
  clearPhiKey();
});

// ─── isEncryptedRow ──────────────────────────────────────────────────

describe('isEncryptedRow (sync shape sniff)', () => {
  it('returns true for a structurally valid SealedPatientRow', () => {
    const row: SealedPatientRow = {
      id: 'p-1',
      enc: {
        iv: new Uint8Array(12) as Uint8Array<ArrayBuffer>,
        ciphertext: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
      },
    };
    expect(isEncryptedRow(row)).toBe(true);
  });

  it('returns true for a structurally valid SealedNoteRow (top-level patientId preserved)', () => {
    const row: SealedNoteRow = {
      id: 'n-1',
      patientId: 'p-1',
      enc: {
        iv: new Uint8Array(12) as Uint8Array<ArrayBuffer>,
        ciphertext: new Uint8Array(64) as Uint8Array<ArrayBuffer>,
      },
    };
    expect(isEncryptedRow(row)).toBe(true);
  });

  it('returns false for a plaintext Patient row (no `enc` field)', () => {
    const row = {
      id: 'p-1',
      name: 'בדיקה',
      teudatZehut: '123456789',
      dob: '1950-01-01',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(isEncryptedRow(row)).toBe(false);
  });

  // ─── PINNED malformed-row passthrough ───
  //
  // A half-migrated or otherwise malformed row matches NEITHER shape
  // cleanly. Per the design pin (`.audit_logs/2026-05-14-pr-b2-design-pins.md`
  // §"Shape-sniff"), these MUST go down the plaintext path so the
  // consumer hits a normal "missing field" downstream error rather than
  // silently disappearing through `unsealRow`'s null-on-failure return.
  //
  // Each case below documents a different failure mode of half-migration.
  describe('malformed-row passthrough (PINNED)', () => {
    it('returns false when `enc` is present but is a string', () => {
      const row = { id: 'p-1', enc: 'not-an-object' };
      expect(isEncryptedRow(row)).toBe(false);
    });

    it('returns false when `enc` is present but is null', () => {
      const row = { id: 'p-1', enc: null };
      expect(isEncryptedRow(row)).toBe(false);
    });

    it('returns false when `enc` lacks `iv`', () => {
      const row = {
        id: 'p-1',
        enc: { ciphertext: new Uint8Array(32) as Uint8Array<ArrayBuffer> },
      };
      expect(isEncryptedRow(row)).toBe(false);
    });

    it('returns false when `enc` lacks `ciphertext`', () => {
      const row = {
        id: 'p-1',
        enc: { iv: new Uint8Array(12) as Uint8Array<ArrayBuffer> },
      };
      expect(isEncryptedRow(row)).toBe(false);
    });

    it('returns false when `iv` and `ciphertext` are not Uint8Arrays (e.g. JSON-deserialized as numeric arrays)', () => {
      const row = {
        id: 'p-1',
        enc: { iv: [0, 1, 2], ciphertext: [3, 4, 5] },
      };
      expect(isEncryptedRow(row)).toBe(false);
    });

    it('returns false when `id` is missing or non-string', () => {
      expect(isEncryptedRow({ enc: { iv: new Uint8Array(12), ciphertext: new Uint8Array(32) } })).toBe(false);
      expect(isEncryptedRow({ id: 42, enc: { iv: new Uint8Array(12), ciphertext: new Uint8Array(32) } })).toBe(false);
    });
  });

  it('returns false for null, undefined, primitives, arrays', () => {
    expect(isEncryptedRow(null)).toBe(false);
    expect(isEncryptedRow(undefined)).toBe(false);
    expect(isEncryptedRow('string')).toBe(false);
    expect(isEncryptedRow(42)).toBe(false);
    expect(isEncryptedRow([])).toBe(false);
  });
});

// ─── decryptRowIfEncrypted ───────────────────────────────────────────

describe('decryptRowIfEncrypted (async read seam)', () => {
  it('plaintext passthrough: returns the row as-is when not encrypted', async () => {
    const row = {
      id: 'p-1',
      name: 'בדיקה',
      teudatZehut: '123456789',
      dob: '1950-01-01',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const out = await decryptRowIfEncrypted(row, 'patient');
    expect(out).toBe(row); // identity, not just equality
  });

  it('malformed-row passthrough (PINNED): does NOT call unsealRow, returns row as-is', async () => {
    const row = { id: 'p-1', enc: 'not-an-object', extra: 'data' };
    const out = await decryptRowIfEncrypted(row, 'patient');
    // Critical invariant: the row comes back unchanged. If it went down the
    // unsealRow path, unsealRow would throw on `enc.iv` being undefined, or
    // catch internally and return null. We want neither — we want passthrough.
    expect(out).toBe(row);
  });

  it('encrypted round-trip: decrypts a sealed Patient row to its plaintext', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const patient = {
      id: 'p-1',
      name: 'מטופלת בדיקה',
      teudatZehut: '987654321',
      dob: '1940-05-12',
      room: 'B7',
      tags: ['isolation'],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    const sealed = await sealRow(patient);
    const sealedRow: SealedPatientRow = { id: patient.id, enc: sealed };
    const decrypted = await decryptRowIfEncrypted<typeof patient>(sealedRow, 'patient');
    expect(decrypted).toEqual(patient);
  });

  it('encrypted round-trip: decrypts a sealed Note row (patientId preserved at top level)', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const note = {
      id: 'n-1',
      patientId: 'p-1',
      type: 'admission' as const,
      bodyHebrew: 'מטופלת בת 87 עם דלקת ריאות.',
      structuredData: { hr: 92 },
      createdAt: 1,
      updatedAt: 1,
    };
    const sealed = await sealRow(note);
    const sealedRow: SealedNoteRow = {
      id: note.id,
      patientId: note.patientId,
      enc: sealed,
    };
    const decrypted = await decryptRowIfEncrypted<typeof note>(sealedRow, 'note');
    expect(decrypted).toEqual(note);
  });

  it('decrypt-failure: returns null when ciphertext is corrupted', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const patient = { id: 'p-1', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    const sealed = await sealRow(patient);
    const corrupted: Sealed = {
      iv: sealed.iv,
      ciphertext: new Uint8Array(sealed.ciphertext.buffer.slice(0)) as Uint8Array<ArrayBuffer>,
    };
    corrupted.ciphertext[0] = (corrupted.ciphertext[0]! ^ 0xff) as number;
    const sealedRow: SealedPatientRow = { id: patient.id, enc: corrupted };
    const out = await decryptRowIfEncrypted(sealedRow, 'patient');
    expect(out).toBeNull();
  });

  it('returns undefined for undefined input (IDB miss passthrough)', async () => {
    expect(await decryptRowIfEncrypted(undefined, 'patient')).toBeUndefined();
  });

  it('returns null for null input', async () => {
    expect(await decryptRowIfEncrypted(null, 'patient')).toBeNull();
  });
});

// ─── decryptRowsIfEncrypted (array variant) ──────────────────────────

describe('decryptRowsIfEncrypted (array variant)', () => {
  it('empty array: returns empty array', async () => {
    const out = await decryptRowsIfEncrypted<{ id: string }>([], 'patient');
    expect(out).toEqual([]);
  });

  it('all-plaintext fast path: returns the input array (no per-row await cost)', async () => {
    const rows = [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
      { id: '3', name: 'c' },
    ];
    const out = await decryptRowsIfEncrypted<(typeof rows)[0]>(rows, 'patient');
    expect(out).toBe(rows); // identity — fast path returns the same reference
  });

  it('mixed plaintext + encrypted: decrypts encrypted rows, leaves plaintext rows alone', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const plain1 = { id: '1', name: 'plain-1', teudatZehut: '111', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    const plain2 = { id: '3', name: 'plain-2', teudatZehut: '333', dob: '', room: null, tags: [], createdAt: 3, updatedAt: 3 };
    const encInner = { id: '2', name: 'sealed', teudatZehut: '222', dob: '', room: null, tags: [], createdAt: 2, updatedAt: 2 };
    const encRow: SealedPatientRow = { id: '2', enc: await sealRow(encInner) };
    const mixed = [plain1, encRow, plain2];
    const out = await decryptRowsIfEncrypted<typeof plain1>(mixed, 'patient');
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(plain1);
    expect(out[1]).toEqual(encInner);
    expect(out[2]).toBe(plain2);
  });

  it('filters out decrypt-failure nulls (does not crash)', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const inner = { id: '1', value: 'ok' };
    const sealed = await sealRow(inner);
    const goodRow: SealedPatientRow = { id: '1', enc: sealed };
    // Corrupt a copy
    const corrupted: Sealed = {
      iv: sealed.iv,
      ciphertext: new Uint8Array(sealed.ciphertext.buffer.slice(0)) as Uint8Array<ArrayBuffer>,
    };
    corrupted.ciphertext[0] = (corrupted.ciphertext[0]! ^ 0xff) as number;
    const badRow: SealedPatientRow = { id: '2', enc: corrupted };
    const out = await decryptRowsIfEncrypted<typeof inner>([goodRow, badRow], 'patient');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(inner);
  });
});

// ─── isPhiEncryptV7Enabled ───────────────────────────────────────────

describe('isPhiEncryptV7Enabled (write-side flag gate)', () => {
  it('default is OFF', () => {
    expect(isPhiEncryptV7Enabled()).toBe(false);
  });

  it("returns true when localStorage.phi_encrypt_v7 === '1'", () => {
    localStorage.setItem('phi_encrypt_v7', '1');
    expect(isPhiEncryptV7Enabled()).toBe(true);
  });

  it('returns false for any value other than the literal string "1"', () => {
    localStorage.setItem('phi_encrypt_v7', 'true');
    expect(isPhiEncryptV7Enabled()).toBe(false);
    localStorage.setItem('phi_encrypt_v7', '0');
    expect(isPhiEncryptV7Enabled()).toBe(false);
    localStorage.setItem('phi_encrypt_v7', '');
    expect(isPhiEncryptV7Enabled()).toBe(false);
  });
});
