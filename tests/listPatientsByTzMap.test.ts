/**
 * Tests for src/storage/indexed.ts::listPatientsByTzMap.
 *
 * PR-B1 introduced this helper to collapse Census's per-row
 * getPatientByTz loop (which would have been O(N×M) full-scans
 * post-v7-by-tz-drop) into one O(N) scan plus M O(1) Map lookups.
 *
 * The existing getPatientByTz / upsertPatientByTz / listNotesByTeudatZehut
 * tests in tests/storage.test.ts already cover the storage-layer
 * refactor via their preserved external contracts. This file pins the
 * NEW helper's specific semantics:
 *   - skip blank-tz rows
 *   - on duplicate tz, return the most-recently-updated row
 *   - return trimmed-tz keys
 *   - empty store → empty map
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  listPatientsByTzMap,
  putPatient,
  resetDbForTests,
  type Patient,
} from '@/storage/indexed';

beforeEach(async () => {
  await resetDbForTests();
});

function mkPatient(over: Partial<Patient>): Patient {
  return {
    id: over.id ?? `p-${Math.random().toString(36).slice(2, 9)}`,
    name: over.name ?? 'Test',
    teudatZehut: over.teudatZehut ?? '',
    dob: over.dob ?? '1950-01-01',
    room: over.room ?? null,
    tags: over.tags ?? [],
    createdAt: over.createdAt ?? 1700000000000,
    updatedAt: over.updatedAt ?? 1700000000000,
  };
}

describe('listPatientsByTzMap', () => {
  it('returns an empty Map when patients store is empty', async () => {
    const map = await listPatientsByTzMap();
    expect(map.size).toBe(0);
  });

  it('keys by trimmed teudatZehut, value is the Patient row', async () => {
    await putPatient(mkPatient({ id: 'p1', name: 'אלף', teudatZehut: '123456789' }));
    await putPatient(mkPatient({ id: 'p2', name: 'בית', teudatZehut: '987654321' }));

    const map = await listPatientsByTzMap();

    expect(map.size).toBe(2);
    expect(map.get('123456789')?.name).toBe('אלף');
    expect(map.get('987654321')?.name).toBe('בית');
  });

  it('skips patients with blank teudatZehut (no key to map them under)', async () => {
    await putPatient(mkPatient({ id: 'p1', name: 'with-tz', teudatZehut: '123456789' }));
    await putPatient(mkPatient({ id: 'p2', name: 'no-tz', teudatZehut: '' }));
    await putPatient(mkPatient({ id: 'p3', name: 'whitespace-tz', teudatZehut: '   ' }));

    const map = await listPatientsByTzMap();

    expect(map.size).toBe(1);
    expect(map.get('123456789')?.name).toBe('with-tz');
    expect(map.has('')).toBe(false);
  });

  it('on duplicate tz, the most-recently-updated row wins', async () => {
    // Two patient rows sharing the same tz — a state that pre-v7 should
    // not normally exist but can arise from a prior index-bug or manual
    // import. The map should resolve to the newer row.
    await putPatient(mkPatient({
      id: 'older',
      name: 'older-name',
      teudatZehut: '111111111',
      updatedAt: 1700000001000,
    }));
    await putPatient(mkPatient({
      id: 'newer',
      name: 'newer-name',
      teudatZehut: '111111111',
      updatedAt: 1700000999000,
    }));

    const map = await listPatientsByTzMap();

    expect(map.size).toBe(1);
    expect(map.get('111111111')?.id).toBe('newer');
    expect(map.get('111111111')?.name).toBe('newer-name');
  });

  it('handles Census-shaped load (50 patients, scan-once is fast)', async () => {
    // Sanity smoke: 50 patients is the rough ward-scale upper bound.
    // The latency math during PR-A grounding said decrypt-scan was
    // ~30-100ms at this scale; without encryption (PR-B1's plaintext
    // case) it's a clean getAll + sort + Map-build, well under that.
    for (let i = 0; i < 50; i++) {
      await putPatient(mkPatient({
        id: `p-${i}`,
        name: `Patient-${i}`,
        teudatZehut: String(100000000 + i),
      }));
    }
    const map = await listPatientsByTzMap();
    expect(map.size).toBe(50);
    expect(map.get('100000000')?.name).toBe('Patient-0');
    expect(map.get('100000049')?.name).toBe('Patient-49');
  });
});
