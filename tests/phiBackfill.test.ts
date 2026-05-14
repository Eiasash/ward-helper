/**
 * PR-B2.2 — phiBackfill.ts tests.
 *
 * Covers:
 *   - Empty stores → sentinel set, flag flipped, report shows zeros.
 *   - All-plaintext rows across patients/notes/roster → every row sealed.
 *   - Mixed plaintext + sealed → only plaintext rows seal; sealed rows
 *     untouched (idempotent).
 *   - Already-complete (sentinel set) → noop, re-flips the per-tab flag.
 *   - No PHI key in memory → throws (defensive check).
 *   - Idempotency: running twice = second call returns sentinelSet: false.
 *
 * `iterations: 4` everywhere a key is derived (matches phiCrypto.test.ts).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetDbForTests,
  getDb,
  patchSettings,
  type Patient,
  type Note,
} from '@/storage/indexed';
import type { RosterPatient } from '@/storage/roster';
import {
  derivePhiKey,
  setPhiKey,
  clearPhiKey,
  sealRow,
} from '@/crypto/phi';
import {
  isEncryptedRow,
  isPhiEncryptV7Enabled,
  type SealedPatientRow,
  type SealedNoteRow,
  type SealedRosterRow,
} from '@/crypto/phiRow';
import {
  runPhiBackfillIfNeeded,
  isPhiBackfillComplete,
} from '@/storage/phiBackfill';

const TEST_ITERATIONS = 4;
const PASSWORD = 'correct horse battery staple';
const FLAG_KEY = 'phi_encrypt_v7';

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
}

async function putPlainPatient(p: Patient): Promise<void> {
  const db = await getDb();
  await db.put('patients', p);
}
async function putPlainNote(n: Note): Promise<void> {
  const db = await getDb();
  await db.put('notes', n);
}
async function putPlainRoster(r: RosterPatient): Promise<void> {
  const db = await getDb();
  await db.put('roster', r);
}
async function putSealedPatient(p: Patient): Promise<void> {
  const db = await getDb();
  const enc = await sealRow(p);
  const row: SealedPatientRow = { id: p.id, enc };
  await db.put('patients', row as unknown as Patient);
}

const samplePatient = (id = 'p-1'): Patient => ({
  id,
  name: 'מטופלת',
  teudatZehut: id + '0001',
  dob: '1945-05-01',
  room: 'A',
  tags: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
});
const sampleNote = (id = 'n-1', patientId = 'p-1'): Note => ({
  id,
  patientId,
  type: 'admission',
  bodyHebrew: 'note body',
  structuredData: {},
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
});
const sampleRoster = (id = 'r-1'): RosterPatient => ({
  id,
  tz: '999',
  name: 'roster pt',
  age: 80,
  sex: 'F',
  room: '7',
  bed: 'A',
  losDays: 1,
  dxShort: 'CHF',
  sourceMode: 'manual',
  importedAt: Date.now(),
});

beforeEach(async () => {
  clearPhiKey();
  await resetDbForTests();
  setPhiKey(await derivePhiKey(PASSWORD, randomSalt(), TEST_ITERATIONS));
  try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
});

afterEach(() => {
  clearPhiKey();
  try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
});

describe('runPhiBackfillIfNeeded', () => {
  it('empty stores: sentinel set, flag flipped, zero examined', async () => {
    const report = await runPhiBackfillIfNeeded();
    expect(report.sentinelSet).toBe(true);
    expect(report.examined).toBe(0);
    expect(report.sealed).toBe(0);
    expect(isPhiEncryptV7Enabled()).toBe(true);
    expect(await isPhiBackfillComplete()).toBe(true);
  });

  it('all-plaintext: every row in every store gets sealed', async () => {
    await putPlainPatient(samplePatient('p-1'));
    await putPlainPatient(samplePatient('p-2'));
    await putPlainNote(sampleNote('n-1', 'p-1'));
    await putPlainRoster(sampleRoster('r-1'));

    const report = await runPhiBackfillIfNeeded();
    expect(report.sentinelSet).toBe(true);
    expect(report.byStore.patients).toEqual({ examined: 2, sealed: 2 });
    expect(report.byStore.notes).toEqual({ examined: 1, sealed: 1 });
    expect(report.byStore.roster).toEqual({ examined: 1, sealed: 1 });

    // Verify on-disk shape is sealed.
    const db = await getDb();
    const p1 = (await db.get('patients', 'p-1')) as Patient | SealedPatientRow;
    expect(isEncryptedRow(p1)).toBe(true);
    const n1 = (await db.get('notes', 'n-1')) as Note | SealedNoteRow;
    expect(isEncryptedRow(n1)).toBe(true);
    // SealedNoteRow keeps patientId at top level — by-patient index survives.
    expect((n1 as SealedNoteRow).patientId).toBe('p-1');
    const r1 = (await db.get('roster', 'r-1')) as RosterPatient | SealedRosterRow;
    expect(isEncryptedRow(r1)).toBe(true);
  });

  it('mixed plaintext + sealed: only plaintext gets sealed; sealed rows untouched', async () => {
    await putPlainPatient(samplePatient('p-plain'));
    await putSealedPatient(samplePatient('p-sealed'));

    const report = await runPhiBackfillIfNeeded();
    expect(report.byStore.patients).toEqual({ examined: 2, sealed: 1 });

    const db = await getDb();
    expect(isEncryptedRow(await db.get('patients', 'p-plain'))).toBe(true);
    expect(isEncryptedRow(await db.get('patients', 'p-sealed'))).toBe(true);
  });

  it('already-complete: skips, re-flips per-tab flag if missing', async () => {
    // Pretend a prior run set the sentinel.
    await patchSettings({ phiEncryptedV7: true });
    // Per-tab flag wiped (private window / profile reset simulation).
    try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
    expect(isPhiEncryptV7Enabled()).toBe(false);

    await putPlainPatient(samplePatient('p-unsealed'));
    const report = await runPhiBackfillIfNeeded();
    expect(report.sentinelSet).toBe(false); // no new sentinel write
    expect(report.examined).toBe(0); // didn't touch the rows
    expect(report.sealed).toBe(0);
    // Per-tab flag re-flipped even though the runner skipped.
    expect(isPhiEncryptV7Enabled()).toBe(true);
    // The unsealed row stays unsealed (the backfill skipped on the
    // already-complete sentinel; if this surfaces in real use it would
    // be a regression, not a B2.2 expectation).
    const db = await getDb();
    expect(isEncryptedRow(await db.get('patients', 'p-unsealed'))).toBe(false);
  });

  it('no PHI key: throws (defensive check)', async () => {
    clearPhiKey();
    await expect(runPhiBackfillIfNeeded()).rejects.toThrow(/no PHI key set/);
    // Sentinel NOT set on failure.
    expect(await isPhiBackfillComplete()).toBe(false);
  });

  it('idempotent: second call is a noop', async () => {
    await putPlainPatient(samplePatient('p-1'));
    const first = await runPhiBackfillIfNeeded();
    expect(first.sentinelSet).toBe(true);
    expect(first.sealed).toBe(1);

    const second = await runPhiBackfillIfNeeded();
    expect(second.sentinelSet).toBe(false);
    expect(second.examined).toBe(0);
    expect(second.sealed).toBe(0);
  });
});

describe('isPhiBackfillComplete', () => {
  it('false on fresh install', async () => {
    expect(await isPhiBackfillComplete()).toBe(false);
  });

  it('true after a successful runPhiBackfillIfNeeded', async () => {
    await runPhiBackfillIfNeeded();
    expect(await isPhiBackfillComplete()).toBe(true);
  });
});
