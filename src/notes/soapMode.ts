/**
 * SOAP-mode resolver for the rehab/general split.
 *
 * Phase C scaffolding (PR #pending). The wiring is live; the rehab-mode
 * prompt augmentations in `rehabPrompts.ts` are stubs until the
 * `rehab-quickref` SKILL.md is dropped into ~/.claude/skills/. Until then
 * every rehab-* mode falls through to the existing SOAP_STYLE prefix —
 * i.e. behaviorally identical to 'general'. See PR description.
 *
 * Mode taxonomy:
 *   'general'         — current SOAP_STYLE behavior (geriatric daily handoff
 *                       — works for both rehab and acute wards). The default.
 *   'rehab-FIRST'     — first daily round in a rehab admission. Includes
 *                       SZMC patient capsule. Equivalent to the existing
 *                       "first follow-up after admission" branch in
 *                       buildSoapPromptPrefix.
 *   'rehab-STABLE'    — subsequent stable follow-up. Stepdown style: dense
 *                       paragraph S, location-conditional O, A only on
 *                       changed problems. Today this falls through to the
 *                       existing "follow-up" branch.
 *   'rehab-COMPLEX'   — subsequent follow-up with a recent escalation.
 *                       More A bullets, terse drug recs.
 *   'rehab-HD-COMPLEX' — COMPLEX + HD-specific framing (fistula thrill/bruit,
 *                       HD days, dry weight, access, dialysate, electrolytes
 *                       around HD sessions).
 *
 * Two helpers:
 *   resolveSoapMode(roomHint, manualOverride)
 *     — top-level entry point. Manual override always wins. Otherwise looks
 *       at roomHint (a partial string from the AZMA card or saved Patient
 *       record) for "שיקום" / "rehab" markers. Patient has no `department`
 *       field today (storage/indexed.ts schema v4) — we use room as the
 *       weak proxy. False negatives are absorbed by the manual dropdown.
 *
 *   classifyRehabSubMode(continuity, admissionBody)
 *     — second-stage classifier called only when resolveSoapMode resolved
 *       to rehab-auto (i.e., not manually overridden to a specific sub-mode
 *       and the room hinted rehab). Picks one of FIRST / STABLE / COMPLEX /
 *       HD-COMPLEX based on prior SOAP count and HD/escalation tokens.
 */

import type { ContinuityContext } from './continuity';

export type SoapMode =
  | 'general'
  | 'rehab-FIRST'
  | 'rehab-STABLE'
  | 'rehab-COMPLEX'
  | 'rehab-HD-COMPLEX';

/**
 * What the UI dropdown stores. 'auto' means "let the resolver decide" — it
 * is *not* a SoapMode the prompt builder ever sees. 'general' is an explicit
 * "force general regardless of the rehab signal".
 */
export type SoapModeChoice = 'auto' | 'general' | SoapMode;

const REHAB_ROOM_RE = /שיקום|rehab/i;

/**
 * HD detection covers Hebrew + English transliteration variants. The
 * standalone "HD" lookup is anchored on word boundaries so we don't match
 * inside larger acronyms (CHD, AHD). פיסטולה is included even though it's
 * not strictly HD-only because in this patient population (geriatric rehab
 * post-vascular-access) it's a strong HD proxy.
 */
const HD_RE = /\bHD\b|המודיאליזה|דיאליזה|פיסטולה|hemodialysis|fistula/i;

/**
 * Narrow "recent escalation" lexicon. Conservative on purpose — false
 * positives push the framing toward COMPLEX, which is "more careful";
 * false negatives are caught by the user via the manual dropdown.
 */
const ESCALATION_RE =
  /החמרה|חום\s*\d|זיהום|ספסיס|אנטיביוטיקה חדשה|fever|sepsis|deterioration|escalation/i;

/** A SOAP newer than this counts as "recent" for escalation-flag purposes. */
const RECENT_SOAP_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Top-level mode resolver.
 *
 * @param roomHint   Validated `room` field from the extract (may be empty).
 *                   We look for rehab markers inside it.
 * @param manualOverride  The dropdown's stored value for this patient. When
 *                   not 'auto', it short-circuits everything below.
 *
 * Returns either a concrete SoapMode (if manualOverride pinned one) or the
 * sentinel literal 'rehab-auto' (telling the caller to invoke
 * classifyRehabSubMode with continuity context). 'general' is returned
 * when no rehab signal is detected.
 */
