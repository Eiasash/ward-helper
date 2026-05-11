/**
 * Encrypted-blob runtime smoke fixtures.
 *
 * The 4 user-data blob_types are parameterized in the smoke. Canary is a
 * SYSTEM PRECONDITION (restoreFromCloud fast-fails on bad canary at
 * src/notes/save.ts:367) — seeded by seedAll, NOT in the parameterized
 * assertion loop.
 *
 * Plaintext shapes are minimal-valid per src/storage/indexed.ts and
 * src/storage/rounds.ts. Implementations evolve; if the apply ladder in
 * src/notes/save.ts:398-443 starts rejecting any of these, the fixture
 * needs to grow the missing field — that's the smoke catching a
 * production schema change, which is its job.
 */

export type UserDataBlobType = 'patient' | 'note' | 'api-key' | 'day-snapshot';

export interface BlobSeed {
  blobId: string;
  plaintext: unknown;
  /** Where the post-restore plaintext lands. */
  persistenceLayer: 'idb' | 'localStorage';
  /**
   * IDB store name (when persistenceLayer === 'idb') OR localStorage key
   * (when persistenceLayer === 'localStorage'). For IDB stores, the
   * persistence check looks up the row by the fixture's blob_id.
   */
  persistenceKey: string;
}

/** Iteration order for the parameterized smoke. Stable so reports stay diffable. */
export const USER_DATA_BLOB_TYPES: UserDataBlobType[] = [
  'patient',
  'note',
  'api-key',
  'day-snapshot',
];

const SMOKE_API_KEY_FIXTURE = {
  v: 1 as const,
  apiKey: 'sk-ant-FAKE-FOR-SMOKE-DO-NOT-USE',
  savedAt: 1234567890,
};

const SMOKE_PATIENT_FIXTURE = {
  id: 'smoke-patient-001',
  name: 'Smoke Patient',
  teudatZehut: '000000000',
  dob: '1950-01-01',
  room: null,
  tags: ['smoke'],
  createdAt: 1234567890,
  updatedAt: 1234567890,
};

const SMOKE_NOTE_FIXTURE = {
  id: 'smoke-note-001',
  patientId: 'smoke-patient-001',
  type: 'admission' as const,
  bodyHebrew: 'בדיקת smoke — לא לקלינית',
  structuredData: {},
  createdAt: 1234567890,
  updatedAt: 1234567890,
};

const SMOKE_DAY_SNAPSHOT_FIXTURE = {
  id: '2026-05-11',
  date: '2026-05-11',
  archivedAt: 1234567890,
  patients: [SMOKE_PATIENT_FIXTURE],
};

export const BLOB_SEEDS: Record<UserDataBlobType, BlobSeed> = {
  patient: {
    blobId: SMOKE_PATIENT_FIXTURE.id,
    plaintext: SMOKE_PATIENT_FIXTURE,
    persistenceLayer: 'idb',
    persistenceKey: 'patients',
  },
  note: {
    blobId: SMOKE_NOTE_FIXTURE.id,
    plaintext: SMOKE_NOTE_FIXTURE,
    persistenceLayer: 'idb',
    persistenceKey: 'notes',
  },
  'api-key': {
    blobId: '__user_default__',
    plaintext: SMOKE_API_KEY_FIXTURE,
    persistenceLayer: 'localStorage',
    persistenceKey: 'wardhelper_apikey',
  },
  'day-snapshot': {
    blobId: SMOKE_DAY_SNAPSHOT_FIXTURE.id,
    plaintext: SMOKE_DAY_SNAPSHOT_FIXTURE,
    persistenceLayer: 'idb',
    persistenceKey: 'daySnapshots',
  },
};

/**
 * Canary precondition: NOT a fixture under test, but MUST be seeded
 * alongside the 4 user-data fixtures or restoreFromCloud fast-fails
 * with wrongPassphrase: true at src/notes/save.ts:367.
 *
 * Shape per src/storage/canary.ts:32-41 (CanaryPayload + CANARY_PLAINTEXT
 * spread). createdAt is timestamped at seed time, not fixture-baked.
 */
export const CANARY_PRECONDITION = {
  blobType: 'canary' as const,
  blobId: '__canary__',
  plaintext: {
    v: 1 as const,
    marker: 'ward-helper-canary' as const,
    createdAt: 0, // overwritten at seed time
  },
};
