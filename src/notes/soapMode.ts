/**
 * SOAP-mode resolver for the rehab/general split.
 *
 * Phase C scaffolding (PR #73). The wiring is live; the rehab-mode
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
 * HD detection patterns. Pinned as an array (not a single alternation
 * regex) because JS `\b` is ASCII-only — applying `\b` around Hebrew
 * letters matches at non-word characters incorrectly (e.g. `\bהמוד\b`
 * never fires because `ה` is non-word in `\b` semantics).
 *
 * Strategy:
 *   - ASCII tokens use `\bX\b` — excludes HDL/HDR/HDPE substring traps.
 *   - Multi-letter Hebrew words (המודיאליזה, דיאליזה, פיסטולה) match by
 *     plain substring. They are distinctive enough that no common Hebrew
 *     word contains them.
 *   - Short Hebrew abbreviation `המוד` uses Unicode-aware lookaround
 *     `(?<!\p{L})...(?!\p{L})` so it matches as a standalone word but
 *     NOT as a prefix of המודיאליזה / המודינמית / המודרני.
 *
 * Conservative posture: false-positive HD-COMPLEX is safer than missing
 * a real HD case (the manual dropdown can downgrade; an undetected HD
 * patient gets the wrong template).
 */
const HD_PATTERNS: readonly RegExp[] = [
  /\bHD\b/i,
  /\bESRD\b/i,
  /\bESKD\b/i,
  /\bdialysis\b/i,
  /\bhemodialysis\b/i,
  /\bfistula\b/i,
  /המודיאליזה/,
  /(?<!\p{L})המוד(?!\p{L})/u,
  /דיאליזה/,
  /פיסטולה/,
  /על\s+המודיאליזה/,
];

/**
 * Returns true when any of the supplied free-text fields contains an HD
 * marker. Variadic so callers can pass admission body, room hint, and
 * recent SOAP body without manual concatenation.
 */
export function isHdContext(
  ...fields: ReadonlyArray<string | null | undefined>
): boolean {
  const text = fields.filter((f): f is string => Boolean(f)).join(' ');
  if (!text) return false;
  return HD_PATTERNS.some((rx) => rx.test(text));
}

/**
 * Narrow "recent escalation" lexicon. Conservative on purpose — false
 * positives push the framing toward COMPLEX, which is "more careful";
 * false negatives are caught by the user via the manual dropdown.
 */
const ESCALATION_RE =
  /החמרה|חום\s*\d|זיהום|ספסיס|אנטיביוטיקה חדשה|fever|sepsis|deterioration|escalation/i;

/**
 * Lookback window for the "recent escalation" trigger that promotes
 * STABLE → COMPLEX. 48h chosen because it covers yesterday's chart
 * + today's morning round; shorter misses overnight events, longer
 * over-promotes patients who've already stabilized. Tune via PR if
 * calibration data says otherwise.
 */
export const ESCALATION_LOOKBACK_HOURS = 48;
const ESCALATION_LOOKBACK_MS = ESCALATION_LOOKBACK_HOURS * 60 * 60 * 1000;

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
  if (isHdContext(admissionBody, roomHint)) {
    return 'rehab-HD-COMPLEX';
  }

  const cutoff = Date.now() - ESCALATION_LOOKBACK_MS;
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

/* -------------------------------------------------------------------------
 * Persistence — keyed by SHA-256(teudatZehut) truncated to 8 bytes (64 bits).
 *
 * Why hash: localStorage is plain-text in DevTools; raw teudatZehut is PII
 * that must not be stored alongside non-sensitive UI prefs. SHA-256 is
 * collision-safe at any realistic patient count, deterministic so the
 * same tz always resolves to the same key, and the truncation keeps the
 * key short (~16 hex chars) for inspectability when debugging cache
 * issues. The hash is one-way — no way to recover tz from a stored key.
 * ------------------------------------------------------------------------- */

const STORAGE_PREFIX = 'soap-mode:';

/**
 * Build a non-PII storage key for SOAP mode persistence.
 * Async because crypto.subtle is async. Cheap (one shot, <1ms).
 */
async function modeStorageKey(teudatZehut: string): Promise<string> {
  const buf = new TextEncoder().encode(teudatZehut);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${STORAGE_PREFIX}${hex}`;
}

/**
 * Load the persisted mode choice for a patient. Returns 'auto' when:
 *   - tz is missing
 *   - no entry exists for this hashed key
 *   - a stored value isn't a recognized SoapModeChoice (defensive against
 *     manual localStorage edits or stale schema versions)
 *   - localStorage is unavailable (private mode / quota / SecurityError)
 */
export async function loadModeChoice(
  teudatZehut: string | null | undefined,
): Promise<SoapModeChoice> {
  if (!teudatZehut) return 'auto';
  try {
    const key = await modeStorageKey(teudatZehut);
    const v = localStorage.getItem(key);
    if (v && v in SOAP_MODE_LABEL) return v as SoapModeChoice;
  } catch {
    // localStorage may throw in private/quota-exceeded contexts; degrade silently.
  }
  return 'auto';
}

/**
 * Persist the mode choice. Async to mirror loadModeChoice — same hash
 * derivation, same swallow-on-storage-failure posture. Callers must
 * await before assuming the value is durable across reloads.
 */
export async function saveModeChoice(
  teudatZehut: string | null | undefined,
  choice: SoapModeChoice,
): Promise<void> {
  if (!teudatZehut) return;
  try {
    const key = await modeStorageKey(teudatZehut);
    localStorage.setItem(key, choice);
  } catch {
    // Same posture as load — never throw from a UI handler over storage hiccups.
  }
}

/** Feature-flag gate for the dropdown. Synchronous — reads a fixed key. */
export function isSoapModeUiEnabled(): boolean {
  try {
    return localStorage.getItem('batch_features') === '1';
  } catch {
    return false;
  }
}
