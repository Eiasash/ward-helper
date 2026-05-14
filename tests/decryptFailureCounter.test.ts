/**
 * PR-B2.2 — session-scoped decrypt-failure counter tests.
 *
 * The counter increments when `decryptRowIfEncrypted` returns null
 * (decrypt failure). The banner UI reads the count via
 * `getDecryptFailureCount()` and re-renders on the
 * `'ward-helper:phi-decrypt-fail'` event.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '@/storage/indexed';
import {
  derivePhiKey,
  setPhiKey,
  clearPhiKey,
  sealRow,
} from '@/crypto/phi';
import {
  decryptRowIfEncrypted,
  getDecryptFailureCount,
  clearDecryptFailureCount,
  subscribeDecryptFailureChanges,
  type SealedPatientRow,
} from '@/crypto/phiRow';
import type { Sealed } from '@/crypto/aes';

const TEST_ITERATIONS = 4;
const PASSWORD = 'pw';

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
}

beforeEach(async () => {
  clearPhiKey();
  clearDecryptFailureCount();
  await resetDbForTests();
});

afterEach(() => {
  clearPhiKey();
  clearDecryptFailureCount();
});

describe('decrypt-failure counter (session-scoped)', () => {
  it('starts at zero', () => {
    expect(getDecryptFailureCount()).toBe(0);
  });

  it('increments on each decryptRowIfEncrypted that returns null', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const patient = { id: 'p-1', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    const sealed = await sealRow(patient);

    // Corrupt the ciphertext
    const corrupt: Sealed = {
      iv: sealed.iv,
      ciphertext: new Uint8Array(sealed.ciphertext.buffer.slice(0)) as Uint8Array<ArrayBuffer>,
    };
    corrupt.ciphertext[0] = (corrupt.ciphertext[0]! ^ 0xff) as number;
    const corruptRow: SealedPatientRow = { id: 'p-1', enc: corrupt };

    expect(getDecryptFailureCount()).toBe(0);
    await decryptRowIfEncrypted(corruptRow, 'patient');
    expect(getDecryptFailureCount()).toBe(1);

    // Second corrupt row → count = 2
    await decryptRowIfEncrypted(corruptRow, 'patient');
    expect(getDecryptFailureCount()).toBe(2);
  });

  it('does NOT increment on plaintext passthrough', async () => {
    const plain = { id: 'p-1', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    await decryptRowIfEncrypted(plain, 'patient');
    expect(getDecryptFailureCount()).toBe(0);
  });

  it('does NOT increment on successful decrypt', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const patient = { id: 'p-1', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    const sealed = await sealRow(patient);
    const row: SealedPatientRow = { id: 'p-1', enc: sealed };
    const recovered = await decryptRowIfEncrypted(row, 'patient');
    expect(recovered).toEqual(patient);
    expect(getDecryptFailureCount()).toBe(0);
  });

  it('fires the ward-helper:phi-decrypt-fail event on increment + clear', async () => {
    setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
    const patient = { id: 'p-1', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    const sealed = await sealRow(patient);
    const corrupt: Sealed = {
      iv: sealed.iv,
      ciphertext: new Uint8Array(sealed.ciphertext.buffer.slice(0)) as Uint8Array<ArrayBuffer>,
    };
    corrupt.ciphertext[0] = (corrupt.ciphertext[0]! ^ 0xff) as number;
    const corruptRow: SealedPatientRow = { id: 'p-1', enc: corrupt };

    let calls = 0;
    const unsubscribe = subscribeDecryptFailureChanges(() => {
      calls++;
    });

    await decryptRowIfEncrypted(corruptRow, 'patient');
    expect(calls).toBe(1);

    clearDecryptFailureCount();
    expect(calls).toBe(2);
    expect(getDecryptFailureCount()).toBe(0);

    unsubscribe();
  });

  it('clearDecryptFailureCount is a noop (no event) when count is already 0', () => {
    let calls = 0;
    const unsubscribe = subscribeDecryptFailureChanges(() => {
      calls++;
    });
    clearDecryptFailureCount();
    expect(calls).toBe(0);
    unsubscribe();
  });
});
