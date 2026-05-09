/**
 * SOAP seed-blocks helper — locks the optional "yesterday's note + durable
 * patient context" preamble that gets PREPENDED ahead of CHAMELEON_RULES +
 * SOAP_STYLE when the caller has decided to seed today's draft.
 *
 * The helper is currently exported for tests only — runtime wiring of the
 * "השתמש בהערת אתמול" UI entry point is deferred (PR 3 Task 3.8 sub-task B)
 * pending a clean integration point with the existing capture/emit flow.
 *
 * What we lock here:
 * - empty string for any non-prefill seedContext (callers concat unconditionally)
 * - bodyContext appears verbatim
 * - the "do NOT copy verbatim" sentinel is present (without it the model copies
 *   yesterday's S/vitals/labs into today's — defeats the seeding purpose)
 * - durable patient fields (handoverNote / planLongTerm / clinicalMeta) appear
 *   in the labelled lines so the model uses them directly instead of
 *   re-deriving from yesterday's prose
 */
import { describe, it, expect } from 'vitest';
import { buildSeedBlocks } from '@/notes/orchestrate';

describe('SOAP seed blocks', () => {
  it('returns empty string for no-prefill seedContext (no-history)', () => {
    expect(buildSeedBlocks({ kind: 'no-prefill', reason: 'no-history' })).toBe('');
  });

  it('returns empty string for no-prefill seedContext (discharge-gap)', () => {
    expect(buildSeedBlocks({ kind: 'no-prefill', reason: 'discharge-gap' })).toBe('');
  });

  it('includes bodyContext + patient fields when prefill', () => {
    const block = buildSeedBlocks({
      kind: 'prefill',
      bodyContext: 'yesterday body verbatim',
      patientFields: {
        handoverNote: 'DNR',
        planLongTerm: 'continue ASA',
        clinicalMeta: { pmhSummary: 'HFpEF' },
      },
    });
    expect(block).toContain('yesterday body verbatim');
    expect(block).toContain('do NOT copy verbatim');
    expect(block).toContain('handoverNote: DNR');
    expect(block).toContain('planLongTerm: continue ASA');
    expect(block).toContain('clinicalMeta: {"pmhSummary":"HFpEF"}');
  });

  it('emits clinicalMeta as compact JSON (no spaces) — important when the field is empty {} too', () => {
    const block = buildSeedBlocks({
      kind: 'prefill',
      bodyContext: 'b',
      patientFields: { handoverNote: '', planLongTerm: '', clinicalMeta: {} },
    });
    expect(block).toContain('clinicalMeta: {}');
  });
});
