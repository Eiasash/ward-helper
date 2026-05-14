/**
 * PR-B2.1 integration test for the read seam.
 *
 * Validates the SAME read seam end-to-end against fake-indexeddb with
 * a mix of plaintext + encrypted rows in the same store. The B2.1
 * design says: encrypted rows that exist in storage MUST decrypt on
 * read regardless of the write-flag state (read path is shape-driven).
 * This test proves it by direct-seeding encrypted rows into IDB (raw),
 * then exercising every wired read site to confirm callers see the
 * decrypted plaintext.
 *
 * Under B2.1's flag-off + no-encrypted-rows world this scenario never
 * arises in production, BUT once B2.2's backfill runs, every read path
 * will hit mixed-state. Witnessing the seam works end-to-end NOW (in
 * test) is the bake-in-isolation property B2.1 was split to deliver.
 *
 * Note: B2.1 does NOT yet write encrypted rows itself (B2.2 does). The
 * test seeds encrypted rows directly via the IDB API and the sealRow
 * helper to simulate post-B2.2 storage state.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetDbForTests,
  listPatients,
  listAllNotes,
  listNotes,
  listNotesByTeudatZehut,
  getPatient,
  getNote,
  getPatientByTz,
  listPatientsByTzMap,
  type Patient,
  type Note,
} from '@/storage/indexed';
import {
  derivePhiKey,
  setPhiKey,
  clearPhiKey,
  sealRow,
} from '@/crypto/phi';
import type { SealedPatientRow, SealedNoteRow } from '@/crypto/phiRow';

const TEST_ITERATIONS = 4;
const PASSWORD = 'mixed-state-bake-test';

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
}

beforeEach(async () => {
  clearPhiKey();
  await resetDbForTests();
  setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
});

afterEach(() => {
  clearPhiKey();
});

/**
 * Seed a patient row in either plaintext or encrypted form, depending
 * on `encrypted`. Uses raw IDB so we don't depend on B2.2's write path
 * (which doesn't exist yet).
 */
async function seedPatient(p: Patient, encrypted: boolean): Promise<void> {
  const { getDb } = await import('@/storage/indexed');
  const db = await getDb();
  if (encrypted) {
    const enc = await sealRow(p);
    const row: SealedPatientRow = { id: p.id, enc };
    await db.put('patients', row as unknown as Patient);
  } else {
    await db.put('patients', p);
  }
}

async function seedNote(n: Note, encrypted: boolean): Promise<void> {
  const { getDb } = await import('@/storage/indexed');
  const db = await getDb();
  if (encrypted) {
    const enc = await sealRow(n);
    const row: SealedNoteRow = { id: n.id, patientId: n.patientId, enc };
    await db.put('notes', row as unknown as Note);
  } else {
    await db.put('notes', n);
  }
}

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: 'בדיקה',
    teudatZehut: '111111111',
    dob: '1950-01-01',
    room: null,
    tags: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    patientId: overrides.patientId ?? 'p-1',
    type: 'admission',
    bodyHebrew: 'בדיקת המשכיות',
    structuredData: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe('Read seam: mixed plaintext + encrypted patient rows', () => {
  it('listPatients returns all three patients decrypted', async () => {
    const plainA = makePatient({ id: 'a', name: 'plain-A', teudatZehut: '100000000' });
    const plainB = makePatient({ id: 'b', name: 'plain-B', teudatZehut: '200000000' });
    const encC = makePatient({ id: 'c', name: 'sealed-C', teudatZehut: '300000000' });
    await seedPatient(plainA, false);
    await seedPatient(plainB, false);
    await seedPatient(encC, true);

    const all = await listPatients();
    expect(all).toHaveLength(3);
    const byId = new Map(all.map((p) => [p.id, p]));
    expect(byId.get('a')?.name).toBe('plain-A');
    expect(byId.get('b')?.name).toBe('plain-B');
    expect(byId.get('c')?.name).toBe('sealed-C'); // decrypted via seam
    expect(byId.get('c')?.teudatZehut).toBe('300000000');
  });

  it('getPatient(id) returns decrypted row for an encrypted patient', async () => {
    const enc = makePatient({ id: 'c', name: 'sealed-Charlie', teudatZehut: '999999999' });
    await seedPatient(enc, true);

    const out = await getPatient('c');
    expect(out).not.toBeUndefined();
    expect(out?.name).toBe('sealed-Charlie');
    expect(out?.teudatZehut).toBe('999999999');
  });

  it('getPatientByTz returns the encrypted patient when matched by tz', async () => {
    const enc = makePatient({ id: 'c', name: 'sealed-by-tz', teudatZehut: '500000000' });
    await seedPatient(enc, true);

    const out = await getPatientByTz('500000000');
    expect(out).not.toBeNull();
    expect(out?.name).toBe('sealed-by-tz');
  });

  it('listPatientsByTzMap maps the encrypted patient under its plaintext tz key', async () => {
    const plainA = makePatient({ id: 'a', name: 'plain-A', teudatZehut: '100000000' });
    const encC = makePatient({ id: 'c', name: 'sealed-C', teudatZehut: '300000000' });
    await seedPatient(plainA, false);
    await seedPatient(encC, true);

    const map = await listPatientsByTzMap();
    expect(map.get('100000000')?.name).toBe('plain-A');
    expect(map.get('300000000')?.name).toBe('sealed-C');
  });
});

