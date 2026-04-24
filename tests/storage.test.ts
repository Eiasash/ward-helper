import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient,
  putNote,
  listPatients,
  listNotes,
  listNotesByTeudatZehut,
  getNote,
  getPatient,
  deleteNote,
  getSettings,
  setSettings,
  markNoteSent,
  resetDbForTests,
  type Patient,
} from '@/storage/indexed';
import { encryptForCloud, decryptFromCloud } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';

beforeEach(async () => {
  await resetDbForTests();
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

describe('cloud encryption boundary', () => {
  it('encryptForCloud produces opaque bytes', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const record = { id: 'p1', name: 'דוד כהן', teudatZehut: '012345678' };
    const sealed = await encryptForCloud(record, key, salt);
    const asString = new TextDecoder('utf-8', { fatal: false }).decode(sealed.ciphertext);
    expect(asString).not.toContain('דוד');
    expect(asString).not.toContain('012345678');
  });

  it('round-trips through encryptForCloud -> decryptFromCloud', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const record = { id: 'n1', bodyHebrew: 'קבלה של מטופל' };
    const sealed = await encryptForCloud(record, key, salt);
    const back = await decryptFromCloud<typeof record>(sealed.ciphertext, sealed.iv, key);
    expect(back).toEqual(record);
  });
});

describe('listNotesByTeudatZehut', () => {
  it('returns notes for patients matching the given teudat zehut', async () => {
    const tz = '098765432';
    const pA: Patient = { id: 'pA', name: 'A', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 2 };
    const pB: Patient = { id: 'pB', name: 'B', teudatZehut: '111111111', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    await putPatient(pA);
    await putPatient(pB);
    await putNote({ id: 'n1', patientId: 'pA', type: 'admission', bodyHebrew: 'קבלה', structuredData: {}, createdAt: 10, updatedAt: 10 });
    await putNote({ id: 'n2', patientId: 'pA', type: 'soap', bodyHebrew: 'SOAP', structuredData: {}, createdAt: 20, updatedAt: 20 });
    await putNote({ id: 'n3', patientId: 'pB', type: 'soap', bodyHebrew: 'ignore', structuredData: {}, createdAt: 30, updatedAt: 30 });

    const out = await listNotesByTeudatZehut(tz);
    expect(out.notes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(out.patient?.id).toBe('pA');
  });

  it('trims whitespace on the teudat zehut input', async () => {
    const tz = '012345678';
    await putPatient({ id: 'p1', name: 'X', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 });
    const out = await listNotesByTeudatZehut('  ' + tz + '  ');
    expect(out.patient?.id).toBe('p1');
  });

  it('returns null patient + empty notes on no match', async () => {
    const out = await listNotesByTeudatZehut('000000000');
    expect(out.patient).toBeNull();
    expect(out.notes).toEqual([]);
  });

  it('on duplicate teudat zehut picks the most recently updated patient', async () => {
    const tz = '222222222';
    await putPatient({ id: 'old', name: 'X', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 10 });
    await putPatient({ id: 'new', name: 'Y', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 50 });
    const out = await listNotesByTeudatZehut(tz);
    expect(out.patient?.id).toBe('new');
  });
});

describe('Note.sentToEmrAt — schema v3', () => {
  it('existing notes without sentToEmrAt deserialize cleanly (undefined, no crash)', async () => {
    // Seed at v2 with a raw Note object that omits sentToEmrAt — simulates
    // what's in every installed PWA's IDB before this upgrade lands.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('ward-helper', 2);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        const oldV = (e as IDBVersionChangeEvent).oldVersion;
        if (oldV < 1) {
          db.createObjectStore('patients', { keyPath: 'id' });
          const notes = db.createObjectStore('notes', { keyPath: 'id' });
          notes.createIndex('by-patient', 'patientId');
          db.createObjectStore('settings');
        }
        if (oldV < 2) {
          const tx = req.transaction!;
          const patients = tx.objectStore('patients');
          if (!patients.indexNames.contains('by-tz')) {
            patients.createIndex('by-tz', 'teudatZehut', { unique: false });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').put({
          id: 'legacy-1',
          patientId: 'p1',
          type: 'admission',
          bodyHebrew: 'קבלה ישנה',
          structuredData: {},
          createdAt: 1,
          updatedAt: 1,
          // no sentToEmrAt — this is the whole point of the test
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Read via the app code path — opens at v3, runs upgrade.
    const n = await getNote('legacy-1');
    expect(n).toBeDefined();
    expect(n!.bodyHebrew).toBe('קבלה ישנה');
    expect(n!.sentToEmrAt).toBeUndefined();
  });

  it('markNoteSent sets sentToEmrAt and bumps updatedAt', async () => {
    await putNote({
      id: 'n-mark',
      patientId: 'p-mark',
      type: 'soap',
      bodyHebrew: 'body',
      structuredData: {},
      createdAt: 100,
      updatedAt: 100,
      sentToEmrAt: null,
    });
    await markNoteSent('n-mark', 12345);
    const n = await getNote('n-mark');
    expect(n?.sentToEmrAt).toBe(12345);
    expect(n?.updatedAt).toBe(12345);
  });

  it('markNoteSent on a missing note is a silent no-op', async () => {
    await expect(markNoteSent('does-not-exist')).resolves.toBeUndefined();
    expect(await listNotes('whatever')).toEqual([]);
  });
});

describe('note viewer helpers — getNote / getPatient / deleteNote', () => {
  it('getNote returns the saved note by id', async () => {
    await putPatient({
      id: 'pv1',
      name: 'כהן אשר',
      teudatZehut: '003385747',
      dob: '',
      room: '87',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await putNote({
      id: 'n-abc',
      patientId: 'pv1',
      type: 'soap',
      bodyHebrew: 'S: תלונה\nO: ...\nA: ...\nP: ...',
      structuredData: {},
      createdAt: 100,
      updatedAt: 100,
    });
    const n = await getNote('n-abc');
    expect(n?.bodyHebrew).toContain('תלונה');
    expect(n?.patientId).toBe('pv1');
  });

  it('getNote returns undefined for unknown id', async () => {
    expect(await getNote('nonexistent')).toBeUndefined();
  });

  it('getPatient returns patient by id', async () => {
    await putPatient({
      id: 'pv2',
      name: 'X',
      teudatZehut: '1',
      dob: '',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const p = await getPatient('pv2');
    expect(p?.name).toBe('X');
  });

  it('deleteNote removes the note but keeps the patient', async () => {
    await putPatient({
      id: 'pv3',
      name: 'X',
      teudatZehut: '1',
      dob: '',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await putNote({
      id: 'del-me',
      patientId: 'pv3',
      type: 'admission',
      bodyHebrew: 'body',
      structuredData: {},
      createdAt: 1,
      updatedAt: 1,
    });
    expect((await listNotes('pv3')).length).toBe(1);
    await deleteNote('del-me');
    expect(await getNote('del-me')).toBeUndefined();
    expect((await listNotes('pv3')).length).toBe(0);
    expect(await getPatient('pv3')).toBeDefined();
  });
});
