import { describe, it, expect, beforeEach } from 'vitest';
import { putPatient, putNote, resetDbForTests, type Patient, type Note } from '@/storage/indexed';
import { resolveContinuity, EPISODE_WINDOW_MS } from '@/notes/continuity';

beforeEach(async () => {
  await resetDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('ward-helper');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

function mkPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: crypto.randomUUID(),
    name: 'דוד לוי',
    teudatZehut: '012345678',
    dob: '1944-03-01',
    room: '3-12',
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function mkNote(overrides: Partial<Note>): Note {
  return {
    id: crypto.randomUUID(),
    patientId: 'x',
    type: 'admission',
    bodyHebrew: '',
    structuredData: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('resolveContinuity', () => {
  it('returns null patient + empty everything when no match', async () => {
    const ctx = await resolveContinuity('999999999');
    expect(ctx.patient).toBeNull();
    expect(ctx.admission).toBeNull();
    expect(ctx.priorSoaps).toEqual([]);
    expect(ctx.mostRecentSoap).toBeNull();
    expect(ctx.episodeStart).toBeNull();
  });

  it('loads admission + no prior SOAPs when patient just admitted', async () => {
    const p = mkPatient();
    await putPatient(p);
    const adm = mkNote({ patientId: p.id, type: 'admission', bodyHebrew: 'קבלה רפואית...', createdAt: Date.now() - 86_400_000 });
    await putNote(adm);
    const ctx = await resolveContinuity(p.teudatZehut);
    expect(ctx.patient?.id).toBe(p.id);
    expect(ctx.admission?.id).toBe(adm.id);
    expect(ctx.priorSoaps).toEqual([]);
    expect(ctx.mostRecentSoap).toBeNull();
    expect(ctx.episodeStart).toBe(adm.createdAt);
  });

  it('loads admission + prior SOAPs newest-first for follow-up', async () => {
    const p = mkPatient();
    await putPatient(p);
    const now = Date.now();
    const adm = mkNote({ patientId: p.id, type: 'admission', createdAt: now - 3 * 86_400_000 });
    const s1 = mkNote({ patientId: p.id, type: 'soap', bodyHebrew: 'day 1', createdAt: now - 2 * 86_400_000 });
    const s2 = mkNote({ patientId: p.id, type: 'soap', bodyHebrew: 'day 2', createdAt: now - 1 * 86_400_000 });
    await putNote(adm);
    await putNote(s1);
    await putNote(s2);
    const ctx = await resolveContinuity(p.teudatZehut);
    expect(ctx.admission?.id).toBe(adm.id);
    expect(ctx.priorSoaps.map((n) => n.id)).toEqual([s2.id, s1.id]);
    expect(ctx.mostRecentSoap?.id).toBe(s2.id);
  });

  it('treats episodes older than 30 days as stale — clears admission + priorSoaps', async () => {
    const p = mkPatient();
    await putPatient(p);
    const old = Date.now() - (EPISODE_WINDOW_MS + 86_400_000);
    const adm = mkNote({ patientId: p.id, type: 'admission', createdAt: old });
    const soap = mkNote({ patientId: p.id, type: 'soap', createdAt: old + 3600_000 });
    await putNote(adm);
    await putNote(soap);
    const ctx = await resolveContinuity(p.teudatZehut);
    expect(ctx.patient?.id).toBe(p.id);
    expect(ctx.admission).toBeNull();
    expect(ctx.priorSoaps).toEqual([]);
    expect(ctx.episodeStart).toBeNull();
  });
});
