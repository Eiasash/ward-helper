import { openDB, type IDBPDatabase } from 'idb';

import type { SafetyFlags } from '@/safety/types';

export type NoteType = 'admission' | 'discharge' | 'consult' | 'case' | 'soap' | 'census';

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
  /**
   * Timestamp (ms) when the user copied this note to the Chameleon clipboard.
   * Optional + nullable: old rows written under schema v2 have the field
   * absent → reads back as undefined, which the UI treats as "not sent".
   * A one-time backfill to `null` would be a needless IDB rewrite on every
   * existing note.
   */
  sentToEmrAt?: number | null;
  /**
   * Drug-safety hits computed at extract time and frozen with the note.
   * Optional + non-indexed: old rows have it absent, new rows carry the
   * snapshot the doctor saw when generating the note. We snapshot rather
   * than recompute on read because the rule set itself versions; a rerun
   * months later under new rules would silently change the displayed
   * hits without the doctor having re-reviewed.
   */
  safetyFlags?: SafetyFlags;
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
// Current schema (v4):
//   patients [keyPath: id]
//   notes    [keyPath: id, index: by-patient (patientId), by-tz (teudatZehut)]
//   settings [no keyPath, uses string keys ('singleton')]
//
// The by-tz index was added in v2 to make listNotesByTeudatZehut O(1)
// instead of O(N_patients) on every SOAP continuity resolve.
//
// v3 introduces Note.sentToEmrAt (optional, non-indexed). The object store
// doesn't change — IDB stores free-form objects, so a new optional field
// needs no schema work. We still bump DB_VERSION: it documents that the
// Note shape changed, future indexes on sentToEmrAt branch off v3, and
// any data-migration for old notes would land in the v3 upgrade block.
//
// v4 adds Note.safetyFlags (optional SafetyFlags from src/safety). Same
// shape contract as sentToEmrAt — no migration, no index, just a
// version bump so future safety-flag queries have a place to land.
const DB_VERSION = 4;

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
        if (oldVersion < 3) {
          // Schema unchanged — Note.sentToEmrAt is an optional non-indexed
          // field. Block kept intentionally so future v3 data migrations
          // (backfills, index adds on sentToEmrAt) have a landing spot.
        }
        if (oldVersion < 4) {
          // Schema unchanged — Note.safetyFlags is an optional non-indexed
          // field. Block kept intentionally so future v4 data migrations
          // (backfills, rule-version stamping) have a landing spot.
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
      /* connection already closed — fine */
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('ward-helper');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    // onblocked: fake-indexeddb can fire this spuriously. Rejecting would
    // deadlock the suite; in a real browser a blocked delete indicates a
    // leaked connection and would warrant escalation.
    req.onblocked = () => resolve();
  });
}

export async function putPatient(p: Patient): Promise<void> {
  await (await getDb()).put('patients', p);
}

/**
 * Resolve a patient by teudatZehut and persist the row.
 *
 * Looks up the by-tz index first: if a patient with this ת.ז. already
 * exists, the new fields are MERGED onto the existing row (preserving
 * id + createdAt), so a second admission for the same person doesn't
 * fork into a duplicate. Without tz to key on, a fresh id is minted —
 * there's nothing to dedupe against.
 *
 * Merge semantics on a match: a new value wins only when it's actually
 * present (non-empty string / non-null / non-empty array). A blank
 * field on a follow-up save (sparse extract — OCR couldn't read the
 * patient card this time) preserves whatever was on the existing row.
 * Tags are unioned so accumulated isolation/ventilation flags from the
 * census parser survive a subsequent note-save with empty tags.
 *
 * Stored teudatZehut is always the trimmed form. Without normalization
 * on write, "  123456789  " gets indexed as the trimmed value but
 * stored with whitespace; subsequent lookups (which trim first) miss
 * the row and re-mint a duplicate id — splitting the patient across
 * two rows with the same effective ID.
 *
 * Returns the row that was actually written so callers (saveBoth) can
 * encrypt the same shape they persisted locally — without a second IDB
 * read to reconstruct it.
 */
