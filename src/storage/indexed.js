import { openDB } from 'idb';
let dbPromise = null;
export function getDb() {
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
export async function resetDbForTests() {
    if (dbPromise) {
        try {
            (await dbPromise).close();
        }
        catch {
            /* ignore */
        }
        dbPromise = null;
    }
}
export async function putPatient(p) {
    await (await getDb()).put('patients', p);
}
export async function listPatients() {
    return (await getDb()).getAll('patients');
}
export async function putNote(n) {
    await (await getDb()).put('notes', n);
}
export async function listNotes(patientId) {
    const db = await getDb();
    return db.getAllFromIndex('notes', 'by-patient', patientId);
}
export async function setSettings(s) {
    await (await getDb()).put('settings', s, 'singleton');
}
export async function getSettings() {
    return (await getDb()).get('settings', 'singleton');
}
