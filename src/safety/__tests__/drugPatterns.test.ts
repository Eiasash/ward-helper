import { describe, it, expect } from 'vitest';
import { NSAID_RE, PPI_RE } from '@/safety/drugPatterns';
import { checkBeers } from '@/safety/beers';
import { checkStopp } from '@/safety/stopp';
import type { Med } from '@/safety/types';

const MED = (name: string, extra: Partial<Med> = {}): Med => ({ name, ...extra });

// Regression lock for the 2026-06-05 silent-pass audit. Before the
// drugPatterns.ts hoist, NSAID_RE was duplicated across beers/stopp and missed
// Israeli brands + Hebrew names + COX-2; PPI_RE had drifted between the two.
// These names MUST keep matching, and they MUST fire through both engines.

// Common Israeli-ward NSAIDs that the old pattern silently missed. English
// generics that already matched (ibuprofen/naproxen) are covered elsewhere.
const ISRAELI_NSAIDS = [
  'etodolac',
  'Etopan', // etodolac brand — extremely common on Israeli wards
  'אטופן',
  'etoricoxib',
  'Arcoxia',
  'ארקוקסיה',
  'celecoxib',
  'meloxicam',
  'Mobic',
  'Movalis',
  'וולטרן', // Hebrew Voltaren (diclofenac)
  'דיקלופנק', // Hebrew diclofenac
  'נורופן', // Hebrew Nurofen (ibuprofen)
  'ketoprofen',
  'Ponstan', // mefenamic acid
];

const PPIS = [
  'rabeprazole',
  'dexlansoprazole',
  'אומפרזול',
  'פנטופרזול',
  'לוסק', // Losec
  'קונטרולוק', // Controloc
  'נקסיום', // Nexium
];

describe('drugPatterns — NSAID coverage', () => {
  it.each(ISRAELI_NSAIDS)('NSAID_RE matches "%s"', (name) => {
    expect(NSAID_RE.test(name)).toBe(true);
  });

  it('does NOT match a non-NSAID lookalike (paracetamol)', () => {
    expect(NSAID_RE.test('paracetamol')).toBe(false);
    expect(NSAID_RE.test('acamol')).toBe(false);
  });

  // The headline bug: a Hebrew/brand NSAID in a documented-CKD patient must
  // fire BEERS-NSAID-CKD (critical), not silently pass.
  it.each(['Etopan', 'ארקוקסיה', 'וולטרן'])(
    'BEERS-NSAID-CKD fires for "%s" + documented CKD',
    (nsaid) => {
      const hits = checkBeers([MED(nsaid)], { conditions: ['CKD'] });
      const h = hits.find((x) => x.code === 'BEERS-NSAID-CKD');
      expect(h).toBeTruthy();
      expect(h?.severity).toBe('critical');
    },
  );

  // Same NSAID must also fire the STOPP bleed rules when anticoagulated.
  it.each(['Etopan', 'ארקוקסיה', 'וולטרן'])(
    'STOPP-NSAID-WARFARIN fires for "%s" + warfarin',
    (nsaid) => {
      const hits = checkStopp([MED(nsaid), MED('warfarin')], {});
      expect(hits.find((x) => x.code === 'STOPP-NSAID-WARFARIN')).toBeTruthy();
    },
  );
});

describe('drugPatterns — PPI coverage (cross-engine, no drift)', () => {
  it.each(PPIS)('PPI_RE matches "%s"', (name) => {
    expect(PPI_RE.test(name)).toBe(true);
  });

  // The drift bug: every PPI name must produce the honest "not assessed" notice
  // in BOTH engines, never one-but-not-the-other.
  it.each(PPIS)('"%s" fires BEERS-PPI-LONG and STOPP-PPI-LONG alike', (ppi) => {
    const beers = checkBeers([MED(ppi)], {});
    const stopp = checkStopp([MED(ppi)], {});
    expect(beers.find((h) => h.code === 'BEERS-PPI-LONG')).toBeTruthy();
    expect(stopp.find((h) => h.code === 'STOPP-PPI-LONG')).toBeTruthy();
  });
});
