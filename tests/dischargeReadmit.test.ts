import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient, getPatient, resetDbForTests, type Patient,
} from '@/storage/indexed';
import {
  dischargePatient, unDischargePatient,
} from '@/storage/rounds';

beforeEach(async () => {
  await resetDbForTests();
});

function newP(id: string): Patient {
  return {
    id, name: `שם-${id}`, teudatZehut: `00000000${id}`.slice(-9),
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: 'baseline note',
    planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

describe('discharge + un-discharge', () => {
  it('dischargePatient sets discharged + dischargedAt', async () => {
    await putPatient(newP('1'));
    const before = Date.now();
    await dischargePatient('1');
    const back = await getPatient('1');
    expect(back?.discharged).toBe(true);
    expect(back?.dischargedAt).toBeGreaterThanOrEqual(before);
  });

  it('unDischargePatient clears state + appends handoverNote re-admit line', async () => {
    await putPatient(newP('1'));
    await dischargePatient('1');
    await unDischargePatient('1', 5, 're-admission via capture');
    const back = await getPatient('1');
    expect(back?.discharged).toBe(false);
    expect(back?.dischargedAt).toBeUndefined();
    expect(back?.handoverNote).toContain('baseline note');
    expect(back?.handoverNote).toContain('חזר לאשפוז');
    expect(back?.handoverNote).toContain('5');
    expect(back?.handoverNote).toContain('re-admission via capture');
  });

  it('unDischargePatient on a not-currently-discharged patient still appends re-admit line', async () => {
    await putPatient(newP('1'));
    // patient is not discharged
    await unDischargePatient('1', 0, 'manual call');
    const back = await getPatient('1');
    expect(back?.discharged).toBe(false);
    expect(back?.dischargedAt).toBeUndefined();
    expect(back?.handoverNote).toContain('manual call');
  });
});
