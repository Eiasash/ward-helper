import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTests, type Patient } from '@/storage/indexed';
import {
  putDaySnapshot,
  listDaySnapshots,
  type DaySnapshot,
} from '@/storage/rounds';

beforeEach(async () => {
  await resetDbForTests();
});

function fakePatient(id: string, room = '5A'): Patient {
  return {
    id,
    name: `שם-${id}`,
    teudatZehut: `000000${id}`.slice(-9),
    dob: '1940-01-01',
    room,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    discharged: false,
    tomorrowNotes: [],
    handoverNote: '',
    planLongTerm: '',
    planToday: '',
    clinicalMeta: {},
  };
}

describe('daySnapshots put/list', () => {
  it('round-trips a snapshot keyed by date', async () => {
    await putDaySnapshot({
      id: '2026-05-09',
      date: '2026-05-09',
      archivedAt: 1234567890000,
      patients: [fakePatient('1')],
    });
    const all = await listDaySnapshots();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('2026-05-09');
    expect(all[0]?.patients[0]?.id).toBe('1');
  });

  it('upserts on same date (Q5b replace-on-double-archive)', async () => {
    await putDaySnapshot({
      id: '2026-05-09',
      date: '2026-05-09',
      archivedAt: 1,
      patients: [fakePatient('1')],
    });
    await putDaySnapshot({
      id: '2026-05-09',
      date: '2026-05-09',
      archivedAt: 2,
      patients: [fakePatient('2')],
    });
    const all = await listDaySnapshots();
    expect(all).toHaveLength(1);
    expect(all[0]?.archivedAt).toBe(2);
    expect(all[0]?.patients[0]?.id).toBe('2');
  });

  it('caps history to 20 by deleting oldest archivedAt on put', async () => {
    for (let i = 0; i < 22; i++) {
      const date = `2026-04-${String(i + 1).padStart(2, '0')}`;
      await putDaySnapshot({
        id: date,
        date,
        archivedAt: i + 1,
        patients: [fakePatient(`p${i}`)],
      });
    }
    const all = await listDaySnapshots();
    expect(all.length).toBeLessThanOrEqual(20);
    expect(all.find((s) => s.archivedAt === 1)).toBeUndefined();
    expect(all.find((s) => s.archivedAt === 2)).toBeUndefined();
  });
});
