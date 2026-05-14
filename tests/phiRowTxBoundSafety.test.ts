/**
 * PR-B2.2 — staged-pattern round-trip tests for the 9 tx-bound sites the
 * B2.1 safety-rail pinned as "throw on encrypted." Each test seeds an
 * encrypted row, runs the operation, and asserts:
 *   - the operation succeeds (no throw)
 *   - the read+decrypt+mutate path produced the expected mutation
 *   - under flag-on, the writeback is a sealed envelope (round-trippable
 *     through decryptRowIfEncrypted)
 *
 * The file name is historical (was the B2.1 safety-rail); the contract
 * has inverted, but the same 9 sites are still the load-bearing surface.
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
import {
  decryptRowIfEncrypted,
  isEncryptedRow,
  type SealedPatientRow,
  type SealedNoteRow,
  type SealedRosterRow,
} from '@/crypto/phiRow';

const TEST_ITERATIONS = 4;
const FLAG_KEY = 'phi_encrypt_v7';

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
  planToday: 'check labs',
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

const sampleRoster = (id = 'r-1', importedAt = Date.now()): RosterPatient => ({
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
  importedAt,
});

beforeEach(async () => {
  clearPhiKey();
  await resetDbForTests();
  setPhiKey(await derivePhiKey('test', randomSalt(), TEST_ITERATIONS));
  // Default tests run with flag-on so writes also reseal.
  localStorage.setItem(FLAG_KEY, '1');
  try { localStorage.removeItem('ward-helper.v1_40_0_backfilled'); } catch { /* ignore */ }
});

afterEach(() => {
  clearPhiKey();
  try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
});

async function readPatientThroughSeam(id: string): Promise<Patient> {
  const db = await getDb();
  const raw = (await db.get('patients', id)) as Patient | SealedPatientRow | undefined;
  if (!raw) throw new Error(`expected patient ${id} on disk`);
  const result = await decryptRowIfEncrypted<Patient>(raw, 'patient');
  if (!result) throw new Error(`expected patient ${id} decryptable`);
  return result;
}

async function readNoteThroughSeam(id: string): Promise<Note> {
  const db = await getDb();
  const raw = (await db.get('notes', id)) as Note | SealedNoteRow | undefined;
  if (!raw) throw new Error(`expected note ${id} on disk`);
  const result = await decryptRowIfEncrypted<Note>(raw, 'note');
  if (!result) throw new Error(`expected note ${id} decryptable`);
  return result;
}