export function resolveSoapMode(
  roomHint: string | null | undefined,
  manualOverride: SoapModeChoice = 'auto',
): SoapMode | 'rehab-auto' {
  if (manualOverride !== 'auto') {
    return manualOverride;
  }
  if (roomHint && REHAB_ROOM_RE.test(roomHint)) {
    return 'rehab-auto';
  }
  return 'general';
}

/**
 * Second-stage classifier. Only call when resolveSoapMode returned the
 * 'rehab-auto' sentinel.
 *
 * Decision order:
 *   1. priorSoaps.length === 0 → rehab-FIRST  (no daily round logged yet)
 *   2. HD signal in admission body OR room   → rehab-HD-COMPLEX
 *   3. Recent (≤48h) SOAP carries escalation → rehab-COMPLEX
 *   4. Default                                → rehab-STABLE
 */
export function classifyRehabSubMode(
  continuity: ContinuityContext | null,
  roomHint: string | null | undefined,
): SoapMode {
  if (!continuity || continuity.priorSoaps.length === 0) {
    return 'rehab-FIRST';
  }

  const admissionBody = continuity.admission?.bodyHebrew ?? '';
  const roomBlob = roomHint ?? '';
  if (HD_RE.test(admissionBody) || HD_RE.test(roomBlob)) {
    return 'rehab-HD-COMPLEX';
  }

  const cutoff = Date.now() - RECENT_SOAP_WINDOW_MS;
  const recentSoap = continuity.priorSoaps.find((n) => n.createdAt >= cutoff);
  if (recentSoap && ESCALATION_RE.test(recentSoap.bodyHebrew)) {
    return 'rehab-COMPLEX';
  }

  return 'rehab-STABLE';
}

/**
 * Convenience: composes resolveSoapMode + classifyRehabSubMode into a
 * single call site for callers that don't need the intermediate state.
 * This is what NoteEditor / orchestrate use.
 */
export function decideSoapMode(args: {
  roomHint: string | null | undefined;
  manualOverride: SoapModeChoice;
  continuity: ContinuityContext | null;
}): SoapMode {
  const first = resolveSoapMode(args.roomHint, args.manualOverride);
  if (first === 'rehab-auto') {
    return classifyRehabSubMode(args.continuity, args.roomHint);
  }
  return first;
}

/** UI label table (Hebrew). Used by NoteEditor's dropdown. */
export const SOAP_MODE_LABEL: Record<SoapModeChoice, string> = {
  auto: 'אוטו',
  general: 'כללי',
  'rehab-FIRST': 'שיקום-יום ראשון',
  'rehab-STABLE': 'שיקום-המשך יציב',
  'rehab-COMPLEX': 'שיקום-המשך מורכב',
  'rehab-HD-COMPLEX': 'שיקום-HD מורכב',
};

/** Persistence helpers. Key by teudatZehut — patientId is minted post-gen. */
const STORAGE_PREFIX = 'soap-mode:';

export function loadModeChoice(teudatZehut: string | null | undefined): SoapModeChoice {
  if (!teudatZehut) return 'auto';
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + teudatZehut);
    if (v && v in SOAP_MODE_LABEL) return v as SoapModeChoice;
  } catch {
    // localStorage may throw in private/quota-exceeded contexts; degrade silently.
  }
  return 'auto';
}

export function saveModeChoice(
  teudatZehut: string | null | undefined,
  choice: SoapModeChoice,
): void {
  if (!teudatZehut) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + teudatZehut, choice);
  } catch {
    // Same posture as load — never throw from a UI handler over storage hiccups.
  }
}

/** Feature-flag gate for the dropdown. */
export function isSoapModeUiEnabled(): boolean {
  try {
    return localStorage.getItem('batch_features') === '1';
  } catch {
    return false;
  }
}
