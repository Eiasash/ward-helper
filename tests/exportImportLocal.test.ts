import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDbForTests,
  putPatient,
  putNote,
  listPatients,
  listAllNotes,
} from '@/storage/indexed';
import { exportLocalBackup } from '@/notes/exportLocal';
import { importLocalBackup } from '@/notes/importLocal';

beforeEach(async () => {
  await resetDbForTests();
});

async function seed() {
  await putPatient({
    id: 'p1', name: 'A', teudatZehut: '1', dob: '1950-01-01', room: null,
    tags: [], createdAt: 1, updatedAt: 1,
  });
  await putNote({
    id: 'n1', patientId: 'p1', type: 'admission', bodyHebrew: 'גוף',
    structuredData: { foo: 'bar' }, createdAt: 1, updatedAt: 1,
  });
}

describe('exportLocalBackup / importLocalBackup', () => {
  it('plaintext round-trip', async () => {
    await seed();
    const blob = await exportLocalBackup({ encryptWithLoginPassword: false });
    await resetDbForTests();
    const text = await blob.text();
    const file = new File([text], 'b.json', { type: 'application/json' });
    const out = await importLocalBackup(file, {});
    expect(out.imported.patients).toBe(1);
    expect(out.imported.notes).toBe(1);
    expect((await listPatients())[0]?.name).toBe('A');
    expect((await listAllNotes())[0]?.bodyHebrew).toBe('גוף');
  });

  it('encrypted round-trip', async () => {
    await seed();
    const blob = await exportLocalBackup({
      encryptWithLoginPassword: true,
      loginPassword: 'pwd',
    });
    await resetDbForTests();
    const text = await blob.text();
    const file = new File([text], 'b.json', { type: 'application/json' });
    const out = await importLocalBackup(file, { loginPassword: 'pwd' });
    expect(out.imported.patients).toBe(1);
    expect(out.imported.notes).toBe(1);
  });

  it('encrypted import with wrong password fails cleanly', async () => {
    await seed();
    const blob = await exportLocalBackup({
      encryptWithLoginPassword: true,
      loginPassword: 'pwd',
    });
    await resetDbForTests();
    const text = await blob.text();
    const file = new File([text], 'b.json', { type: 'application/json' });
    await expect(
      importLocalBackup(file, { loginPassword: 'WRONG' }),
    ).rejects.toThrow(/decrypt/i);
  });
});