describe('PR-B2.2 staged-pattern: tx-bound sites round-trip encrypted rows', () => {
  it('markNoteSent: encrypted note → decrypted → resealed with sentToEmrAt set', async () => {
    await seedEncryptedNote(sampleNote());
    await markNoteSent('n-1', 1700000099999);
    // After mutation, the row on disk is sealed (flag-on) but decrypts to
    // the mutated plaintext.
    const db = await getDb();
    const raw = (await db.get('notes', 'n-1')) as Note | SealedNoteRow | undefined;
    expect(raw).toBeDefined();
    expect(isEncryptedRow(raw)).toBe(true);
    const recovered = await readNoteThroughSeam('n-1');
    expect(recovered.sentToEmrAt).toBe(1700000099999);
    expect(recovered.updatedAt).toBe(1700000099999);
  });

  it('dischargePatient: encrypted patient → discharged flag set on reseal', async () => {
    await seedEncryptedPatient(samplePatient());
    await dischargePatient('p-1');
    const recovered = await readPatientThroughSeam('p-1');
    expect(recovered.discharged).toBe(true);
    expect(typeof recovered.dischargedAt).toBe('number');
  });

  it('unDischargePatient: appends Hebrew re-admit line to handoverNote on reseal', async () => {
    await seedEncryptedPatient(samplePatient());
    await unDischargePatient('p-1', 5, 'recurrent pneumonia');
    const recovered = await readPatientThroughSeam('p-1');
    expect(recovered.discharged).toBe(false);
    expect(recovered.dischargedAt).toBeUndefined();
    expect(recovered.handoverNote).toMatch(/חזר לאשפוז.*5 ימים.*recurrent pneumonia/);
  });

  it('addTomorrowNote: appends to tomorrowNotes on reseal', async () => {
    await seedEncryptedPatient(samplePatient());
    await addTomorrowNote('p-1', 'check K+');
    const recovered = await readPatientThroughSeam('p-1');
    expect(recovered.tomorrowNotes).toEqual(['line-a', 'line-b', 'check K+']);
  });

  it('dismissTomorrowNote: filters by index on reseal', async () => {
    await seedEncryptedPatient(samplePatient());
    await dismissTomorrowNote('p-1', 0);
    const recovered = await readPatientThroughSeam('p-1');
    expect(recovered.tomorrowNotes).toEqual(['line-b']);
  });

  it('promoteToHandover: moves line from tomorrowNotes into handoverNote on reseal', async () => {
    await seedEncryptedPatient(samplePatient());
    await promoteToHandover('p-1', 1); // promote 'line-b'
    const recovered = await readPatientThroughSeam('p-1');
    expect(recovered.tomorrowNotes).toEqual(['line-a']);
    expect(recovered.handoverNote).toBe('line-b');
  });

  it('promoteToHandover: out-of-bounds index throws even on encrypted row', async () => {
    await seedEncryptedPatient(samplePatient());
    await expect(promoteToHandover('p-1', 99)).rejects.toThrow(/tomorrowNotes\[99\] not found/);
  });

  it('archiveDay: snapshot stores DECRYPTED Patient[] (daySnapshots carve-out)', async () => {
    await seedEncryptedPatient(samplePatient());
    const snap = await archiveDay();
    expect(snap.patients).toHaveLength(1);
    // Snapshot is plaintext per the carve-out — name field accessible at
    // row top level (would be `undefined` on a sealed envelope).
    expect(snap.patients[0]!.name).toBe('בדיקה');
    expect(snap.patients[0]!.planToday).toBe('check labs'); // captured BEFORE clear
    // The live patient row is resealed with planToday cleared.
    const recovered = await readPatientThroughSeam('p-1');
    expect(recovered.planToday).toBe('');
  });

  it('ageOutRoster: deletes expired encrypted roster rows', async () => {
    const longAgo = Date.now() - 48 * 60 * 60 * 1000; // 48h ago, > 24h TTL
    const recent = Date.now() - 60 * 1000; // 1 min ago
    await seedEncryptedRoster(sampleRoster('r-old', longAgo));
    await seedEncryptedRoster(sampleRoster('r-new', recent));
    const dropped = await ageOutRoster();
    expect(dropped).toBe(1);
    // r-old gone; r-new still present + still sealed
    const db = await getDb();
    expect(await db.get('roster', 'r-old')).toBeUndefined();
    const raw = (await db.get('roster', 'r-new')) as RosterPatient | SealedRosterRow | undefined;
    expect(isEncryptedRow(raw)).toBe(true);
  });

  it('runV1_40_0_BackfillIfNeeded: decrypts + reseals + sets marker', async () => {
    // Seed without the new fields (pre-v1.40.0 shape) so the backfill has
    // mutations to apply.
    const legacy: Patient = {
      id: 'p-legacy',
      name: 'old',
      teudatZehut: '999',
      dob: '1930-01-01',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    await seedEncryptedPatient(legacy);
    await runV1_40_0_BackfillIfNeeded();
    expect(localStorage.getItem('ward-helper.v1_40_0_backfilled')).toBe('1');
    const recovered = await readPatientThroughSeam('p-legacy');
    expect(recovered.discharged).toBe(false);
    expect(recovered.tomorrowNotes).toEqual([]);
    expect(recovered.handoverNote).toBe('');
    expect(recovered.planLongTerm).toBe('');
    expect(recovered.planToday).toBe('');
    expect(recovered.clinicalMeta).toEqual({});
  });
});

describe('PR-B2.2 staged-pattern: flag-off plaintext path', () => {
  beforeEach(() => {
    try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
  });

  it('dischargePatient: plaintext row stays plaintext after mutation when flag off', async () => {
    const db = await getDb();
    await db.put('patients', samplePatient());
    await dischargePatient('p-1');
    const raw = (await db.get('patients', 'p-1')) as Patient | SealedPatientRow;
    expect(isEncryptedRow(raw)).toBe(false);
    expect((raw as Patient).discharged).toBe(true);
  });

  it('markNoteSent: plaintext row stays plaintext after mutation when flag off', async () => {
    const db = await getDb();
    await db.put('notes', sampleNote());
    await markNoteSent('n-1', 1700000099999);
    const raw = (await db.get('notes', 'n-1')) as Note | SealedNoteRow;
    expect(isEncryptedRow(raw)).toBe(false);
    expect((raw as Note).sentToEmrAt).toBe(1700000099999);
  });
});

describe('PR-B2.2 staged-pattern: decrypt-failure surface', () => {
  it('dischargePatient: decrypt failure throws explicit "decrypt failed" error', async () => {
    // Seed with one key, then rotate the in-memory key so decrypt fails.
    await seedEncryptedPatient(samplePatient());
    clearPhiKey();
    setPhiKey(await derivePhiKey('different-password', randomSalt(), TEST_ITERATIONS));
    await expect(dischargePatient('p-1')).rejects.toThrow(/decrypt failed/);
  });

  it('markNoteSent: decrypt failure throws explicit "decrypt failed" error', async () => {
    await seedEncryptedNote(sampleNote());
    clearPhiKey();
    setPhiKey(await derivePhiKey('different-password', randomSalt(), TEST_ITERATIONS));
    await expect(markNoteSent('n-1')).rejects.toThrow(/decrypt failed/);
  });
});
