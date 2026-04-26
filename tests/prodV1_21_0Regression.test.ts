import { describe, it, expect } from 'vitest';
import { extractJsonObject, extractJsonStrategy } from '@/agent/loop';
import { PROD_V1_21_0_PROSE_PREAMBLE } from './fixtures/prodV1_21_0_prosePreamble';

/**
 * Regression test backed by an exact byte-for-byte production payload from
 * ward-helper v1.21.0 (debug log captured 2026-04-26). Synthetic tests in
 * extractJsonObject.test.ts verify the algorithm against constructed inputs;
 * THIS test verifies it against the exact failure mode we shipped a fix for.
 *
 * Why this matters: synthetic tests can pass while the real model behavior
 * still breaks. A fixture pinned to actual production data closes that gap.
 *
 * If this test ever fails it means EITHER (a) we broke parsing of a real
 * production payload — never acceptable — OR (b) we genuinely intend to
 * change behavior, in which case update the fixture in the same commit and
 * document why in the test description.
 */

describe('regression: v1.21.0 production prose-preamble payload', () => {
  it('extracts the JSON envelope from prose+fence preamble (the actual prod failure)', () => {
    // Eyeball: the model text starts with "I'll read through all four images
    // carefully." and contains 28 paragraphs of "Pass 1 / Pass 2" reasoning
    // before the ```json fence. Pre-v1.21.1 this raised "Unexpected token 'I'".
    const result = extractJsonObject(PROD_V1_21_0_PROSE_PREAMBLE);
    const parsed = JSON.parse(result);
    expect(parsed.fields).toBeDefined();
    expect(parsed.confidence).toBeDefined();
  });

  it('reports the correct extraction strategy ("fenced") for the prod payload', () => {
    // The payload has prose preamble + a ```json fence. Strategy 1 fails
    // because the body doesn't start with `{`. Strategy 2 (fenced block
    // anywhere) wins. Strategy 3 (brace walk) and 4 (fallback) shouldn't
    // need to be reached.
    //
    // This pin matters: if a future change to extractJsonStrategy makes this
    // payload resolve via 'brace' instead, that's not a bug per se — but it
    // IS a sign that the strategy ordering shifted and we should know.
    const { strategy } = extractJsonStrategy(PROD_V1_21_0_PROSE_PREAMBLE);
    expect(strategy).toBe('fenced');
  });

  it('preserves identity fields exactly as the model emitted them', () => {
    // Verifies the 9-digit Israeli ID, Hebrew name, age, and sex round-trip
    // without corruption. Hebrew RTL handling is one place v1.x has had
    // bugs before (bidi.ts arrow strip, mid-2025).
    const parsed = JSON.parse(extractJsonObject(PROD_V1_21_0_PROSE_PREAMBLE));
    expect(parsed.fields.name).toBe('פונארו אלדד');
    expect(parsed.fields.teudatZehut).toBe('011895745');
    expect(parsed.fields.age).toBe(87);
    expect(parsed.fields.sex).toBe('M');
    expect(parsed.fields.dob).toBe('14/08/1938');
  });

  it('preserves the meds array with Hebrew + English mixed content', () => {
    // The fixture contains 7 med entries spanning English drug names,
    // Hebrew dose qualifiers, and "1Xd" frequency notation. Verifies the
    // array survives extraction.
    const parsed = JSON.parse(extractJsonObject(PROD_V1_21_0_PROSE_PREAMBLE));
    expect(Array.isArray(parsed.fields.meds)).toBe(true);
    expect(parsed.fields.meds.length).toBe(7);
    expect(parsed.fields.meds[0]).toEqual({
      name: 'Warfarin',
      dose: '2.5 mg',
      freq: 'once',
    });
  });

  it('preserves the labs array including Hebrew clinical context', () => {
    // 10 lab entries; CRP is the abnormality flag the doc cares about.
    const parsed = JSON.parse(extractJsonObject(PROD_V1_21_0_PROSE_PREAMBLE));
    expect(parsed.fields.labs.length).toBe(10);
    const crp = parsed.fields.labs.find((l: { name: string }) => l.name === 'C-Reactive Protein');
    expect(crp).toEqual({ name: 'C-Reactive Protein', value: '10.48', unit: 'mg/dL' });
  });

  it('preserves the confidence map verbatim — critical for the safety guard', () => {
    // The fixture has all three critical-3 keys at "high". This is the input
    // the wrong-patient guard at orchestrate.ts:assertExtractIsSafe will see.
    // If extraction ever drops these keys, the low-confidence rule silently
    // becomes a no-op (see deliberate-design comment in extractSafety.test.ts).
    const parsed = JSON.parse(extractJsonObject(PROD_V1_21_0_PROSE_PREAMBLE));
    expect(parsed.confidence).toEqual({
      name: 'high',
      teudatZehut: 'high',
      age: 'high',
    });
  });
});
