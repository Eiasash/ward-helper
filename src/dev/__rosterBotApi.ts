/**
 * Bot-only roster + by-tz dedup adapter — exposes the existing TSV
 * parser, ת.ז. normalizer, roster store, and by-tz map helper to
 * `window` for Playwright `page.evaluate()` use. Strictly gated on
 * `localStorage['ward-helper.botApi'] === '1'`; the module imports
 * ship in the bundle only via dynamic import from main.tsx, and the
 * attachment function is a strict no-op without the flag set.
 *
 * Required by `scripts/lib/scenRosterImportRace.mjs` to cover the
 * roster-import + by-tz dedup race class — the real ward workflow is
 * a doctor pasting 50 patients from AZMA TSV into the roster import
 * modal. The parser must tolerate adversarial input (malformed ת.ז.,
 * empty names, RTL marks, duplicate rows, missing tabs, mixed line-
 * endings) and the listPatientsByTzMap helper must remain stable as
 * mixed-valid ת.ז. rows accumulate.
 *
 * Probes target three causal invariants:
 *
 *   1. Parser robustness. `importViaPaste` must NOT throw on
 *      adversarial TSV; it returns an array (possibly shorter than the
 *      input row count, since empty-name rows are dropped). A regression
 *      that throws kills the entire roster-import modal preview pane.
 *
 *   2. Dedup invariant. `listPatientsByTzMap` is the by-tz dedup
 *      helper used by saveBoth (src/notes/save.ts) and the morning-
 *      rounds-prep backfill. Its contract: one entry per non-blank ת.ז.;
 *      blank-ת.ז. patients silently skipped; no null keys; duplicates
 *      collapse to the most-recently-updated row. A regression that
 *      leaks null keys or fails to collapse duplicates re-introduces
 *      the v7 by-tz-index ghost-patient bug class.
 *
 *   3. listPatientsByTzMap stability. Must not throw on a fully-
 *      seeded patients store including blank-ת.ז. rows. A regression
 *      that re-introduces an .trim() on null surfaces here first.
 *
 * Security profile — the localStorage gate is the only thing between
 * production users and a window-attached parser + patient writer.
 * Threat model: an XSS payload already has full window access and can
 * call any imported module via bundle archaeology; this surface makes
 * that uplift cheaper but does not introduce a new capability.
 * Production users never set the flag; the attachment IIFE returns
 * immediately if the flag is absent or invalid. Same posture as
 * `__phiBotApi.ts` and `__aiBotApi.ts`.
 *
 * Not a coverage badge for the parser — see tests/rosterImport.test.ts
 * for unit coverage. This file's only purpose is bot-runtime invariant
 * probing.
 */
import { importViaPaste } from '@/notes/rosterImport';
import { normalizeIsraeliTz } from '@/notes/israeliTz';
import {
  setRoster,
  getRoster,
  clearRoster,
  type RosterPatient,
} from '@/storage/roster';
import {
  listPatientsByTzMap,
  putPatient,
  getDb,
  type Patient,
} from '@/storage/indexed';

/**
 * Generator result — what `seedAdversarialAzmaTsv` returns. The TSV
 * string is for the scenario to feed into `importViaPaste`; the
 * `expected*` numbers are oracles the scenario asserts against. They
 * are derived from the same generator so a single source-of-truth
 * change keeps both sides aligned.
 */
export interface AdversarialTsv {
  tsv: string;
  /** Total non-header lines in the TSV. */
  inputRows: number;
  /**
   * Rows the parser is expected to return given current parseAzmaTsv
   * behavior (empty-name rows are dropped at L431 of rosterImport.ts).
   * If the parser regresses to keep empty-name rows, this differs.
   */
  expectedParsedRows: number;
  /**
   * Count of DISTINCT valid Luhn-9 ת.ז. values in the parsed rows.
   * `listPatientsByTzMap` is expected to produce exactly this many
   * entries when the parsed rows are written to the patients store.
   */
  expectedDistinctValidTz: number;
  /** Count of rows whose `tz` field is null after normalization. */
  expectedNullTzRows: number;
  /** For PR-body debug: the adversarial flavors that were injected. */
  injectedFlavors: string[];
}

export interface RosterBotApi {
  /**
   * Generate a synthetic AZMA-style TSV with `n` patient rows that
   * includes deterministic adversarial flavors (5–10% of rows). The
   * generator is seeded by `n` so callers get a reproducible bundle —
   * scenRosterImportRace can re-run the same seed and reproduce
   * findings without race-conditioned RNG. NOT cryptographically
   * random; this is fixture data.
   */
  seedAdversarialAzmaTsv: (n: number) => AdversarialTsv;
  /** Direct handle to the production paste parser. */
  importViaPaste: typeof importViaPaste;
  /** Direct handle to the production ת.ז. normalizer (Luhn-9 check). */
  normalizeIsraeliTz: typeof normalizeIsraeliTz;
  /** Replace the entire roster — atomic clear-then-insert. */
  setRoster: typeof setRoster;
  /** List current roster rows (read seam — flag-off byte-equal). */
  getRoster: typeof getRoster;
  /** Empty the roster. */
  clearRoster: typeof clearRoster;
  /** Direct handle to the by-tz scan helper (the probe target). */
  listPatientsByTzMap: typeof listPatientsByTzMap;
  /** Seed a single patient (used to populate the by-tz probe corpus). */
  putPatient: typeof putPatient;
  /**
   * Convenience: empty the patients store. NOT exported from
   * `@/storage/indexed` because the only legitimate caller is this
   * bot adapter — production code uses `dropPatient` per-id.
   */
  clearPatients: () => Promise<void>;
}

