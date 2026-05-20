/**
 * Oracle-sync guard for scripts/lib/scenRosterImportRace.mjs.
 *
 * The scenario's HIGH-probe assertions all compare actual parser output
 * to oracle counts that `seedAdversarialAzmaTsv` computes alongside the
 * synthetic TSV. If `parseAzmaTsv` and the oracle drift, the bot
 * scenario starts firing false HIGHs (or worse, missing real
 * regressions). This file pins them in sync.
 *
 * Doubles as the §4 calibration vehicle: comment out `if (!row.name)
 * continue;` at src/notes/rosterImport.ts:431, run THIS test, and the
 * "empty-name rows dropped" assertion goes RED. Restore the guard,
 * confirm GREEN. Both states get documented in the PR body as the
 * detector-armed calibration evidence.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attachRosterBotApiIfEnabled } from '@/dev/__rosterBotApi';

describe('scenRosterImportRace oracle ↔ parseAzmaTsv sync', () => {
  beforeEach(() => {
    try {
      localStorage.setItem('ward-helper.botApi', '1');
    } catch {
      /* localStorage disabled — test cannot run, vitest will mark TODO */
    }
    delete (window as { __rosterBotApi?: unknown }).__rosterBotApi;
    attachRosterBotApiIfEnabled();
  });

  afterEach(() => {
    try {
      localStorage.removeItem('ward-helper.botApi');
    } catch {
      /* localStorage disabled — nothing to clear */
    }
    delete (window as { __rosterBotApi?: unknown }).__rosterBotApi;
  });

  test('oracle expectedParsedRows matches importViaPaste output (50-row bundle)', () => {
    const api = window.__rosterBotApi!;
    const bundle = api.seedAdversarialAzmaTsv(50);
    const parsed = api.importViaPaste(bundle.tsv);
    expect(parsed.length).toBe(bundle.expectedParsedRows);
  });

  test('oracle expectedParsedRows matches importViaPaste output (10-row bundle)', () => {
    const api = window.__rosterBotApi!;
    const bundle = api.seedAdversarialAzmaTsv(10);
    const parsed = api.importViaPaste(bundle.tsv);
    expect(parsed.length).toBe(bundle.expectedParsedRows);
  });

  test('oracle distinct-valid-tz matches deduped output via normalizeIsraeliTz', () => {
    const api = window.__rosterBotApi!;
    const bundle = api.seedAdversarialAzmaTsv(50);
    const parsed = api.importViaPaste(bundle.tsv);
    const distinct = new Set<string>();
    let nullTzCount = 0;
    for (const r of parsed) {
      if (r.tz == null) {
        nullTzCount++;
      } else {
        distinct.add(r.tz);
      }
    }
    expect(distinct.size).toBe(bundle.expectedDistinctValidTz);
    expect(nullTzCount).toBe(bundle.expectedNullTzRows);
  });

  test('importViaPaste does not throw on the adversarial 50-row bundle', () => {
    const api = window.__rosterBotApi!;
    const bundle = api.seedAdversarialAzmaTsv(50);
    expect(() => api.importViaPaste(bundle.tsv)).not.toThrow();
  });

  test('adversarial bundle includes at least one empty-name row (drives the L431 probe)', () => {
    const api = window.__rosterBotApi!;
    const bundle = api.seedAdversarialAzmaTsv(50);
    // The §4 calibration relies on at least one empty-name row in the
    // 50-row bundle so the L431-removed RED state actually surfaces
    // the regression. If the generator's flavor picker stops producing
    // empty-name rows at N=50, the calibration becomes a no-op even
    // when the parser regresses. Lock the contract here.
    expect(bundle.injectedFlavors).toContain('empty-name');
  });

  test('adversarial bundle includes malformed-tz rows that normalize to null', () => {
    const api = window.__rosterBotApi!;
    const bundle = api.seedAdversarialAzmaTsv(50);
    expect(bundle.injectedFlavors).toContain('malformed-tz');
    expect(bundle.expectedNullTzRows).toBeGreaterThan(0);
  });

  test('adversarial bundle includes duplicate-tz rows for the dedup probe', () => {
    const api = window.__rosterBotApi!;
    const bundle = api.seedAdversarialAzmaTsv(50);
    expect(bundle.injectedFlavors).toContain('duplicate-tz');
    // Distinct < parsed-with-valid-tz means at least one collision.
    const parsedRowsWithValidTz = bundle.expectedParsedRows - bundle.expectedNullTzRows;
    expect(bundle.expectedDistinctValidTz).toBeLessThan(parsedRowsWithValidTz);
  });

  test('seedAdversarialAzmaTsv is deterministic for a given n', () => {
    const api = window.__rosterBotApi!;
    const a = api.seedAdversarialAzmaTsv(50);
    const b = api.seedAdversarialAzmaTsv(50);
    expect(a.tsv).toBe(b.tsv);
    expect(a.expectedParsedRows).toBe(b.expectedParsedRows);
    expect(a.expectedDistinctValidTz).toBe(b.expectedDistinctValidTz);
  });
});
