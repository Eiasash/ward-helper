import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient, getPatient, resetDbForTests, type Patient,
} from '@/storage/indexed';
import {
  addTomorrowNote, dismissTomorrowNote, promoteToHandover,
} from '@/storage/rounds';

beforeEach(async () => {
  await resetDbForTests();
});

function newP(): Patient {
  return {
    id: 'p1', name: 'X', teudatZehut: '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: '',
    planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

describe('tomorrowNotes helpers', () => {
  it('addTomorrowNote appends to array', async () => {
    await putPatient(newP());
    await addTomorrowNote('p1', 'AM labs already drawn');
    await addTomorrowNote('p1', 'call ortho');
    const back = await getPatient('p1');
    expect(back?.tomorrowNotes).toEqual(['AM labs already drawn', 'call ortho']);
  });

  it('dismissTomorrowNote splices a single line by index', async () => {
    await putPatient({ ...newP(), tomorrowNotes: ['a', 'b', 'c'] });
    await dismissTomorrowNote('p1', 1);
    const back = await getPatient('p1');
    expect(back?.tomorrowNotes).toEqual(['a', 'c']);
  });

  it('promoteToHandover appends to handoverNote AND splices from tomorrowNotes', async () => {
    await putPatient({
      ...newP(),
      tomorrowNotes: ['ephemeral', 'should-promote', 'other'],
      handoverNote: 'existing',
    });
    await promoteToHandover('p1', 1);
    const back = await getPatient('p1');
    expect(back?.tomorrowNotes).toEqual(['ephemeral', 'other']);
    expect(back?.handoverNote).toContain('existing');
    expect(back?.handoverNote).toContain('should-promote');
  });
});
