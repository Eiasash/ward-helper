import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient,
  putNote,
  listPatients,
  listNotes,
  getSettings,
  setSettings,
  resetDbForTests,
} from '@/storage/indexed';

beforeEach(async () => {
  await resetDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('ward-helper');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('indexeddb schema', () => {
  it('stores and retrieves a patient', async () => {
    await putPatient({
      id: 'p1',
      name: 'דוד כהן',
      teudatZehut: '012345678',
      dob: '1944-03-01',
      room: '3-12',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const list = await listPatients();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('דוד כהן');
  });

  it('stores and retrieves a note keyed by patientId', async () => {
    await putNote({
      id: 'n1',
      patientId: 'p1',
      type: 'admission',
      bodyHebrew: 'קבלה...',
      structuredData: {},
      createdAt: 1,
      updatedAt: 1,
    });
    const notes = await listNotes('p1');
    expect(notes).toHaveLength(1);
  });

  it('settings is a keyed singleton', async () => {
    await setSettings({
      apiKeyXor: new Uint8Array([1, 2]),
      deviceSecret: new Uint8Array([3, 4]),
      lastPassphraseAuthAt: null,
      prefs: {},
    });
    const s = await getSettings();
    expect(s?.apiKeyXor[0]).toBe(1);
  });
});
