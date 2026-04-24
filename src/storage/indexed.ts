import { openDB, type IDBPDatabase } from 'idb';

export type NoteType = 'admission' | 'discharge' | 'consult' | 'case' | 'soap';

export interface Patient {
  id: string;
  name: string;
  teudatZehut: string;
  dob: string;
  room: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  patientId: string;
  type: NoteType;
  bodyHebrew: string;
  structuredData: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  apiKeyXor: Uint8Array<ArrayBuffer>;
  deviceSecret: Uint8Array<ArrayBuffer>;
  lastPassphraseAuthAt: number | null;
  prefs: Record<string, unknown>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB('ward-helper', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('patients')) {
          db.createObjectStore('patients', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('notes')) {
          const notes = db.createObjectStore('notes', { keyPath: 'id' });
          notes.createIndex('by-patient', 'patientId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
}

export async function resetDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ignore */
    }
    dbPromise = null;
  }
}

export async function putPatient(p: Patient): Promise<void> {
  await (await getDb()).put('patients', p);
}

export async function listPatients(): Promise<Patient[]> {
  return (await getDb()).getAll('patients');
}

export async function putNote(n: Note): Promise<void> {
  await (await getDb()).put('notes', n);
}

export async function listNotes(patientId: string): Promise<Note[]> {
  const db = await getDb();
  return db.getAllFromIndex('notes', 'by-patient', patientId);
}

export async function getNote(id: string): Promise<Note | undefined> {
  return (await getDb()).get('notes', id);
}

export async function getPatient(id: string): Promise<Patient | undefined> {
  return (await getDb()).get('patients', id);
}

export async function deleteNote(id: string): Promise<void> {
  await (await getDb()).delete('notes', id);
}

export async function setSettings(s: Settings): Promise<void> {
  await (await getDb()).put('settings', s, 'singleton');
}

export async function getSettings(): Promise<Settings | undefined> {
  return (await getDb()).get('settings', 'singleton');
}

export async function listNotesByTeudatZehut(
  teudatZehut: string,
): Promise<{ patient: Patient | null; notes: Note[] }> {
  const tz = teudatZehut.trim();
  if (!tz) return { patient: null, notes: [] };
  const db = await getDb();
  const all = (await db.getAll('patients')) as Patient[];
  const matches = all.filter((p) => p.teudatZehut === tz);
  if (matches.length === 0) return { patient: null, notes: [] };
  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  const patient = matches[0]!;
  const notesByPatient = await Promise.all(
    matches.map((p) => db.getAllFromIndex('notes', 'by-patient', p.id)),
  );
  const notes = notesByPatient.flat() as Note[];
  return { patient, notes };
}
