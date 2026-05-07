import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the spy is available inside the vi.mock factory below.
const { callAnthropicSpy } = vi.hoisted(() => ({
  callAnthropicSpy: vi.fn(),
}));

// rosterImport.ts now imports callClaude from @/ai/dispatch (v1.39.0
// single-chokepoint refactor). Mocks attach to dispatch.
vi.mock('@/ai/dispatch', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    callClaude: callAnthropicSpy,
  };
});

import {
  importViaPaste,
  importViaManual,
  importViaOcr,
  type ManualRow,
} from '@/notes/rosterImport';
import {
  setRoster,
  getRoster,
  clearRoster,
  ageOutRoster,
  ROSTER_AGE_OUT_MS,
  type RosterPatient,
} from '@/storage/roster';
import { resetDbForTests } from '@/storage/indexed';

describe('importViaPaste — pipe format', () => {
  it('parses 5 rows with all 7 fields mapped', () => {
    const text = `
123456789 | רוזנברג מרים | 87 | 12 | A | 5 | Hip fracture s/p Hemiarthroplasty
234567890 | לוי דוד | 79 | 12 | B | 3 | CHF exacerbation
345678901 | כהן אברהם | 91 | 14 | A | 12 | Post-CVA rehab
456789012 | פרץ רחל | 68 | 14 | B | 7 | Decompensated cirrhosis
567890123 | אבני יוסף | 84 | 16 | A | 2 | Pneumonia
    `.trim();

    const rows = importViaPaste(text);
    expect(rows).toHaveLength(5);

    expect(rows[0]).toMatchObject({
      tz: '123456789',
      name: 'רוזנברג מרים',
      age: 87,
      room: '12',
      bed: 'A',
      losDays: 5,
      dxShort: 'Hip fracture s/p Hemiarthroplasty',
      sourceMode: 'paste',
    });
    expect(rows[0]?.id).toBeTruthy();
    expect(rows[0]?.importedAt).toBeGreaterThan(0);
  });

  it('drops the header row when first cell is "id"/"name"/"שם"', () => {
    const text = `
id | name | age | room | bed | los | dx
123456789 | רוזנברג מרים | 87 | 12 | A | 5 | Hip fracture
    `.trim();
    const rows = importViaPaste(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('רוזנברג מרים');
  });

  it('nulls out a non-9-digit "id" cell rather than storing garbage in tz', () => {
    const text = '12345 | שם מטופל | 80 | 12 | A | 3 | Dx';
    const rows = importViaPaste(text);
    expect(rows[0]?.tz).toBeNull();
  });
});

describe('importViaPaste — AZMA TSV grid format', () => {
  it('detects header row by Hebrew column names and parses subsequent rows', () => {
    // tab-separated, 7 cols
    const lines = [
      'חדר\tמיטה\tשם\tת.ז.\tגיל\tימי אשפוז\tאבחנה',
      '12\tA\tרוזנברג מרים\t123456789\t87\t5\tHip fracture',
      '12\tB\tלוי דוד\t234567890\t79\t3\tCHF',
    ];
    const text = lines.join('\n');
    const rows = importViaPaste(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      room: '12',
      bed: 'A',
      name: 'רוזנברג מרים',
      tz: '123456789',
      age: 87,
      losDays: 5,
      dxShort: 'Hip fracture',
      sourceMode: 'paste',
    });
  });

  it('returns [] when no Hebrew/English column header tokens match', () => {
    // tab-separated but columns aren't recognized
    const text = 'foo\tbar\tbaz\n1\t2\t3';
    expect(importViaPaste(text)).toEqual([]);
  });

  it('skips rows missing a name', () => {
    const text = ['חדר\tשם\tגיל', '12\t\t87', '14\tלוי דוד\t79'].join('\n');
    const rows = importViaPaste(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('לוי דוד');
  });

  // AZMA spec §4 columns (חיידק עמיד / צד / מ / etc.) trigger the
  // detector even though they don't carry RosterPatient data — so a
  // real AZMA clipboard paste with documented columns + a שם column
  // still parses, instead of dropping to "פורמט לא מזוהה".
  it('AZMA spec §4 columns fire the detector + שם column drives row extraction', () => {
    const lines = [
      'מחלקה\tחיידק עמיד\tצד\tחדר\tשם\tגיל\tאבחנה',
      'גריאטריה\t\t\t12\tרוזנברג מרים\t87\tHip fracture',
      'גריאטריה\tCRE\t\t14\tלוי דוד\t79\tCHF',
    ];
    const rows = importViaPaste(lines.join('\n'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      room: '12',
      name: 'רוזנברג מרים',
      age: 87,
      dxShort: 'Hip fracture',
    });
    expect(rows[1]?.name).toBe('לוי דוד');
  });
});

describe('importViaPaste — garbage input', () => {
  it('returns [] for a single non-pipe non-tab line (no throw)', () => {
    expect(importViaPaste('just a sentence with no delimiters')).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(importViaPaste('')).toEqual([]);
    expect(importViaPaste('\n\n\n')).toEqual([]);
  });
});

describe('importViaPaste — mixed Hebrew/English numbers', () => {
  it('handles Arabic-Indic digits in age cell', () => {
    // ٨٧ = 87 in Arabic-Indic
    const text = '123456789 | רוזנברג מרים | ٨٧ | 12 | A | 5 | Dx';
    const rows = importViaPaste(text);
    expect(rows[0]?.age).toBe(87);
  });

  it('handles Latin digits as-is', () => {
    const text = '123456789 | לוי דוד | 79 | 14 | B | 3 | Dx';
    const rows = importViaPaste(text);
    expect(rows[0]?.age).toBe(79);
  });
});

describe('importViaManual', () => {
  it('passes through valid rows with id + sourceMode + importedAt added', () => {
    const rows: ManualRow[] = [
      {
        tz: '123456789',
        name: 'רוזנברג מרים',
        age: 87,
        sex: 'F',
        room: '12',
        bed: 'A',
        losDays: 5,
        dxShort: 'Hip fracture',
      },
    ];
    const out = importViaManual(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      tz: '123456789',
      name: 'רוזנברג מרים',
      age: 87,
      sex: 'F',
      room: '12',
      bed: 'A',
      losDays: 5,
      dxShort: 'Hip fracture',
      sourceMode: 'manual',
    });
    expect(out[0]?.id).toBeTruthy();
    expect(out[0]?.importedAt).toBeGreaterThan(0);
  });

  it('drops rows with empty/whitespace-only name', () => {
    const rows: ManualRow[] = [
      { name: '', age: 80 },
      { name: '   ', age: 80 },
      { name: 'לוי דוד', age: 79 },
    ];
    const out = importViaManual(rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('לוי דוד');
  });

  it('nulls out a non-9-digit tz', () => {
    const rows: ManualRow[] = [{ name: 'מטופל', tz: 'p15695' }];
    const out = importViaManual(rows);
    expect(out[0]?.tz).toBeNull();
  });
});

describe('importViaOcr', () => {
  beforeEach(() => {
    callAnthropicSpy.mockReset();
  });

  function fakeFile(): File {
    return new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], // 4 bytes of fake JPEG header
      'test.jpg',
      { type: 'image/jpeg' },
    );
  }

  it('parses the model JSON and maps to RosterPatient[]', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            patients: [
              {
                tz: '123456789',
                name: 'רוזנברג מרים',
                age: 87,
                sex: 'F',
                room: '12',
                bed: 'A',
                losDays: 5,
                dxShort: 'Hip fracture',
              },
              {
                tz: null,
                name: 'לוי דוד',
                age: 79,
                sex: 'M',
                room: '14',
                bed: 'B',
                losDays: null,
                dxShort: 'CHF',
              },
            ],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const rows = await importViaOcr(fakeFile());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      tz: '123456789',
      name: 'רוזנברג מרים',
      age: 87,
      sex: 'F',
      sourceMode: 'ocr',
    });
    expect(rows[1]?.tz).toBeNull();
  });

  // Regression guard: id is a freshly-minted UUID, tz holds the clinical
  // identifier from the model. Same-name collision would let a future
  // refactor like Object.assign(row, parsedJson) silently overwrite the
  // UUID. The fixup that renamed the OCR field id → tz prevents that;
  // this test pins the contract.
  it('id is a UUID and tz is the 9-digit clinical identifier — no field collision', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            patients: [
              { tz: '123456789', name: 'רוזנברג מרים', age: 87 },
            ],
          }),
        },
      ],
      usage: { input_tokens: 50, output_tokens: 50 },
    });
    const rows = await importViaOcr(fakeFile());
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // RFC 4122 v4 UUID — exactly what crypto.randomUUID() produces.
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(row.tz).toBe('123456789');
    // And explicitly: id is NOT the clinical identifier.
    expect(row.id).not.toBe('123456789');
  });

  it('strips a leading ```json fence the model occasionally adds', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [
        {
          type: 'text',
          text:
            '```json\n' +
            JSON.stringify({
              patients: [{ tz: null, name: 'מטופל', age: 80 }],
            }) +
            '\n```',
        },
      ],
      usage: { input_tokens: 50, output_tokens: 100 },
    });
    const rows = await importViaOcr(fakeFile());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('מטופל');
  });

  it('throws Hebrew error on malformed JSON (not silent)', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: 'this is not JSON at all' }],
      usage: { input_tokens: 20, output_tokens: 5 },
    });
    await expect(importViaOcr(fakeFile())).rejects.toThrow(/JSON/);
  });

  it('throws Hebrew error on empty model response', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: '' }],
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    await expect(importViaOcr(fakeFile())).rejects.toThrow(/ריק/);
  });

  it('returns [] when patients field is missing or not an array', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(await importViaOcr(fakeFile())).toEqual([]);
  });

  it('drops OCR rows that have no name', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            patients: [
              { tz: '123456789', name: '', age: 87 },
              { tz: null, name: 'מטופל', age: 80 },
            ],
          }),
        },
      ],
      usage: { input_tokens: 30, output_tokens: 20 },
    });
    const rows = await importViaOcr(fakeFile());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('מטופל');
  });
});