export async function upsertPatientByTz(p: Omit<Patient, 'id'>): Promise<Patient> {
  const tz = p.teudatZehut.trim();
  if (!tz) {
    const row: Patient = { ...p, id: crypto.randomUUID(), teudatZehut: tz };
    await putPatient(row);
    return row;
  }
  const db = await getDb();
  const matches = (await db.getAllFromIndex('patients', 'by-tz', tz)) as Patient[];
  if (matches.length > 0) {
    matches.sort((a, b) => b.updatedAt - a.updatedAt);
    const existing = matches[0]!;
    const row: Patient = {
      id: existing.id,
      name: p.name || existing.name,
      teudatZehut: tz,
      dob: p.dob || existing.dob,
      room: p.room || existing.room,
      tags: Array.from(new Set([...existing.tags, ...p.tags])),
      createdAt: existing.createdAt,
      updatedAt: p.updatedAt,
    };
    await putPatient(row);
    return row;
  }
  const row: Patient = { ...p, id: crypto.randomUUID(), teudatZehut: tz };
  await putPatient(row);
  return row;
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

/**
 * One-shot fetch of every note in the DB. Used by History to group into a
 * patient→notes map for render + search without N per-patient round-trips.
 * The dataset is bounded (hundreds of notes max in real use) — a single
 * getAll is strictly cheaper than N index scans.
 */
export async function listAllNotes(): Promise<Note[]> {
  return (await getDb()).getAll('notes');
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

/**
 * Mark a note as copied to the Chameleon clipboard. Bumps both sentToEmrAt
 * and updatedAt — the copy is an interaction with the note and History
 * sorts by updatedAt, so just-sent notes float to the top naturally.
 * Missing-note is a silent no-op (the user may have deleted the note
 * mid-copy on another tab).
 */
export async function markNoteSent(id: string, ts: number = Date.now()): Promise<void> {
  const db = await getDb();
  const note = (await db.get('notes', id)) as Note | undefined;
  if (!note) return;
  await db.put('notes', { ...note, sentToEmrAt: ts, updatedAt: ts });
  // Header-strip pending-sync subscribes — drop the count by 1 immediately.
  // Dynamic import keeps the storage module free of UI-layer imports
  // (test-friendly, prevents accidental cycles with src/ui).
  try {
    const { notifyNotesChanged } = await import('@/ui/hooks/useGlanceable');
    notifyNotesChanged();
  } catch {
    /* SSR / module unavailable — non-fatal */
  }
}

export async function setSettings(s: Settings): Promise<void> {
  await (await getDb()).put('settings', s, 'singleton');
}

export async function getSettings(): Promise<Settings | undefined> {
  return (await getDb()).get('settings', 'singleton');
}

export interface DbStats {
  patients: number;
  notes: number;
  estimatedBytes: number;
  oldestNoteAt: number | null;
  newestNoteAt: number | null;
}

/**
 * Lightweight stats for the debug panel. No per-record decryption — bytes
 * are a rough estimate (`patients*256 + Σ note.body.length*2 + 256`) so the
 * user can eyeball whether local storage is bloating up.
 */
export async function getDbStats(): Promise<DbStats> {
  const db = await getDb();
  const patients = await db.count('patients');
  const notes = (await db.getAll('notes')) as Note[];
  let estimatedBytes = patients * 256;
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const n of notes) {
    estimatedBytes += (n.bodyHebrew?.length ?? 0) * 2 + 256;
    const t = n.updatedAt ?? n.createdAt ?? 0;
    if (t) {
      if (oldest === null || t < oldest) oldest = t;
      if (newest === null || t > newest) newest = t;
    }
  }
  return {
    patients,
    notes: notes.length,
    estimatedBytes,
    oldestNoteAt: oldest,
    newestNoteAt: newest,
  };
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
