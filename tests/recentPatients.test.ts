/**
 * Recent-patients quick-pick — dedupe rule and pickRecentPatient session
 * seeding. UI mount is exercised by Capture's smoke tests; these are the
 * pure-logic locks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildRecentPatients,
  pickRecentPatient,
} from '@/ui/components/RecentPatientsList';
import type { Note, Patient } from '@/storage/indexed';

function mkPatient(over: Partial<Patient> = {}): Patient {
  return {
    id: over.id ?? 'p1',
    name: 'דוד לוי',
    teudatZehut: '111111111',
    dob: '1944-03-01',
    room: '3-12',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function mkNote(over: Partial<Note> = {}): Note {
  return {
    id: over.id ?? 'n1',
    patientId: over.patientId ?? 'p1',
    type: 'admission',
    bodyHebrew: '',
    structuredData: { name: 'דוד לוי' },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('buildRecentPatients', () => {
  const NOW = 1_700_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it('returns empty when no patients', () => {
    expect(buildRecentPatients([], [], NOW)).toEqual([]);
  });

  it('returns empty when all notes are outside the 24h window', () => {
    const patients = [mkPatient({ id: 'p1' })];
    const notes = [mkNote({ id: 'n1', patientId: 'p1', updatedAt: NOW - 2 * DAY })];
    expect(buildRecentPatients(patients, notes, NOW)).toEqual([]);
  });

  it('dedupes per patient — keeps newest note only', () => {
    const patients = [mkPatient({ id: 'p1' })];
    const notes = [
      mkNote({ id: 'old', patientId: 'p1', updatedAt: NOW - 5 * HOUR }),
      mkNote({ id: 'new', patientId: 'p1', updatedAt: NOW - 1 * HOUR }),
      mkNote({ id: 'mid', patientId: 'p1', updatedAt: NOW - 3 * HOUR }),
    ];
    const result = buildRecentPatients(patients, notes, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.latestNote.id).toBe('new');
  });

  it('sorts patients newest-first by latest note', () => {
    const patients = [
      mkPatient({ id: 'p1', name: 'איש 1' }),
      mkPatient({ id: 'p2', name: 'איש 2' }),
      mkPatient({ id: 'p3', name: 'איש 3' }),
    ];
    const notes = [
      mkNote({ id: 'n1', patientId: 'p1', updatedAt: NOW - 10 * HOUR }),
      mkNote({ id: 'n2', patientId: 'p2', updatedAt: NOW - 1 * HOUR }),
      mkNote({ id: 'n3', patientId: 'p3', updatedAt: NOW - 5 * HOUR }),
    ];
    const result = buildRecentPatients(patients, notes, NOW);
    expect(result.map((r) => r.patient.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('drops notes whose patient row is missing (orphaned)', () => {
    const patients = [mkPatient({ id: 'p1' })];
    const notes = [
      mkNote({ id: 'n1', patientId: 'p1', updatedAt: NOW - 1 * HOUR }),
      mkNote({ id: 'orphan', patientId: 'pmissing', updatedAt: NOW - 1 * HOUR }),
    ];
    const result = buildRecentPatients(patients, notes, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.patient.id).toBe('p1');
  });

  it('respects custom window — 1h window drops notes from 2h ago', () => {
    const patients = [mkPatient({ id: 'p1' })];
    const notes = [
      mkNote({ id: 'n1', patientId: 'p1', updatedAt: NOW - 2 * HOUR }),
    ];
    expect(buildRecentPatients(patients, notes, NOW, HOUR)).toHaveLength(0);
    expect(buildRecentPatients(patients, notes, NOW, 3 * HOUR)).toHaveLength(1);
  });
});

describe('pickRecentPatient', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('seeds validated/noteType from the saved structuredData', () => {
    const rp = {
      patient: mkPatient({ id: 'p1', name: 'דוד לוי', teudatZehut: '111111111' }),
      latestNote: mkNote({
        structuredData: {
          name: 'דוד לוי',
          teudatZehut: '111111111',
          age: 78,
          chiefComplaint: 'כאב בטן',
        },
      }),
    };
    pickRecentPatient(rp, 'soap');
    expect(JSON.parse(sessionStorage.getItem('validated') ?? '{}')).toEqual({
      name: 'דוד לוי',
      teudatZehut: '111111111',
      age: 78,
      chiefComplaint: 'כאב בטן',
    });
    expect(sessionStorage.getItem('noteType')).toBe('soap');
    expect(sessionStorage.getItem('validatedConfidence')).toBe('{}');
  });

  it('clears any leftover draft body so NoteEditor regenerates fresh', () => {
    sessionStorage.setItem('body', 'old draft');
    sessionStorage.setItem('bodyKey', 'old-key');
    const rp = {
      patient: mkPatient({ id: 'p1' }),
      latestNote: mkNote({}),
    };
    pickRecentPatient(rp, 'admission');
    expect(sessionStorage.getItem('body')).toBeNull();
    expect(sessionStorage.getItem('bodyKey')).toBeNull();
  });
});
