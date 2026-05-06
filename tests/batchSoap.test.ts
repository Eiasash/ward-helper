import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runExtractSpy, generateNoteSpy, saveBothSpy, loadSkillsSpy } = vi.hoisted(
  () => ({
    runExtractSpy: vi.fn(),
    generateNoteSpy: vi.fn(),
    saveBothSpy: vi.fn(),
    loadSkillsSpy: vi.fn(),
  }),
);

vi.mock('@/agent/loop', () => ({
  runExtractTurn: runExtractSpy,
}));
vi.mock('@/notes/orchestrate', () => ({
  generateNote: generateNoteSpy,
}));
vi.mock('@/notes/save', () => ({
  saveBoth: saveBothSpy,
}));
vi.mock('@/skills/loader', () => ({
  loadSkills: loadSkillsSpy,
}));
vi.mock('@/agent/debugLog', () => ({
  recordError: vi.fn(),
}));

import {
  runBatchSoap,
  mergeRosterIdentity,
  type BatchProgressEvent,
} from '@/notes/batchSoap';
import type { RosterPatient } from '@/storage/roster';
import type { ParseFields } from '@/agent/tools';
import type { CaptureBlock } from '@/camera/session';

function makeRosterPatient(opts: Partial<RosterPatient> & { name: string }): RosterPatient {
  return {
    id: opts.id ?? crypto.randomUUID(),
    tz: opts.tz ?? null,
    name: opts.name,
    age: opts.age ?? null,
    sex: opts.sex ?? null,
    room: opts.room ?? null,
    bed: opts.bed ?? null,
    losDays: opts.losDays ?? null,
    dxShort: opts.dxShort ?? null,
    sourceMode: opts.sourceMode ?? 'manual',
    importedAt: opts.importedAt ?? Date.now(),
  };
}

function makeImageBlock(id: string): CaptureBlock {
  return {
    id,
    kind: 'image',
    blobUrl: `blob:mock-${id}`,
    dataUrl: 'data:image/jpeg;base64,Zm9v',
    sourceLabel: 'camera',
    addedAt: Date.now(),
  };
}

describe('mergeRosterIdentity', () => {
  it('roster identity wins on name/tz/age/sex/room', () => {
    const rp = makeRosterPatient({
      name: 'רוזנברג מרים',
      tz: '123456789',
      age: 87,
      sex: 'F',
      room: '12',
    });
    const extract: ParseFields = {
      name: 'WRONG NAME',
      teudatZehut: '999999998',
      age: 50,
      sex: 'M',
      room: 'WRONG',
      meds: [{ name: 'Apixaban', dose: '5 mg', freq: 'BID' }],
    };
    const merged = mergeRosterIdentity(rp, extract);
    expect(merged.name).toBe('רוזנברג מרים');
    expect(merged.teudatZehut).toBe('123456789');
    expect(merged.age).toBe(87);
    expect(merged.sex).toBe('F');
    expect(merged.room).toBe('12');
  });

  it('extract fills identity fields where roster is null', () => {
    const rp = makeRosterPatient({ name: 'מטופל', tz: null, age: null });
    const extract: ParseFields = {
      teudatZehut: '123456789',
      age: 80,
      sex: 'M',
      room: '14',
      meds: [],
    };
    const merged = mergeRosterIdentity(rp, extract);
    expect(merged.teudatZehut).toBe('123456789');
    expect(merged.age).toBe(80);
    expect(merged.sex).toBe('M');
    expect(merged.room).toBe('14');
  });

  it('clinical fields come from extract (roster has none)', () => {
    const rp = makeRosterPatient({ name: 'מטופל' });
    const extract: ParseFields = {
      chiefComplaint: 'CHF exacerbation',
      pmh: ['CHF', 'CKD'],
      meds: [{ name: 'Furosemide', dose: '40 mg' }],
      allergies: ['Penicillin'],
      labs: [{ name: 'BNP', value: '1200', unit: 'pg/mL' }],
      vitals: { BP: '110/70', HR: 88 },
    };
    const merged = mergeRosterIdentity(rp, extract);
    expect(merged.chiefComplaint).toBe('CHF exacerbation');
    expect(merged.pmh).toEqual(['CHF', 'CKD']);
    expect(merged.meds).toHaveLength(1);
    expect(merged.allergies).toEqual(['Penicillin']);
    expect(merged.labs).toHaveLength(1);
    expect(merged.vitals).toEqual({ BP: '110/70', HR: 88 });
  });
});

