import { describe, it, expect } from 'vitest';
import { BLOB_SEEDS, USER_DATA_BLOB_TYPES, CANARY_PRECONDITION } from './blob-seeds';

describe('BLOB_SEEDS', () => {
  it('covers exactly the 4 user-data blob_types', () => {
    expect(Object.keys(BLOB_SEEDS).sort()).toEqual(
      ['api-key', 'day-snapshot', 'note', 'patient'],
    );
  });

  it('USER_DATA_BLOB_TYPES is the parameterized iteration order', () => {
    expect(USER_DATA_BLOB_TYPES).toEqual(['patient', 'note', 'api-key', 'day-snapshot']);
    USER_DATA_BLOB_TYPES.forEach((t) => expect(BLOB_SEEDS[t]).toBeDefined());
  });

  it('every fixture has blobId, plaintext, and persistenceLayer/Key', () => {
    for (const [type, seed] of Object.entries(BLOB_SEEDS)) {
      expect(seed.blobId, `${type}.blobId`).toMatch(/.+/);
      expect(seed.plaintext, `${type}.plaintext`).toBeDefined();
      expect(['idb', 'localStorage']).toContain(seed.persistenceLayer);
      expect(typeof seed.persistenceKey, `${type}.persistenceKey`).toBe('string');
    }
  });

  it('CANARY_PRECONDITION carries the canonical canary plaintext shape', () => {
    expect(CANARY_PRECONDITION.blobId).toBe('__canary__');
    expect(CANARY_PRECONDITION.plaintext.v).toBe(1);
    expect(CANARY_PRECONDITION.plaintext.marker).toBe('ward-helper-canary');
  });

  it('api-key fixture targets localStorage, not IDB (v1.39.0+ change)', () => {
    expect(BLOB_SEEDS['api-key'].persistenceLayer).toBe('localStorage');
    expect(BLOB_SEEDS['api-key'].persistenceKey).toBe('wardhelper_apikey');
  });

  it('non-api-key fixtures target IDB stores', () => {
    expect(BLOB_SEEDS['patient'].persistenceLayer).toBe('idb');
    expect(BLOB_SEEDS['patient'].persistenceKey).toBe('patients');
    expect(BLOB_SEEDS['note'].persistenceLayer).toBe('idb');
    expect(BLOB_SEEDS['note'].persistenceKey).toBe('notes');
    expect(BLOB_SEEDS['day-snapshot'].persistenceLayer).toBe('idb');
    expect(BLOB_SEEDS['day-snapshot'].persistenceKey).toBe('daySnapshots');
  });
});
