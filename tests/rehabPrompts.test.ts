import { describe, it, expect } from 'vitest';

import { rehabAugmentation, REHAB_AUGMENTATIONS } from '@/notes/rehabPrompts';
import { buildSoapPromptPrefix } from '@/notes/orchestrate';

describe('rehabAugmentation', () => {
  it('returns empty string for general (no augmentation)', () => {
    expect(rehabAugmentation('general')).toBe('');
  });

  it('returns a non-empty block for each rehab-* mode', () => {
    for (const mode of [
      'rehab-FIRST',
      'rehab-STABLE',
      'rehab-COMPLEX',
      'rehab-HD-COMPLEX',
    ] as const) {
      expect(rehabAugmentation(mode).length).toBeGreaterThan(0);
    }
  });

  it('exposes a stable REHAB_AUGMENTATIONS map keyed by SoapMode', () => {
    expect(REHAB_AUGMENTATIONS).toHaveProperty('general', '');
    expect(REHAB_AUGMENTATIONS).toHaveProperty('rehab-FIRST');
    expect(REHAB_AUGMENTATIONS).toHaveProperty('rehab-STABLE');
    expect(REHAB_AUGMENTATIONS).toHaveProperty('rehab-COMPLEX');
    expect(REHAB_AUGMENTATIONS).toHaveProperty('rehab-HD-COMPLEX');
  });
});

// ─── Marciano (HD-rehab-complex) acceptance — Phase C fixup 4 ───
//
// Spec: "open Marciano patient (HD-rehab-complex), generate SOAP, verify it
// uses HD-COMPLEX template not generic." With the v4.1 SKILL.md content
// ported, the HD-COMPLEX prompt now carries the drug-disease audit table,
// HD weekday letters, and fistula-specific bedside items that 'general'
// does not — so material divergence is real and assertable.
describe('rehab-quickref v4.1 content invariants', () => {
  it('HD-COMPLEX prompt contains the drug-disease audit table', () => {
    const p = rehabAugmentation('rehab-HD-COMPLEX');
    expect(p).toMatch(/Methotrexate/);
    expect(p).toMatch(/Duloxetine/);
    expect(p).toMatch(/Dipyrone/);
    expect(p).toMatch(/Enoxaparin/);
    expect(p).toMatch(/G6PD/);
    expect(p).toMatch(/ב ד ש/); // HD weekday convention (Sun/Tue/Thu)
  });

  it('HD-COMPLEX is materially different from general (not just a marker block)', () => {
    const general = rehabAugmentation('general');
    const hd = rehabAugmentation('rehab-HD-COMPLEX');
    expect(hd).not.toBe(general);
    // Substantive divergence — well past the "tiny header" threshold the
    // pre-port stub satisfied. v4.1 HD-COMPLEX is several KB of clinical
    // directives.
    expect(hd.length).toBeGreaterThan(2000);
  });

  it('FIRST-DAY prompt enforces the 6-element ortho capsule', () => {
    const p = rehabAugmentation('rehab-FIRST');
    expect(p).toMatch(/6 אלמנטים חובה/);
    expect(p).toMatch(/Hemiarthroplasty/);
    expect(p).toMatch(/CrCl/);
  });

  it('STABLE prompt offers both gym (Variant A) and bedside (Variant B) variants', () => {
    const p = rehabAugmentation('rehab-STABLE');
    expect(p).toMatch(/Variant A/);
    expect(p).toMatch(/Variant B/);
    expect(p).toMatch(/אולם פיזי/);
  });

  it('COMPLEX prompt distinguishes itself from HD-COMPLEX via O-section guidance', () => {
    const c = rehabAugmentation('rehab-COMPLEX');
    expect(c).toMatch(/הבדל מ-HD-COMPLEX/);
  });

  it('universal rules are inherited by every rehab-* mode', () => {
    // Drug names UPPERCASE rule is a universal — appears in every rehab augmentation.
    for (const mode of [
      'rehab-FIRST',
      'rehab-STABLE',
      'rehab-COMPLEX',
      'rehab-HD-COMPLEX',
    ] as const) {
      expect(rehabAugmentation(mode)).toMatch(/UPPERCASE/);
    }
  });
});

describe('buildSoapPromptPrefix wiring (Phase C plumbing)', () => {
  it('produces identical output for omitted vs explicit "general" mode', () => {
    const a = buildSoapPromptPrefix(null);
    const b = buildSoapPromptPrefix(null, 'general');
    expect(a).toBe(b);
  });

  it('appends the rehab-FIRST 6-element ortho rule for rehab-FIRST mode', () => {
    const general = buildSoapPromptPrefix(null, 'general');
    const first = buildSoapPromptPrefix(null, 'rehab-FIRST');
    expect(first).not.toBe(general);
    expect(first).toMatch(/6 אלמנטים חובה/);
  });

  it('appends the HD-COMPLEX drug-disease table for rehab-HD-COMPLEX mode', () => {
    const hd = buildSoapPromptPrefix(null, 'rehab-HD-COMPLEX');
    expect(hd).toMatch(/Methotrexate/);
    expect(hd).toMatch(/פיסטולה/);
  });
});