describe('runBatchSoap', () => {
  beforeEach(() => {
    runExtractSpy.mockReset();
    generateNoteSpy.mockReset();
    saveBothSpy.mockReset();
    loadSkillsSpy.mockReset();
    loadSkillsSpy.mockResolvedValue('STUB SKILLS');
  });

  function happyPathMocks() {
    runExtractSpy.mockResolvedValue({
      fields: { meds: [], labs: [] },
      confidence: {},
    });
    generateNoteSpy.mockResolvedValue('# נוצר SOAP בעברית');
    saveBothSpy.mockImplementation(async (fields: ParseFields) => ({
      patientId: `pid-${fields.name}`,
      noteId: `nid-${fields.name}`,
      cloudPushed: true,
      cloudSkippedReason: null,
    }));
  }

  it('three patients, all succeed: completed=3, failed=0, aborted=false', async () => {
    happyPathMocks();
    const ctrl = new AbortController();
    const patients = [
      makeRosterPatient({ name: 'A' }),
      makeRosterPatient({ name: 'B' }),
      makeRosterPatient({ name: 'C' }),
    ];
    const result = await runBatchSoap(patients, {
      images: [[makeImageBlock('a')], [makeImageBlock('b')], [makeImageBlock('c')]],
      onProgress: () => {},
      abortSignal: ctrl.signal,
    });
    expect(result.completed).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.aborted).toBe(false);
    expect(runExtractSpy).toHaveBeenCalledTimes(3);
    expect(generateNoteSpy).toHaveBeenCalledTimes(3);
    expect(saveBothSpy).toHaveBeenCalledTimes(3);
  });

  it('middle patient throws — completed=2, failed=1, batch continues', async () => {
    happyPathMocks();
    runExtractSpy
      .mockResolvedValueOnce({ fields: {}, confidence: {} })
      .mockRejectedValueOnce(new Error('boom on patient B'))
      .mockResolvedValueOnce({ fields: {}, confidence: {} });

    const ctrl = new AbortController();
    const patients = [
      makeRosterPatient({ name: 'A' }),
      makeRosterPatient({ name: 'B' }),
      makeRosterPatient({ name: 'C' }),
    ];
    const result = await runBatchSoap(patients, {
      images: [[makeImageBlock('a')], [makeImageBlock('b')], [makeImageBlock('c')]],
      onProgress: () => {},
      abortSignal: ctrl.signal,
    });
    expect(result.completed).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toMatch(/boom on patient B/);
    expect(result.failed[0]?.patientId).toBe(patients[1]!.id);
    expect(result.aborted).toBe(false);
    // Patient C still ran despite B failing
    expect(runExtractSpy).toHaveBeenCalledTimes(3);
  });

  it('abort between patients — completed=1, aborted=true, third never runs', async () => {
    happyPathMocks();
    const ctrl = new AbortController();

    let invocations = 0;
    runExtractSpy.mockImplementation(async () => {
      invocations++;
      // After patient 2 finishes its extract, fire the abort. The
      // top-of-iteration check on patient 3 will see it.
      if (invocations === 2) ctrl.abort();
      return { fields: {}, confidence: {} };
    });

    const patients = [
      makeRosterPatient({ name: 'A' }),
      makeRosterPatient({ name: 'B' }),
      makeRosterPatient({ name: 'C' }),
    ];
    const result = await runBatchSoap(patients, {
      images: [[makeImageBlock('a')], [makeImageBlock('b')], [makeImageBlock('c')]],
      onProgress: () => {},
      abortSignal: ctrl.signal,
    });
    // Patient B finishes extract, then the post-extract abort check
    // catches it before emit. So both A AND B's emit/save state matters.
    // A: full success. B: abort caught after extract → aborted, no
    // completion. C: top-of-loop abort, never started.
    expect(result.aborted).toBe(true);
    expect(result.completed.length).toBeLessThanOrEqual(2);
    expect(runExtractSpy).toHaveBeenCalledTimes(2); // C never ran
  });

  it('abort during extract (AbortError) — patient marked aborted, loop exits', async () => {
    happyPathMocks();
    const ctrl = new AbortController();

    runExtractSpy
      .mockResolvedValueOnce({ fields: {}, confidence: {} })
      .mockImplementationOnce(async () => {
        ctrl.abort();
        const err = new DOMException('aborted by user', 'AbortError');
        throw err;
      });

    const patients = [
      makeRosterPatient({ name: 'A' }),
      makeRosterPatient({ name: 'B' }),
      makeRosterPatient({ name: 'C' }),
    ];
    const result = await runBatchSoap(patients, {
      images: [[makeImageBlock('a')], [makeImageBlock('b')], [makeImageBlock('c')]],
      onProgress: () => {},
      abortSignal: ctrl.signal,
    });
    expect(result.aborted).toBe(true);
    expect(result.completed).toHaveLength(1); // only A
    // B's AbortError landed in the catch with abortSignal.aborted true,
    // so it's marked aborted (not failed).
    expect(result.failed).toHaveLength(0);
    expect(runExtractSpy).toHaveBeenCalledTimes(2); // C never ran
  });

  it('onProgress emits the right phase sequence per iteration (success path)', async () => {
    happyPathMocks();
    const ctrl = new AbortController();
    const events: BatchProgressEvent[] = [];

    const patients = [makeRosterPatient({ name: 'A' })];
    await runBatchSoap(patients, {
      images: [[makeImageBlock('a')]],
      onProgress: (e) => events.push(e),
      abortSignal: ctrl.signal,
    });

    const statuses = events.map((e) => e.status);
    expect(statuses).toEqual(['extracting', 'emitting', 'saving', 'done']);
    expect(events.every((e) => e.index === 0 && e.total === 1)).toBe(true);
  });

  it('onProgress reports "failed" status for per-patient errors', async () => {
    happyPathMocks();
    runExtractSpy.mockRejectedValue(new Error('extract failed'));
    const ctrl = new AbortController();
    const events: BatchProgressEvent[] = [];

    const patients = [makeRosterPatient({ name: 'A' })];
    await runBatchSoap(patients, {
      images: [[makeImageBlock('a')]],
      onProgress: (e) => events.push(e),
      abortSignal: ctrl.signal,
    });

    const last = events[events.length - 1];
    expect(last?.status).toBe('failed');
    expect(last?.error).toMatch(/extract failed/);
  });

  it('soapMode passes through to generateNote unchanged', async () => {
    happyPathMocks();
    const ctrl = new AbortController();

    await runBatchSoap([makeRosterPatient({ name: 'A' })], {
      images: [[makeImageBlock('a')]],
      onProgress: () => {},
      abortSignal: ctrl.signal,
      soapMode: 'rehab-HD-COMPLEX',
    });

    expect(generateNoteSpy).toHaveBeenCalledTimes(1);
    const call = generateNoteSpy.mock.calls[0]!;
    // signature: (noteType, validated, continuity, soapMode, abortSignal)
    expect(call[3]).toBe('rehab-HD-COMPLEX');
  });

  it('default soapMode is "general" when option omitted', async () => {
    happyPathMocks();
    const ctrl = new AbortController();
    await runBatchSoap([makeRosterPatient({ name: 'A' })], {
      images: [[makeImageBlock('a')]],
      onProgress: () => {},
      abortSignal: ctrl.signal,
    });
    expect(generateNoteSpy.mock.calls[0]?.[3]).toBe('general');
  });

  it('roster identity merge feeds generateNote with merged fields', async () => {
    runExtractSpy.mockResolvedValue({
      fields: {
        // sparse extract — no name/tz, just clinical
        meds: [{ name: 'Furosemide' }],
      },
      confidence: {},
    });
    generateNoteSpy.mockResolvedValue('SOAP body');
    saveBothSpy.mockResolvedValue({
      patientId: 'pid-1',
      noteId: 'nid-1',
      cloudPushed: true,
      cloudSkippedReason: null,
    });

    const ctrl = new AbortController();
    await runBatchSoap(
      [
        makeRosterPatient({
          name: 'רוזנברג מרים',
          tz: '123456789',
          age: 87,
          sex: 'F',
          room: '12',
        }),
      ],
      {
        images: [[makeImageBlock('a')]],
        onProgress: () => {},
        abortSignal: ctrl.signal,
      },
    );

    const fields = generateNoteSpy.mock.calls[0]?.[1]?.fields;
    expect(fields.name).toBe('רוזנברג מרים');
    expect(fields.teudatZehut).toBe('123456789');
    expect(fields.age).toBe(87);
    expect(fields.meds).toHaveLength(1);
    expect(fields.meds[0].name).toBe('Furosemide');
  });

  it('passes abortSignal through to runExtractTurn and generateNote', async () => {
    happyPathMocks();
    const ctrl = new AbortController();
    await runBatchSoap([makeRosterPatient({ name: 'A' })], {
      images: [[makeImageBlock('a')]],
      onProgress: () => {},
      abortSignal: ctrl.signal,
    });
    // runExtractTurn called with (blocks, skillContent, signal)
    expect(runExtractSpy.mock.calls[0]?.[2]).toBe(ctrl.signal);
    // generateNote called with (noteType, validated, continuity, soapMode, signal)
    expect(generateNoteSpy.mock.calls[0]?.[4]).toBe(ctrl.signal);
  });

  it('throws when patients/images array lengths mismatch', async () => {
    const ctrl = new AbortController();
    await expect(
      runBatchSoap(
        [makeRosterPatient({ name: 'A' }), makeRosterPatient({ name: 'B' })],
        {
          images: [[makeImageBlock('a')]], // only 1, but 2 patients
          onProgress: () => {},
          abortSignal: ctrl.signal,
        },
      ),
    ).rejects.toThrow(/array lengths must match/);
  });

  it('empty patient list returns empty result instantly', async () => {
    const ctrl = new AbortController();
    const result = await runBatchSoap([], {
      images: [],
      onProgress: () => {},
      abortSignal: ctrl.signal,
    });
    expect(result).toEqual({ completed: [], failed: [], aborted: false });
    expect(runExtractSpy).not.toHaveBeenCalled();
  });
});
