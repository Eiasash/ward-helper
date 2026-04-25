import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  putPatient,
  listPatients,
  resetDbForTests,
} from '@/storage/indexed';
import { upsertCensus } from '@/storage/census';
import type { CensusRow } from '@/agent/loop';

const ROW = (overrides: Partial<CensusRow>): CensusRow => ({
  name: 'דוד לוי',
  teudatZehut: '111111111',
  room: '12',
  isolation: false,
  ventilation: false,
  bloodBankColor: null,
  unsignedAdmission: false,
  unsignedShiftSummary: false,
  ...overrides,
});

beforeEach(async () => {
  await resetDbForTests();
});

describe('upsertCensus — insert vs update with no duplicates', () => {
  it('inserts new patients and updates existing on a 10-row mock (5 + 5)', async () => {
    // Pre-seed 5 existing patients.
    for (let i = 0; i < 5; i++) {
      await putPatient({
        id: `pre-${i}`,
        name: `Existing ${i}`,
        teudatZehut: `00000000${i}`,
        dob: '1950-01-01',
        room: '5',
        tags: ['existing-tag'],
        createdAt: 1,
        updatedAt: 1,
      });
    }
    const rows: CensusRow[] = [];
    // 5 updates (matching the seeded teudatZehut).
    for (let i = 0; i < 5; i++) {
      rows.push(ROW({
        teudatZehut: `00000000${i}`,
        name: `Census Name ${i}`,
        room: '99',
      }));
    }
    // 5 inserts (new IDs).
    for (let i = 0; i < 5; i++) {
      rows.push(ROW({
        teudatZehut: `90000000${i}`,
        name: `New Patient ${i}`,
        room: '20',
      }));
    }

    const result = await upsertCensus(rows);
    expect(result.inserted).toBe(5);
    expect(result.updated).toBe(5);
    expect(result.skipped).toBe(0);

    const all = await listPatients();
    expect(all).toHaveLength(10);
    // No duplicates by teudatZehut
    const tzs = all.map((p) => p.teudatZehut);
    expect(new Set(tzs).size).toBe(tzs.length);
  });
});

describe('upsertCensus — name preservation on update', () => {
  it('does NOT overwrite the existing name when updating', async () => {
    await putPatient({
      id: 'p1',
      name: 'Original Name',
      teudatZehut: '111111111',
      dob: '1950-01-01',
      room: '5',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await upsertCensus([ROW({ teudatZehut: '111111111', name: 'Census Pass Name', room: '20' })]);
    const all = await listPatients();
    const updated = all.find((p) => p.teudatZehut === '111111111');
    expect(updated?.name).toBe('Original Name');
    expect(updated?.room).toBe('20');
  });

  it('merges tags rather than replacing on update', async () => {
    await putPatient({
      id: 'p1',
      name: 'X',
      teudatZehut: '111111111',
      dob: '',
      room: '5',
      tags: ['handpicked'],
      createdAt: 1,
      updatedAt: 1,
    });
    await upsertCensus([
      ROW({ teudatZehut: '111111111', isolation: true, unsignedAdmission: true }),
    ]);
    const all = await listPatients();
    const updated = all.find((p) => p.teudatZehut === '111111111');
    expect(updated?.tags).toContain('handpicked');
    expect(updated?.tags).toContain('isolation');
    expect(updated?.tags).toContain('unsigned-admission');
  });
});

describe('upsertCensus — null teudatZehut rows are skipped', () => {
  it('skips rows where teudatZehut is null', async () => {
    const rows: CensusRow[] = [
      ROW({ teudatZehut: null }),
      ROW({ teudatZehut: '999999999', name: 'Has ID' }),
    ];
    const result = await upsertCensus(rows);
    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(1);
    const all = await listPatients();
    expect(all.find((p) => p.name === 'Has ID')).toBeTruthy();
  });

  it('also skips empty-string teudatZehut after trim', async () => {
    const result = await upsertCensus([ROW({ teudatZehut: '   ' })]);
    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(0);
  });
});

describe('upsertCensus — tag mapping from flags', () => {
  it('translates blood bank color into a structured tag', async () => {
    await upsertCensus([
      ROW({
        teudatZehut: '222222222',
        bloodBankColor: 'green',
        ventilation: true,
      }),
    ]);
    const all = await listPatients();
    const p = all.find((x) => x.teudatZehut === '222222222');
    expect(p?.tags).toContain('blood-bank:green');
    expect(p?.tags).toContain('ventilation');
  });
});
