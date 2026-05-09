import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  putPatient, listPatients, resetDbForTests, type Patient,
} from '@/storage/indexed';
import { archiveDay, listDaySnapshots } from '@/storage/rounds';

const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

beforeEach(async () => {
  await resetDbForTests();
  localStorage.removeItem(LAST_ARCHIVED_KEY);
});

function newP(id: string, planToday = ''): Patient {
  return {
    id, name: `שם-${id}`, teudatZehut: `00000000${id}`.slice(-9),
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: '',
    planLongTerm: 'continue ASA', planToday,
    clinicalMeta: {},
  };
}

describe('archiveDay', () => {
  it('snapshots current roster + clears planToday for all + sets lastArchivedDate', async () => {
    await putPatient(newP('1', 'today: order CBC'));
    await putPatient(newP('2', 'today: call ortho'));

    const result = await archiveDay();

    // Snapshot recorded
    const snaps = await listDaySnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.patients).toHaveLength(2);
    // Snapshot.patients carry the planToday FROM BEFORE the clear (frozen)
    expect(snaps[0]?.patients[0]?.planToday).toBe('today: order CBC');

    // Live patient state has planToday cleared
    const live = await listPatients();
    expect(live.find(p => p.id === '1')?.planToday).toBe('');
    expect(live.find(p => p.id === '2')?.planToday).toBe('');
    // planLongTerm preserved
    expect(live.find(p => p.id === '1')?.planLongTerm).toBe('continue ASA');

    // localStorage marker
    expect(localStorage.getItem(LAST_ARCHIVED_KEY)).toBeTruthy();
    // Function returned the snapshot
    expect(result.patients).toHaveLength(2);
  });

  it('replaces same-date snapshot on second call (Q5b)', async () => {
    await putPatient(newP('a'));
    const r1 = await archiveDay();
    await putPatient(newP('b'));  // new patient added between archives
    const r2 = await archiveDay();

    expect(r2.archivedAt).toBeGreaterThanOrEqual(r1.archivedAt);
    const snaps = await listDaySnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.patients).toHaveLength(2);
  });

  it('emits notifyDayArchived event after successful archive', async () => {
    await putPatient(newP('1'));
    const spy = vi.fn();
    window.addEventListener('ward-helper:day-archived', spy);
    try {
      await archiveDay();
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('ward-helper:day-archived', spy);
    }
  });
});