describe('roster store — setRoster / getRoster / clearRoster / ageOutRoster', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  function makeRow(opts: Partial<RosterPatient> & { name: string }): RosterPatient {
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

  it('round-trips a roster via setRoster + getRoster', async () => {
    const rows = [makeRow({ name: 'רוזנברג מרים' }), makeRow({ name: 'לוי דוד' })];
    await setRoster(rows);
    const stored = await getRoster();
    expect(stored).toHaveLength(2);
    expect(stored.map((r) => r.name).sort()).toEqual(['לוי דוד', 'רוזנברג מרים']);
  });

  it('replaces (not merges) on a second setRoster call — snapshot semantics', async () => {
    await setRoster([makeRow({ name: 'אתמול 1' }), makeRow({ name: 'אתמול 2' })]);
    await setRoster([makeRow({ name: 'היום' })]);
    const stored = await getRoster();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('היום');
  });

  it('clearRoster empties the store', async () => {
    await setRoster([makeRow({ name: 'מטופל' })]);
    await clearRoster();
    expect(await getRoster()).toEqual([]);
  });

  it('ageOutRoster drops rows older than 24h, keeps fresh ones', async () => {
    const now = Date.now();
    const old = makeRow({
      name: 'אתמול',
      importedAt: now - ROSTER_AGE_OUT_MS - 60_000,
    });
    const fresh = makeRow({
      name: 'היום',
      importedAt: now - 60_000,
    });
    await setRoster([old, fresh]);
    const dropped = await ageOutRoster(now);
    expect(dropped).toBe(1);
    const remaining = await getRoster();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.name).toBe('היום');
  });

  it('ageOutRoster on empty store is a no-op', async () => {
    expect(await ageOutRoster()).toBe(0);
    expect(await getRoster()).toEqual([]);
  });
});
