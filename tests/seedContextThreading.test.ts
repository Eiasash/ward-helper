/**
 * v1.41.0 — locks the threading of `seedContext` (the runtime
 * "השתמש בהערת אתמול" toggle on Review) through the prompt-prefix builders.
 *
 * Contract:
 *   1. `buildSoapPromptPrefix(continuity, mode, seedContext)` — when
 *      seedContext is a prefill SeedDecision, the returned prefix contains
 *      the durable-fields lines from `buildSeedBlocks`.
 *   2. `buildPromptPrefix('soap', continuity, mode, seedContext)` —
 *      delegates to `buildSoapPromptPrefix` with the seedContext.
 *   3. seedContext = null is a no-op (preserves v1.40.x behavior).
 *   4. Non-soap note types ignore seedContext entirely (the toggle lives on
 *      Review under the SOAP-only branch).
 *   5. The body of MOST RECENT SOAP appears at most ONCE in the prompt —
 *      either via continuity or, in this design, never via seedContext.
 *      Belt-and-braces against the duplication hazard the architecture
 *      decision was made to avoid.
 */
import { describe, it, expect } from 'vitest';

import {
  buildPromptPrefix,
  buildSoapPromptPrefix,
} from '@/notes/orchestrate';
import type { SeedDecision } from '@/notes/seedFromYesterdaySoap';
import type { ContinuityContext } from '@/notes/continuity';

const PREFILL: SeedDecision = {
  kind: 'prefill',
  bodyContext: 'YESTERDAY-BODY-MARKER-MUST-NOT-APPEAR-TWICE',
  patientFields: {
    handoverNote: 'DNR/DNI',
    planLongTerm: 'continue Apixaban + statin',
    clinicalMeta: { pmhSummary: 'HFrEF + CKD-3' },
  },
};

const NO_PREFILL: SeedDecision = {
  kind: 'no-prefill',
  reason: 'no-history',
};

function makeContinuityWithSoap(): ContinuityContext {
  const recentSoap = {
    id: 's1',
    patientId: 'p1',
    type: 'soap' as const,
    bodyHebrew: 'YESTERDAY-BODY-MARKER-MUST-NOT-APPEAR-TWICE',
    structuredData: {},
    createdAt: 200,
    updatedAt: 200,
  };
  return {
    patient: {
      id: 'p1',
      name: 'דוגמה',
      teudatZehut: '111111118',
      dob: '',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
    admission: {
      id: 'a1',
      patientId: 'p1',
      type: 'admission' as const,
      bodyHebrew: 'גוף הקבלה',
      structuredData: {},
      createdAt: 100,
      updatedAt: 100,
    },
    priorSoaps: [recentSoap],
    mostRecentSoap: recentSoap,
    episodeStart: 100,
  };
}

describe('seedContext threading — buildSoapPromptPrefix', () => {
  it('includes durable-fields lines when seedContext is prefill', () => {
    const prefix = buildSoapPromptPrefix(null, 'general', PREFILL);
    expect(prefix).toContain('handoverNote: DNR/DNI');
    expect(prefix).toContain('planLongTerm: continue Apixaban + statin');
    expect(prefix).toContain('clinicalMeta: {"pmhSummary":"HFrEF + CKD-3"}');
  });

  it('omits durable-fields lines when seedContext is no-prefill', () => {
    const prefix = buildSoapPromptPrefix(null, 'general', NO_PREFILL);
    expect(prefix).not.toContain('handoverNote:');
    expect(prefix).not.toContain('planLongTerm:');
  });

  it('omits durable-fields lines when seedContext is null (default behavior)', () => {
    const prefix = buildSoapPromptPrefix(null, 'general');
    expect(prefix).not.toContain('handoverNote:');
    expect(prefix).not.toContain('planLongTerm:');
  });

  it('threads seedContext through the existing-episode path (continuity + recent SOAP)', () => {
    const ctx = makeContinuityWithSoap();
    const prefix = buildSoapPromptPrefix(ctx, 'general', PREFILL);
    // Continuity injection still happens.
    expect(prefix).toContain('MOST RECENT SOAP');
    // Durable fields land too.
    expect(prefix).toContain('handoverNote: DNR/DNI');
  });

  it('the MOST RECENT SOAP body appears at most once even with seedContext on (no duplication)', () => {
    const ctx = makeContinuityWithSoap();
    const prefix = buildSoapPromptPrefix(ctx, 'general', PREFILL);
    // Body comes from continuity; seedContext does NOT re-print it.
    const occurrences = prefix.split('YESTERDAY-BODY-MARKER-MUST-NOT-APPEAR-TWICE').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('seedContext threading — buildPromptPrefix dispatch', () => {
  it('soap note type forwards seedContext to buildSoapPromptPrefix', () => {
    const prefix = buildPromptPrefix('soap', null, 'general', PREFILL);
    expect(prefix).toContain('handoverNote: DNR/DNI');
  });

  it('admission note type ignores seedContext (toggle lives on the SOAP-only branch)', () => {
    const prefix = buildPromptPrefix('admission', null, 'general', PREFILL);
    expect(prefix).not.toContain('handoverNote:');
  });

  it('discharge note type ignores seedContext', () => {
    const prefix = buildPromptPrefix('discharge', null, 'general', PREFILL);
    expect(prefix).not.toContain('handoverNote:');
  });

  it('consult note type ignores seedContext', () => {
    const prefix = buildPromptPrefix('consult', null, 'general', PREFILL);
    expect(prefix).not.toContain('handoverNote:');
  });

  it('case note type ignores seedContext', () => {
    const prefix = buildPromptPrefix('case', null, 'general', PREFILL);
    expect(prefix).not.toContain('handoverNote:');
  });

  it('default seedContext omitted preserves v1.40.x output (no durable lines)', () => {
    const prefix = buildPromptPrefix('soap', null, 'general');
    expect(prefix).not.toContain('handoverNote:');
  });
});
