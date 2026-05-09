import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient, putNote, getPatient, resetDbForTests,
  type Patient, type Note,
} from '@/storage/indexed';
import { decideSeed, detectReadmit } from '@/notes/seedFromYesterdaySoap';

beforeEach(async () => {
  await resetDbForTests();
});

function p(o: Partial<Patient>): Patient {
  return {
    id: o.id ?? 'p1',
    name: o.name ?? 'X',
    teudatZehut: o.teudatZehut ?? '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: o.discharged ?? false,
    dischargedAt: o.dischargedAt,
    tomorrowNotes: [], handoverNote: o.handoverNote ?? '',
    planLongTerm: o.planLongTerm ?? '', planToday: '',
    clinicalMeta: o.clinicalMeta ?? {},
  };
}

function soapNote(patientId: string, body: string, ageMs: number): Note {
  return {
    id: `n-${patientId}`,
    patientId,
    type: 'soap',
    bodyHebrew: body,
    structuredData: {},
    createdAt: Date.now() - ageMs,
    updatedAt: Date.now() - ageMs,
  };
}

describe('decideSeed', () => {
  it('no-history when no prior SOAP', async () => {
    await putPatient(p({ id: 'p1' }));
    const r = await decideSeed(await getPatientHelper('p1'));
    expect(r.kind).toBe('no-prefill');
    if (r.kind === 'no-prefill') expect(r.reason).toBe('no-history');
  });

  it('discharge-gap when discharged > 24h ago', async () => {
    const dischargedAt = Date.now() - 25 * 60 * 60 * 1000;
    const patient = p({ id: 'p1', discharged: true, dischargedAt });
    await putPatient(patient);
    await putNote(soapNote('p1', 'yesterday body', 60 * 1000));
    const r = await decideSeed(patient);
    expect(r.kind).toBe('no-prefill');
    if (r.kind === 'no-prefill') expect(r.reason).toBe('discharge-gap');
  });

  it('prefill when discharged 23h ago (still in window)', async () => {
    const dischargedAt = Date.now() - 23 * 60 * 60 * 1000;
    const patient = p({ id: 'p1', discharged: true, dischargedAt,
                         handoverNote: 'h', planLongTerm: 'continue ASA' });
    await putPatient(patient);
    await putNote(soapNote('p1', 'yesterday body', 60 * 1000));
    const r = await decideSeed(patient);
    expect(r.kind).toBe('prefill');
    if (r.kind === 'prefill') {
      expect(r.bodyContext).toBe('yesterday body');
      expect(r.patientFields.planLongTerm).toBe('continue ASA');
    }
  });

  it('prefill when not discharged + recent SOAP', async () => {
    const patient = p({ id: 'p1', planLongTerm: 'meds X' });
    await putPatient(patient);
    await putNote(soapNote('p1', 'yest body', 12 * 60 * 60 * 1000));
    const r = await decideSeed(patient);
    expect(r.kind).toBe('prefill');
    if (r.kind === 'prefill') expect(r.patientFields.planLongTerm).toBe('meds X');
  });
});

describe('detectReadmit', () => {
  it('returns isReadmit=false when not discharged', () => {
    expect(detectReadmit(p({ id: 'p1' })).isReadmit).toBe(false);
  });

  it('returns gapDays when discharged', () => {
    const dischargedAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const r = detectReadmit(p({ id: 'p1', discharged: true, dischargedAt }));
    expect(r.isReadmit).toBe(true);
    expect(r.gapDays).toBe(5);
  });

  it('handles missing dischargedAt as not-discharged (defensive)', () => {
    const r = detectReadmit(p({ id: 'p1', discharged: true }));
    expect(r.isReadmit).toBe(false);
  });
});

async function getPatientHelper(id: string): Promise<Patient> {
  const p = await getPatient(id);
  if (!p) throw new Error(`fixture missing: ${id}`);
  return p;
}
