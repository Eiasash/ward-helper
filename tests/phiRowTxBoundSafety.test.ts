/**
 * PR-B2.1 safety-rail test for tx-bound sites.
 *
 * The B2.1 design wires `isEncryptedRow` inline at every read-then-
 * write-in-tx site (markNoteSent, ageOutRoster, archiveDay, the 5
 * rounds.ts point sites, and the backfill cursor). Under B2.1's
 * expected world (flag-off, no encrypted rows present) every sniff
 * returns false and the plaintext fast path runs. Under premature
 * flag-on — encrypted rows in storage before B2.2's staged-write
 * pattern lands — each site throws a clear error rather than silently
 * corrupting the row by writing a plaintext-shaped mutation back
 * over an encrypted envelope.
 *
 * This file pins the throw contract per site. The errors are
 * unreachable in B2.1 production but they're the safety rail that
 * prevents silent data corruption if the flag is enabled prematurely.
 *
 * Note: archiveDay's full test suite lives in tests/archiveDay.test.ts.
 * Here we only add the encrypted-row throw assertion to avoid bloating
 * that file with PR-B2.1-specific concerns.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetDbForTests,
  markNoteSent,
  getDb,
  type Patient,
  type Note,
} from '@/storage/indexed';
import { ageOutRoster, type RosterPatient } from '@/storage/roster';
import {
  archiveDay,
  dischargePatient,
  unDischargePatient,
  addTomorrowNote,
  dismissTomorrowNote,
  promoteToHandover,
  runV1_40_0_BackfillIfNeeded,
} from '@/storage/rounds';
import {
  derivePhiKey,
  setPhiKey,
  clearPhiKey,
  sealRow,
} from '@/crypto/phi';
import type {
  SealedPatientRow,
  SealedNoteRow,
  SealedRosterRow,
} from '@/crypto/phiRow';

const TEST_ITERATIONS = 4;

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
}

async function seedEncryptedPatient(p: Patient): Promise<void> {
  const db = await getDb();
  const enc = await sealRow(p);
  const row: SealedPatientRow = { id: p.id, enc };
  await db.put('patients', row as unknown as Patient);
}

async function seedEncryptedNote(n: Note): Promise<void> {
  const db = await getDb();
  const enc = await sealRow(n);
  const row: SealedNoteRow = { id: n.id, patientId: n.patientId, enc };
  await db.put('notes', row as unknown as Note);
}

async function seedEncryptedRoster(r: RosterPatient): Promise<void> {
  const db = await getDb();
  const enc = await sealRow(r);
  const row: SealedRosterRow = { id: r.id, enc };
  await db.put('roster', row as unknown as RosterPatient);
}

const samplePatient = (id = 'p-1'): Patient => ({
  id,
  name: 'בדיקה',
  teudatZehut: '111111111',
  dob: '1950-01-01',
  room: null,
  tags: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  tomorrowNotes: ['line-a', 'line-b'],
});

const sampleNote = (id = 'n-1'): Note => ({
  id,
  patientId: 'p-1',
  type: 'admission',
  bodyHebrew: 'note body',
  structuredData: {},
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
});

const sampleRoster = (id = 'r-1'): RosterPatient => ({
  id,
  tz: '222222222',
  name: 'roster patient',
  age: 80,
  sex: 'F',
  room: '12',
  bed: 'A',
  losDays: 3,
  dxShort: 'CHF',
  sourceMode: 'manual',
  importedAt: Date.now(),
});

beforeEach(async () => {
  clearPhiKey();
  await resetDbForTests();
  setPhiKey(await derivePhiKey('test', randomSalt(), TEST_ITERATIONS));
  // Clear backfill marker so runV1_40_0_BackfillIfNeeded actually runs.
  try { localStorage.removeItem('ward-helper.v1_40_0_backfilled'); } catch { /* ignore */ }
});

afterEach(() => {
  clearPhiKey();
});

describe('PR-B2.1 safety rail: tx-bound sites throw on encrypted', () => {
  it('markNoteSent throws when the note row is encrypted', async () => {
    await seedEncryptedNote(sampleNote());
    await expect(markNoteSent('n-1')).rejects.toThrow(/encrypted note row/);
  });

  it('dischargePatient throws when the patient row is encrypted', async () => {
    await seedEncryptedPatient(samplePatient());
    await expect(dischargePatient('p-1')).rejects.toThrow(/encrypted patient row/);
  });

  it('unDischargePatient throws when the patient row is encrypted', async () => {
    await seedEncryptedPatient(samplePatient());
    await expect(unDischargePatient('p-1', 5, 'reason')).rejects.toThrow(/encrypted patient row/);
  });

  it('addTomorrowNote throws when the patient row is encrypted', async () => {
    await seedEncryptedPatient(samplePatient());
    await expect(addTomorrowNote('p-1', 'new line')).rejects.toThrow(/encrypted patient row/);
  });

  it('dismissTomorrowNote throws when the patient row is encrypted', async () => {
    await seedEncryptedPatient(samplePatient());
    await expect(dismissTomorrowNote('p-1', 0)).rejects.toThrow(/encrypted patient row/);
  });

  it('promoteToHandover throws when the patient row is encrypted', async () => {
    await seedEncryptedPatient(samplePatient());
    await expect(promoteToHandover('p-1', 0)).rejects.toThrow(/encrypted patient row/);
  });

  it('archiveDay throws when any patient row is encrypted', async () => {
    await seedEncryptedPatient(samplePatient());
    await expect(archiveDay()).rejects.toThrow(/encrypted patient row/);
  });

  it('ageOutRoster throws when any roster row is encrypted', async () => {
    await seedEncryptedRoster(sampleRoster());
    await expect(ageOutRoster()).rejects.toThrow(/encrypted roster row/);
  });

  it('runV1_40_0_BackfillIfNeeded swallows + logs the encrypted-row error (does not corrupt storage)', async () => {
    // The function wraps the throw in try/catch and only sets the
    // BACKFILL_KEY localStorage marker on success — encrypted-row
    // throw leaves the marker unset so the next boot retries (and
    // post-B2.2 the staged-pattern + re-seal handles it correctly).
    await seedEncryptedPatient(samplePatient());
    // No rejection — the function's catch swallows.
    await expect(runV1_40_0_BackfillIfNeeded()).resolves.toBeUndefined();
    // BACKFILL_KEY remains unset, so the retry happens next boot.
    expect(localStorage.getItem('ward-helper.v1_40_0_backfilled')).toBeNull();
  });
});
