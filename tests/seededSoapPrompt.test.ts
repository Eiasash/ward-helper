/**
 * SOAP seed-blocks helper — locks the optional "durable patient context"
 * preamble that gets PREPENDED ahead of CHAMELEON_RULES + SOAP_STYLE when
 * the caller has decided to seed today's draft.
 *
 * v1.41.0: the runtime "השתמש בהערת אתמול" toggle on Review now drives
 * this through `generateNote` → `buildPromptPrefix` → `buildSoapPromptPrefix`
 * → `buildSeedBlocks`. Yesterday's SOAP body itself is intentionally NOT
 * re-emitted here because `buildSoapPromptPrefix` already injects
 * `MOST RECENT SOAP (date)` from the same `resolveContinuity` source —
 * re-printing `bodyContext` would duplicate the body and confuse the model.
 *
 * What we lock here:
 * - empty string for any non-prefill seedContext (callers concat unconditionally)
 * - durable patient fields (handoverNote / planLongTerm / clinicalMeta) appear
 *   in the labelled lines so the model uses them directly instead of
 *   re-deriving from yesterday's prose
 * - bodyContext is NOT re-emitted (architecture decision — see comment in
 *   `buildSeedBlocks` jsdoc)
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

  it('includes patient durable fields when prefill', () => {
    const block = buildSeedBlocks({
      kind: 'prefill',
      bodyContext: 'yesterday body verbatim',
      patientFields: {
        handoverNote: 'DNR',
        planLongTerm: 'continue ASA',
        clinicalMeta: { pmhSummary: 'HFpEF' },
      },
    });
    expect(block).toContain('handoverNote: DNR');
    expect(block).toContain('planLongTerm: continue ASA');
    expect(block).toContain('clinicalMeta: {"pmhSummary":"HFpEF"}');
  });

  it('does NOT re-emit bodyContext (continuity covers MOST RECENT SOAP injection)', () => {
    const block = buildSeedBlocks({
      kind: 'prefill',
      bodyContext: 'yesterday body verbatim — must NOT appear here',
      patientFields: {
        handoverNote: 'DNR',
        planLongTerm: '',
        clinicalMeta: {},
      },
    });
    expect(block).not.toContain('yesterday body verbatim');
    // The "do NOT copy verbatim" sentinel was tied to the old body-block
    // emission. With the body coming exclusively from continuity, that
    // instruction lives in `buildSoapPromptPrefix` — keep it out of
    // `buildSeedBlocks` to avoid two copies of similar guidance.
    expect(block).not.toContain('do NOT copy verbatim');
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