describe('Read seam: mixed plaintext + encrypted note rows', () => {
  it('listAllNotes returns all notes decrypted', async () => {
    const plainNote = makeNote({ id: 'n1', patientId: 'p-1', bodyHebrew: 'plain note' });
    const encNote = makeNote({ id: 'n2', patientId: 'p-1', bodyHebrew: 'sealed note' });
    await seedNote(plainNote, false);
    await seedNote(encNote, true);

    const all = await listAllNotes();
    expect(all).toHaveLength(2);
    const byId = new Map(all.map((n) => [n.id, n]));
    expect(byId.get('n1')?.bodyHebrew).toBe('plain note');
    expect(byId.get('n2')?.bodyHebrew).toBe('sealed note');
  });

  it('listNotes(patientId) uses by-patient index AND decrypts encrypted rows', async () => {
    // The encrypted Note row keeps patientId at the top level by design
    // (SealedNoteRow shape) so the by-patient index keeps resolving it.
    const plainNote = makeNote({ id: 'n1', patientId: 'p-x', bodyHebrew: 'plain' });
    const encNote = makeNote({ id: 'n2', patientId: 'p-x', bodyHebrew: 'sealed' });
    const otherPatientNote = makeNote({ id: 'n3', patientId: 'p-y', bodyHebrew: 'other' });
    await seedNote(plainNote, false);
    await seedNote(encNote, true);
    await seedNote(otherPatientNote, false);

    const out = await listNotes('p-x');
    expect(out).toHaveLength(2);
    const bodies = out.map((n) => n.bodyHebrew).sort();
    expect(bodies).toEqual(['plain', 'sealed']);
  });

  it('getNote(id) decrypts an encrypted note', async () => {
    const enc = makeNote({ id: 'n-enc', bodyHebrew: 'sealed body' });
    await seedNote(enc, true);

    const out = await getNote('n-enc');
    expect(out?.bodyHebrew).toBe('sealed body');
  });

  it('listNotesByTeudatZehut routes through the seam (no direct getAll bypass)', async () => {
    // The PR #166 review's load-bearing find: the pre-B2.1 implementation
    // bypassed listPatients() with a direct db.getAll. B2.1 refactored
    // to route through listPatients() and listNotes() — both of which
    // cross the seam — so even when both stores contain encrypted rows,
    // this function returns decrypted plaintext to callers.
    const patient = makePatient({ id: 'p-sealed', teudatZehut: '777777777', name: 'sealed-tz-patient' });
    const note = makeNote({ id: 'n-sealed', patientId: 'p-sealed', bodyHebrew: 'sealed-tz-body' });
    await seedPatient(patient, true);
    await seedNote(note, true);

    const out = await listNotesByTeudatZehut('777777777');
    expect(out.patient?.name).toBe('sealed-tz-patient');
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]?.bodyHebrew).toBe('sealed-tz-body');
  });
});

describe('Decrypt-failure resilience', () => {
  it('listPatients with a row that fails decrypt filters it out (does not crash)', async () => {
    // Seed one plaintext (should survive) + one bad-shape "encrypted"
    // row whose ciphertext is gibberish (decrypt fails → null → filtered).
    const plain = makePatient({ id: 'plain', name: 'survives' });
    await seedPatient(plain, false);

    const { getDb } = await import('@/storage/indexed');
    const db = await getDb();
    const badRow: SealedPatientRow = {
      id: 'bad',
      enc: {
        iv: new Uint8Array(12).fill(1) as Uint8Array<ArrayBuffer>,
        // Random non-AES-GCM ciphertext — auth-tag check will fail
        ciphertext: new Uint8Array(64).fill(99) as Uint8Array<ArrayBuffer>,
      },
    };
    await db.put('patients', badRow as unknown as Patient);

    const out = await listPatients();
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('plain');
  });
});