declare global {
  interface Window {
    __rosterBotApi?: RosterBotApi;
  }
}

const BOT_API_FLAG = 'ward-helper.botApi';

// AZMA column header order — `מחלקה` placed FIRST as a `_skip` anchor
// so empty-name rows still have a non-blank leading cell. Without this
// anchor, `importViaPaste`'s per-line `.trim()` strips the leading tab
// off an empty-name row and shifts every subsequent cell left by one,
// silently masking the empty-name regression. The trailing
// `_skip` (רקע) is harmless padding.
//
// Real AZMA grid headers carry many `_skip` columns; this bundle keeps
// a minimal set that still triggers `detectHeaderColumns` (size ≥ 1)
// per rosterImport.ts:387.
const HEADER_ORDER = [
  'מחלקה',
  'שם',
  'ת.ז',
  'גיל',
  'מין',
  'חדר',
  'מיטה',
  'ימי אשפוז',
  'אבחנה',
  'רקע',
] as const;
const TSV_HEADER = HEADER_ORDER.join('\t');

// Hebrew + Latin name fragments. Realistic enough that the parser sees
// non-degenerate content; not real-patient material.
const FIRST_NAMES = ['אבי', 'דוד', 'שרה', 'רחל', 'משה', 'יוסף', 'מרים', 'לאה', 'יעקב', 'יהודה'];
const LAST_NAMES = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אביטל', 'נחום', 'אזולאי', 'דהן', 'אוחנה'];

// Luhn-9 generator: produce a valid Israeli ת.ז. by computing the
// check digit so `normalizeIsraeliTz` accepts it. The Luhn weights are
// [1,2,1,2,1,2,1,2,1] for digits 1..9; sum of (digit * weight, summing
// each two-digit product into a single digit). Verified against
// VALID_TEST_TZ = '123456782' from src/notes/israeliTz.ts (line 38).
//
// Seed must hit distinct first-8-digit prefixes to produce distinct
// ת.ז. values. A naive `100_000_000 + seed` for small seeds keeps the
// first 8 digits identical and the check digit collides, so the
// distinct-tz count would deflate. The 1_234_567 stride spreads small
// seeds across the 9-digit space — verified by inspection over the
// 0..200 range used by the fixture bundle.
function makeValidTz(seed: number): string {
  const base = String(100_000_000 + ((seed * 1_234_567) % 89_999_999));
  const digits = base.split('').map((d) => parseInt(d, 10));
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const w = i % 2 === 0 ? 1 : 2;
    const p = (digits[i] ?? 0) * w;
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  digits[8] = checkDigit;
  return digits.join('');
}

