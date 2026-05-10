/**
 * v42Invariant.mjs — pure helper for the v4.2 per-sub-bot ratchet check.
 *
 * Invariant: for every v4 sub-bot in V4_SUB_BOTS_REQUIRING_WAIT, the count of
 * timeline events with `waitForSubjectCalled === true` MUST be ≥ the count of
 * events with `iterationCompleted === true`. Phrased differently: every
 * completed iteration of a v4 sub-bot was preceded by at least one
 * waitForSubject() call inside that iteration.
 *
 * Why ≥ and not ===: chaos types can legitimately abort an iteration mid-stream
 * AFTER waitForSubject was called. So the count of waits may exceed the count
 * of completions for a given sub-bot. The invariant is "every completed
 * iteration was preceded by a wait" (≥), not "every wait was followed by a
 * completion" (===).
 *
 * Why static allowlist (not dynamic): v1-v3 core sub-bots (admission, soap,
 * ortho, consult, history, settings) use bespoke poll loops and never call
 * waitForSubject. A dynamic "any sub-bot that ever called wait" scoping would
 * miss the regression "a v4 sub-bot stops calling wait" — under dynamic
 * scoping, that surfaces as the sub-bot vanishing from the tracked set
 * silently, not as a loud violation.
 *
 * Pure data — no I/O, no Playwright, no Node-only APIs. Importable from the
 * analyzer CLI script and from vitest unit tests alike.
 */

import { V4_SUB_BOTS_REQUIRING_WAIT } from './subBotsV4.mjs';

export { V4_SUB_BOTS_REQUIRING_WAIT };

/**
 * @typedef {{
 *   botSubject?: string,
 *   waitForSubjectCalled?: boolean,
 *   iterationCompleted?: boolean,
 * }} TimelineEvent
 *
 * @param {Array<TimelineEvent>} timeline — JSONL-decoded event list from a
 *   single mega-bot run (cap: 10k events per run, see ward-helper-mega-bot.mjs).
 * @returns {{
 *   perSubBot: Record<string, { waitCalled: number, iterCompleted: number }>,
 *   violators: Array<[string, { waitCalled: number, iterCompleted: number }]>,
 * }} — `perSubBot` keyed by botSubject (only V4 sub-bots tracked); `violators`
 *   is the subset where iterCompleted > waitCalled. Empty `violators` = pass.
 */
export function checkV42Invariant(timeline) {
  /** @type {Record<string, { waitCalled: number, iterCompleted: number }>} */
  const perSubBot = {};
  // Initialize each tracked sub-bot to zero so the analyzer always renders the
  // full table (including sub-bots that never fired this run — that's its own
  // signal: scheduler missed coverage).
  for (const name of V4_SUB_BOTS_REQUIRING_WAIT) {
    perSubBot[name] = { waitCalled: 0, iterCompleted: 0 };
  }
  for (const ev of timeline) {
    if (!ev || typeof ev.botSubject !== 'string') continue;
    // Allowlist filter — chaos and v1-v3 core sub-bots emit
    // waitForSubjectCalled:false legitimately (they don't use the helper).
    if (!V4_SUB_BOTS_REQUIRING_WAIT.includes(ev.botSubject)) continue;
    const r = perSubBot[ev.botSubject];
    if (ev.waitForSubjectCalled === true) r.waitCalled += 1;
    if (ev.iterationCompleted === true) r.iterCompleted += 1;
  }
  const violators = Object.entries(perSubBot)
    .filter(([, r]) => r.waitCalled < r.iterCompleted);
  return { perSubBot, violators };
}
