import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = 'tests/extraction/fixtures';
const RECORDED = 'tests/extraction/recorded';

describe('extraction accuracy (replay harness)', () => {
  const fixtureList = existsSync(FIXTURES)
    ? readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))
    : [];

  if (fixtureList.length === 0) {
    it.skip('no fixtures yet — add curated AZMA ground-truth to tests/extraction/fixtures/', () => {
      /* skipped */
    });
    return;
  }

  for (const fname of fixtureList) {
    it(`replays ${fname} and matches critical fields`, () => {
      const truth = JSON.parse(readFileSync(join(FIXTURES, fname), 'utf8'));
      const recordedPath = join(RECORDED, fname);
      if (!existsSync(recordedPath)) {
        console.warn(`SKIP ${fname}: no recorded response at ${recordedPath}`);
        return;
      }
      const recorded = JSON.parse(readFileSync(recordedPath, 'utf8'));

      expect(recorded.fields.name).toBe(truth.fields.name);
      expect(recorded.fields.teudatZehut).toBe(truth.fields.teudatZehut);
      expect(recorded.fields.age).toBe(truth.fields.age);

      const recMeds = (recorded.fields.meds ?? [])
        .map((m: { name: string }) => m.name)
        .sort();
      const truMeds = (truth.fields.meds ?? [])
        .map((m: { name: string }) => m.name)
        .sort();
      expect(recMeds).toEqual(truMeds);
    });
  }

  it('ship gate: at least 20 fixtures', () => {
    // Soft gate: skipped if zero, hard gate after fixtures start arriving.
    if (fixtureList.length === 0) return;
    expect(fixtureList.length).toBeGreaterThanOrEqual(20);
  });
});
