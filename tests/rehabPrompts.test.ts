import { describe, it, expect } from 'vitest';

import { rehabAugmentationFor } from '@/notes/rehabPrompts';
import { buildSoapPromptPrefix } from '@/notes/orchestrate';

describe('rehabAugmentationFor', () => {
  it('returns empty string for general (no augmentation)', () => {
    expect(rehabAugmentationFor('general')).toBe('');
  });

  it('returns a non-empty Hebrew/English block for each rehab-* mode', () => {
    for (const mode of [
      'rehab-FIRST',
      'rehab-STABLE',
      'rehab-COMPLEX',
      'rehab-HD-COMPLEX',
    ] as const) {
      const aug = rehabAugmentationFor(mode);
      expect(aug.length).toBeGreaterThan(0);
      // Mode marker so the model can introspect which block applied.
      expect(aug).toContain(`Mode: ${mode}`);
      // Scaffold-notice is the explicit "this is a stub" marker the next
      // engineer needs to remove when the SKILL.md content lands.
      expect(aug).toContain('SKILL.md');
    }
  });

  it('mentions HD-specific bedside hints in the HD-COMPLEX augmentation', () => {
    const hd = rehabAugmentationFor('rehab-HD-COMPLEX');
    expect(hd).toMatch(/fistula|HD\b/i);
  });
});

describe('buildSoapPromptPrefix wiring (Phase C plumbing)', () => {
  it('produces identical output for omitted vs explicit "general" mode', () => {
    const a = buildSoapPromptPrefix(null);
    const b = buildSoapPromptPrefix(null, 'general');
    expect(a).toBe(b);
  });

  it('appends the rehab-FIRST marker for rehab-FIRST mode', () => {
    const general = buildSoapPromptPrefix(null, 'general');
    const first = buildSoapPromptPrefix(null, 'rehab-FIRST');
    expect(first).not.toBe(general);
    expect(first).toContain('Mode: rehab-FIRST');
  });

  it('appends the rehab-HD-COMPLEX marker for rehab-HD-COMPLEX mode', () => {
    const hd = buildSoapPromptPrefix(null, 'rehab-HD-COMPLEX');
    expect(hd).toContain('Mode: rehab-HD-COMPLEX');
    expect(hd).toMatch(/fistula|HD\b/i);
  });
});

// Acceptance test from the Phase C spec:
//   "open Marciano patient (HD-rehab-complex), generate SOAP, verify it
//    uses HD-COMPLEX template not generic."
//
// This is intentionally `test.todo` and not a passing test. The wiring is
// live (a HD-COMPLEX mode does append a marker block to SOAP_STYLE), but
// the *materially differentiated* HD-COMPLEX prompt requires the
// rehab-quickref SKILL.md content. Until that lands at
// /mnt/skills/user/rehab-quickref/SKILL.md (or equivalent), the emitted
// SOAP for a Marciano-class HD-rehab patient will be string-equivalent
// to 'general' modulo a short directive header — which is *not* what the
// spec asks the test to assert.
//
// When the SKILL.md lands:
//   1. Replace REHAB_AUGMENTATIONS in src/notes/rehabPrompts.ts with the
//      ported content
//   2. Convert this test.todo to a real test that mocks generateNote
//      against a Marciano-shaped fixture and asserts material divergence
//      between modes (e.g., an HD-only directive that 'general' lacks)
//   3. Update src/notes/rehabPrompts.ts header comment to drop the
//      "STATUS — scaffolding" callout
it.todo(
  'Marciano (HD-rehab-complex) — emitted SOAP uses HD-COMPLEX template not generic ' +
    '(blocked: requires rehab-quickref SKILL.md content port)',
);