function pseudoRandom(seed: number): () => number {
  // Mulberry32 — deterministic, no global RNG state mutation.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Build the deterministic adversarial TSV. Pure function — used by
 * the bot API surface; exposed indirectly via seedAdversarialAzmaTsv.
 *
 * Adversarial flavors (each fires deterministically by row index so
 * ~14% of rows are adversarial across the bundle; remaining 86% are
 * plain. Deterministic placement means two `seedAdversarialAzmaTsv(n)`
 * calls produce byte-identical TSVs):
 *   - duplicate-tz: two rows with the SAME valid ת.ז. (the dedup
 *     probe). Picks from previously-emitted valid-in-TSV ת.ז. so
 *     the duplicate ACTUALLY appears in the parsed output.
 *   - malformed-tz: 8 digits — `normalizeIsraeliTz` returns null.
 *   - empty-name: blank name cell — parser drops at L431.
 *   - rtl-name: name wrapped in RLM bidi marks — parser must accept
 *     (RLM is not WhiteSpace per ECMA-262 §7.2; `.trim()` preserves).
 *   - missing-cells: only 4 of 10 cells — parser must tolerate
 *     `cells[colIdx] === undefined` (rosterImport.ts L398 skip).
 *
 * Two-pass design: pass 1 emits the TSV + tracks per-row state, pass 2
 * derives the oracles. Keeps the oracle in sync with the TSV by
 * construction — the only fact pass 1 commits to is "what value is in
 * each row's ת.ז. cell after all flavor overrides," and pass 2 reads
 * that, normalizes it, and counts.
 */
interface RowSpec {
  name: string;
  tsvTz: string;
  flavor: string;
}

function buildAdversarialTsv(n: number): AdversarialTsv {
  const rnd = pseudoRandom(n * 7919 + 31);
  const rows: RowSpec[] = [];
  // usedTz collects ת.ז. values that ACTUALLY appear in the TSV (i.e.,
  // post-flavor-override). Empty-name rows' ת.ז. is in the TSV but
  // the row gets dropped at parse — including those is intentional so
  // a duplicate-tz collision against an empty-name row still yields a
  // valid "lone surviving entry" in the parsed output.
  const usedValidTz: string[] = [];

  for (let i = 0; i < n; i++) {
    const flavor = pickFlavor(rnd(), i);
    const first = FIRST_NAMES[(i * 17) % FIRST_NAMES.length] ?? 'אבי';
    const last = LAST_NAMES[(i * 23) % LAST_NAMES.length] ?? 'כהן';
    let name = `${first} ${last}`;
    let tsvTz: string;

    if (flavor === 'duplicate-tz' && usedValidTz.length > 0) {
      // Re-use an existing valid ת.ז. Don't push — duplicates don't
      // create new "claimed" entries for later duplicates to pick from.
      tsvTz = usedValidTz[i % usedValidTz.length]!;
    } else if (flavor === 'malformed-tz') {
      tsvTz = '12345678';
      // Do NOT push — '12345678' is not a valid ת.ז. so later
      // duplicate-tz rows would pick garbage if we did.
    } else {
      tsvTz = makeValidTz(i);
      usedValidTz.push(tsvTz);
    }

    if (flavor === 'empty-name') {
      name = '';
    } else if (flavor === 'rtl-name') {
      // U+200F RLM wrapping the Hebrew name. Parser must accept.
      // ECMA-262 §7.2 WhiteSpace doesn't include U+200F so `.trim()`
      // preserves the marks.
      name = `‏${name}‏`;
    }

    rows.push({ name, tsvTz, flavor });
  }

  // Pass 1: emit TSV lines.
  const lines: string[] = [TSV_HEADER];
  for (const r of rows) {
    lines.push(buildLine(r));
  }
  const tsv = lines.join('\n');

  // Pass 2: derive oracles directly from row specs.
  let expectedParsedRows = 0;
  let expectedNullTzRows = 0;
  const distinct = new Set<string>();
  const injectedFlavors: string[] = [];
  for (const r of rows) {
    if (!injectedFlavors.includes(r.flavor)) injectedFlavors.push(r.flavor);
    if (r.name.trim().length === 0) continue; // parser drops at L431
    expectedParsedRows++;
    const normTz = normalizeIsraeliTz(r.tsvTz);
    if (normTz == null) {
      expectedNullTzRows++;
    } else {
      distinct.add(normTz);
    }
  }

  return {
    tsv,
    inputRows: n,
    expectedParsedRows,
    expectedDistinctValidTz: distinct.size,
    expectedNullTzRows,
    injectedFlavors,
  };
}

function buildLine(r: RowSpec): string {
  // Default values for the non-name/tz columns. Realistic enough that
  // the parser sees non-degenerate content; deterministic by name so
  // the bundle is byte-identical for a given n.
  const ageHash = (r.name.length * 7) % 30;
  const cells: Record<(typeof HEADER_ORDER)[number], string> = {
    מחלקה: 'גריאטריה',
    שם: r.name,
    'ת.ז': r.tsvTz,
    גיל: String(65 + ageHash),
    מין: ageHash % 2 === 0 ? 'M' : 'F',
    חדר: String(100 + ageHash),
    מיטה: ageHash % 2 === 0 ? 'A' : 'B',
    'ימי אשפוז': String(1 + (ageHash % 14)),
    אבחנה: `אבחנה ${ageHash}`,
    רקע: '',
  };
  if (r.flavor === 'missing-cells') {
    // Only the first 4 columns. Parser must tolerate
    // cells[colIdx] === undefined for the missing tail.
    return [cells['מחלקה'], cells['שם'], cells['ת.ז'], cells['גיל']].join('\t');
  }
  return HEADER_ORDER.map((h) => cells[h]).join('\t');
}

function pickFlavor(_roll: number, idx: number): string {
  // ~14% adversarial total across the bundle. First-match wins so
  // each flavor appears predictably ~1/n. Deterministic by idx → two
  // `seedAdversarialAzmaTsv(n)` calls yield byte-identical bundles.
  if (idx % 10 === 3) return 'duplicate-tz';
  if (idx % 10 === 5) return 'malformed-tz';
  if (idx % 10 === 7) return 'empty-name';
  if (idx % 17 === 4) return 'rtl-name';
  if (idx % 19 === 6) return 'missing-cells';
  return 'plain';
}

export function attachRosterBotApiIfEnabled(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(BOT_API_FLAG) !== '1') return;
  } catch {
    return;
  }

  const clearPatients: RosterBotApi['clearPatients'] = async () => {
    const db = await getDb();
    await db.clear('patients');
  };

  window.__rosterBotApi = {
    seedAdversarialAzmaTsv: buildAdversarialTsv,
    importViaPaste,
    normalizeIsraeliTz,
    setRoster,
    getRoster,
    clearRoster,
    listPatientsByTzMap,
    putPatient,
    clearPatients,
  };
}

// Re-export types so consumers can `import type { RosterPatient } from
// '@/dev/__rosterBotApi'` without round-tripping to storage/roster.
export type { RosterPatient, Patient };
