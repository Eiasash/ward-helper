/**
 * Mode-specific prompt augmentations for rehab SOAP follow-ups.
 *
 * STATUS — scaffolding (Phase C). The spec
 * (docs/superpowers/specs/2026-04-23-soap-daily-followup-design.md +
 * the 2026-05-06 batch instructions) directs us to port content from a
 * `rehab-quickref` skill at /mnt/skills/user/rehab-quickref/SKILL.md. As
 * of this commit that file does NOT exist on disk and no equivalent
 * Hebrew clinical content lives anywhere in this repo. Per the global
 * rule "never paraphrase or fabricate option/clinical content", these
 * augmentations are intentionally minimal — they restate the user's own
 * spec language ("FIRST = full SOAP with all # headers" / "STABLE…
 * stepdown — dense paragraph S, location-conditional O, A only changed
 * problems with terse drug recs") and otherwise fall through to the
 * existing SOAP_STYLE prefix in orchestrate.ts.
 *
 * When the SKILL.md lands:
 *   1. Read /mnt/skills/user/rehab-quickref/SKILL.md
 *   2. Replace each REHAB_AUGMENTATIONS[mode] string with the verbatim
 *      mode-specific block from the skill.
 *   3. Update the test in tests/rehabPrompts.test.ts ("Marciano HD
 *      acceptance") from `test.todo` → `test`.
 *   4. Bump the patch version. No other call-site changes are needed —
 *      mode plumbing is already live.
 *
 * Behavioral contract today: a rehab-* mode produces a SOAP prompt
 * that is string-equivalent to 'general' modulo a short Hebrew
 * directive header. The model still uses SOAP_STYLE's full instructions
 * for daily-asks, *domain bullets, capsule-on-first-followup, etc.
 */

import type { SoapMode } from './soapMode';

const SCAFFOLD_NOTICE_HE =
  '— מצב SOAP שיקום (טיוטה): הנחיות מצב מלאות יוטמעו לאחר העלאת SKILL.md של rehab-quickref. כעת המודל משתמש בפורמט SOAP הסטנדרטי. —';

/**
 * Each value is APPENDED to the existing SOAP_STYLE block (after the
 * continuity context, before the final emit instructions). Keep them
 * short — long appended blocks dilute SOAP_STYLE's directives and
 * inflate token cost without proportional benefit.
 */
const REHAB_AUGMENTATIONS: Record<Exclude<SoapMode, 'general'>, string> = {
  // FIRST = full SOAP with all # headers — buildSoapPromptPrefix already
  // emits the SZMC patient capsule on the first follow-up. The hint
  // below is a defensive reinforcement so a 'rehab-FIRST' override on a
  // patient WITHOUT continuity context (e.g., admission note not yet in
  // IDB) still gets the capsule framing.
  'rehab-FIRST': [
    SCAFFOLD_NOTICE_HE,
    'Mode: rehab-FIRST. Treat as the patient\'s first daily SOAP in the rehab ward. Open A with the SZMC patient capsule (3-4 lines: demographics + living situation + chronic dx + baseline ADL + acute event leading to rehab admission). Then "בעיות:" and *domain bullets. Use full # headers per the SOAP_STYLE block above.',
  ].join('\n'),

  // STABLE / COMPLEX / HD-COMPLEX share the spec's "stepdown" frame —
  // dense paragraph S, location-conditional O, A only on changed
  // problems. The existing follow-up branch in buildSoapPromptPrefix
  // already handles trajectory tracking (Same/Changed/Resolved/New),
  // so we restate the stepdown discipline rather than re-define it.
  'rehab-STABLE': [
    SCAFFOLD_NOTICE_HE,
    'Mode: rehab-STABLE. Stepdown style — dense paragraph S, O bedside-only and brief, A only on *domains that CHANGED vs the prior SOAP. P short and terse, drug recs as drug-cards only when changing dose. No capsule (this is a follow-up).',
  ].join('\n'),

  'rehab-COMPLEX': [
    SCAFFOLD_NOTICE_HE,
    'Mode: rehab-COMPLEX. Stepdown style with explicit attention to the recent escalation: foreground the changed *domain in A, justify the plan in 1-2 lines, and list specific labs/imaging awaited. Drug recs terse — drug name + dose + Hebrew instruction. No capsule.',
  ].join('\n'),

  'rehab-HD-COMPLEX': [
    SCAFFOLD_NOTICE_HE,
    'Mode: rehab-HD-COMPLEX. Stepdown style + HD-specific bedside additions: include fistula thrill+bruit in O when access is on this side; mention HD days + dry-weight delta if relevant; flag pre/post-HD electrolyte concerns in A only when actionable today. No capsule.',
  ].join('\n'),
};

/**
 * Returns the augmentation string for a given mode, or empty string for
 * 'general'. Empty string means "no augmentation" — the SOAP prompt is
 * exactly what buildSoapPromptPrefix would have produced pre-Phase-C.
 */
export function rehabAugmentationFor(mode: SoapMode): string {
  if (mode === 'general') return '';
  return REHAB_AUGMENTATIONS[mode];
}
