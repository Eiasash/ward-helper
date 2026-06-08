import { describe, it, expect } from 'vitest';
import { checkStopp } from '@/safety/stopp';
import { checkStart } from '@/safety/start';
import type { Med, PatientContext } from '@/safety/types';

const MED = (name: string): Med => ({ name });

/**
 * Cross-engine DOAC drift-lock.
 *
 * The STOPP NSAID-DOAC rule (critical) and the START AF-anticoag rule must agree
 * on which DOACs they recognize. They use two SEPARATE regexes (STOPP's is
 * DOAC-only; START's also carries warfarin and must NOT be collapsed into a
 * shared DOAC pattern), so the only thing keeping them in sync is this test.
 *
 * The drift this guards: edoxaban shipped in START's ANTICOAG_RE but was missing
 * from STOPP's APIXABAN_RE, so a Lixiana + NSAID patient got NO critical-bleed
 * flag while a Lixiana-only AF patient was (correctly) not nagged to add one.
 * Every DOAC below must (a) trigger the critical STOPP bleed rule when paired
 * with an NSAID, and (b) suppress the START "add anticoagulant" advice in AF.
 */
const DOACS = ['apixaban', 'rivaroxaban', 'dabigatran', 'edoxaban'];
const AF_CTX: PatientContext = { age: 80, conditions: ['atrial fibrillation'] };

describe('DOAC cross-engine coverage', () => {
  for (const doac of DOACS) {
    it(`${doac}: STOPP flags NSAID + ${doac} as critical`, () => {
      const hit = checkStopp([MED('ibuprofen'), MED(doac)], {}).find(
        (h) => h.code === 'STOPP-NSAID-DOAC',
      );
      expect(hit, `${doac} not recognized by STOPP NSAID-DOAC rule`).toBeTruthy();
      expect(hit?.severity).toBe('critical');
    });

    it(`${doac}: START does not nag to add anticoagulant in AF`, () => {
      const hit = checkStart([MED(doac)], AF_CTX).find((h) => h.code === 'START-AF-NO-AC');
      expect(hit, `${doac} not recognized by START anticoag suppressor`).toBeUndefined();
    });
  }
});
