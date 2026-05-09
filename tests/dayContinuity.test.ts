import { describe, it, expect } from 'vitest';
import { buildDayContinuity, ROOM_NAME_PREFIX_LEN, HANDOVER_MIN_CHARS } from '@/engine/dayContinuity';
import type { Patient } from '@/storage/indexed';
import type { DaySnapshot } from '@/storage/rounds';

function p(o: Partial<Patient>): Patient {
  return {
    id: o.id ?? crypto.randomUUID(),
    name: o.name ?? '',
    teudatZehut: o.teudatZehut ?? '',
    dob: '1940-01-01',
    room: o.room ?? '5A',
    tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: o.discharged ?? false,
    dischargedAt: o.dischargedAt,
    tomorrowNotes: o.tomorrowNotes ?? [],
    handoverNote: o.handoverNote ?? '',
    planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

function snap(date: string, archivedAt: number, patients: Patient[]): DaySnapshot {
  return { id: date, date, archivedAt, patients };
}

describe('buildDayContinuity', () => {
  it('empty history returns empty map', () => {
    const out = buildDayContinuity([p({ id: 'a' })], []);
    expect(out.size).toBe(0);
  });

  it('exact room + name-prefix match', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'כהן שרה', room: '5A', handoverNote: 'DNR per family' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.matchType).toBe('exact');
    expect(out.get('today-1')?.handoverNote).toBe('DNR per family');
  });

  it('OCR name variation tolerated by 4-char prefix', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה מ', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'כהן שרה', room: '5A', handoverNote: 'baseline 24/30' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.matchType).toBe('exact');
  });

  it('room moved overnight → name-fallback match', () => {
    const today = [p({ id: 'today-1', name: 'לוי משה', room: '5B' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'לוי משה', room: '5A', handoverNote: 'continue ASA' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.matchType).toBe('name-fallback');
  });

  it('discharged in yesterday snapshot → not surfaced today', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'כהן שרה', room: '5A',
          discharged: true, dischargedAt: 1, handoverNote: 'DNR' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.size).toBe(0);
  });

  it('handoverNote ≤ 5 chars filtered out', () => {
    const today = [p({ id: 'today-1', name: 'אבישי', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'אבישי', room: '5A', handoverNote: 'OK' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.handoverNote).toBe('');
  });

  it('uses most recent snapshot when multiple exist', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה', room: '5A' })];
    const older = snap('2026-05-06', 1, [
      p({ id: 'old', name: 'כהן שרה', room: '5A', handoverNote: 'older note here' }),
    ]);
    const newer = snap('2026-05-08', 100, [
      p({ id: 'new', name: 'כהן שרה', room: '5A', handoverNote: 'newer note here' }),
    ]);
    const out = buildDayContinuity(today, [newer, older]);  // descending
    expect(out.get('today-1')?.handoverNote).toBe('newer note here');
  });

  it('exposes ROOM_NAME_PREFIX_LEN = 4 and HANDOVER_MIN_CHARS = 5', () => {
    expect(ROOM_NAME_PREFIX_LEN).toBe(4);
    expect(HANDOVER_MIN_CHARS).toBe(5);
  });

  it('LRE-prefixed Hebrew name (real OCR artifact) still matches via stripping', () => {
    // ‪ is LRE — invisible BIDI control char that AZMA OCR sometimes injects
    const today = [p({ id: 'today-1', name: '‪כהן שרה', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'כהן שרה', room: '5A', handoverNote: 'baseline note here' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.matchType).toBe('exact');
  });
});
