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

// --- Schema migrations -----------------------------------------------------
// Bump DB_VERSION when adding stores or indexes. The `upgrade` callback gets
// the `oldVersion` param so you can run incremental migrations (e.g. add a
// by-teudatZehut index in v2, add a costsPerNote store in v3, etc).
//
// IMPORTANT: `upgrade` runs blocking. Keep it cheap — no async work, no large
// loops. If you need to migrate data, use a cursor and batch; don't
// getAll()/putAll() in one go on a user who has 500 notes.
//
// Current schema (v2):
//   patients [keyPath: id]
//   notes    [keyPath: id, index: by-patient (patientId), by-tz (teudatZehut)]
//   settings [no keyPath, uses string keys ('singleton')]
//
// The by-tz index was added in v2 to make listNotesByTeudatZehut O(1)
// instead of O(N_patients) on every SOAP continuity resolve.
const DB_VERSION = 2;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB('ward-helper', DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // v1: initial schema
        if (oldVersion < 1) {
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
        }
        // v2: add by-teudatZehut index on patients using the EXISTING
        // versionchange transaction. Opening a new tx inside upgrade()
        // aborts the migration — fake-indexeddb surfaces this as an
        // AbortError (real browsers silently succeed in some cases but
        // the fake IDB is correct).
        if (oldVersion < 2) {
          const patients = tx.objectStore('patients');
          if (!patients.indexNames.contains('by-tz')) {
            patients.createIndex('by-tz', 'teudatZehut', { unique: false });
          }
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
  // Index lookup instead of getAll + filter. Before this change, resolving
  // SOAP continuity was O(N_patients) on every Review mount — a phone with
  // 200 patients took 30+ms for a hot cache lookup. Now it's one B-tree hit.
  const matches = (await db.getAllFromIndex('patients', 'by-tz', tz)) as Patient[];
  if (matches.length === 0) return { patient: null, notes: [] };
  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  const patient = matches[0]!;
  const notesByPatient = await Promise.all(
    matches.map((p) => db.getAllFromIndex('notes', 'by-patient', p.id)),
  );
  const notes = notesByPatient.flat() as Note[];
  return { patient, notes };
}
