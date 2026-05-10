/**
 * personasV4.mjs — three new personas + persona-memory + min-coverage
 * scheduler.
 *
 * Personas (replacing the 3 duplicates in DEFAULT_PERSONA_ROTATION):
 *
 *   - postCallResident — 30hrs awake. 40% typo rate, 8-12s pauses,
 *     occasionally returns to abandoned tasks after long idle. Models
 *     6am ward rounds. Catches: cross-patient field contamination,
 *     stale-form bugs, abandoned-and-resumed-edit corruption.
 *
 *   - dictatingAttending — voice-input style: large pasted Hebrew
 *     strings, undo/redo aggressive, 3-4 large corrections per note.
 *     Tests undo stack which is almost certainly undertested.
 *
 *   - intermittentConnection — user behavior under flaky network.
 *     Refresh-spam, abandon-and-retry on slow loads, pulls-to-refresh
 *     mid-form. Distinct from the chaosNetworkRamped chaos type
 *     (which models the network) by modeling the USER's response.
 *
 * Persona memory (Map<selector, {clicks, lastResult, missCount}>):
 *   misclicker biases away from sites where last click failed.
 *
 * MinCoverageScheduler:
 *   targets: { emailToSelf: 5, morningRoundsPrep: 5, orthoCalcMath: 5, resetPasswordLanding: 3 }
 *   After 50% of run wall-time, biases pickAction toward under-fired
 *   targets with 60% probability (40% still uniform random — preserves
 *   diversity).
 */

export const PERSONAS_V4 = {
  postCallResident: {
    name: 'Dr. PostCall',
    minDelay: 8000,
    maxDelay: 12000,
    missclickRate: 0.20,
    typingSpeed: 'slow',
    typoRate: 0.40,
    description: '30hrs awake — slow, fatigued, abandons + returns, types into wrong field',
    abandonsRate: 0.15,
    extraChaosRate: 0.10,
  },
  dictatingAttending: {
    name: 'Dr. Dictating',
    minDelay: 400,
    maxDelay: 1200,
    missclickRate: 0.05,
    typingSpeed: 'paste',
    description: 'voice-input style — large pasted bodies, aggressive undo/redo',
    largePasteRate: 0.60,
    undoRate: 0.30,
    extraChaosRate: 0.20,
  },
  intermittentConnection: {
    name: 'Dr. FlakyWifi',
    minDelay: 600,
    maxDelay: 2200,
    missclickRate: 0.05,
    typingSpeed: 'normal',
    description: 'pulls-to-refresh, abandons slow loads, retries impatiently',
    refreshSpamRate: 0.20,
    extraChaosRate: 0.40,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Persona memory — Map keyed by selector signature
// ────────────────────────────────────────────────────────────────────────────

export class PersonaMemory {
  constructor() {
    this.store = new Map();
  }
  /** Record a click result. selectorKey is a stable string (label or aria). */
  record(selectorKey, ok) {
    const e = this.store.get(selectorKey) ?? { clicks: 0, lastResult: null, missCount: 0 };
    e.clicks += 1;
    e.lastResult = ok ? 'ok' : 'fail';
    if (!ok) e.missCount += 1;
    this.store.set(selectorKey, e);
  }
  /** For misclicker: should we bias AWAY from this selector this tick?
   *  Returns true if the last 3 attempts failed (random + memory). */
  shouldAvoid(selectorKey) {
    const e = this.store.get(selectorKey);
    if (!e) return false;
    // 50% chance to avoid if this selector has missed >2 times.
    return e.missCount > 2 && Math.random() < 0.5;
  }
  summary() {
    const out = { total: this.store.size, totalClicks: 0, totalMisses: 0 };
    for (const e of this.store.values()) {
      out.totalClicks += e.clicks;
      out.totalMisses += e.missCount;
    }
    return out;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Min-coverage scheduler — bias pick after 50% wall-time
// ────────────────────────────────────────────────────────────────────────────

export class MinCoverageScheduler {
  /**
   * @param {object} opts
   * @param {object} opts.targets — { actionName: minRunsAcrossAllPersonas }
   * @param {number} opts.durationMs — total run duration
   * @param {number} [opts.biasAfterFraction=0.5] — fraction of wall-time after which biasing kicks in
   * @param {number} [opts.biasProbability=0.6] — once biasing is active, prob of force-pick
   */
  constructor({ targets, durationMs, biasAfterFraction = 0.5, biasProbability = 0.6 }) {
    this.targets = targets;
    this.fired = new Map();
    this.biasAfterFraction = biasAfterFraction;
    this.biasProbability = biasProbability;
    this.startMs = Date.now();
    this.durationMs = durationMs;
    for (const k of Object.keys(targets)) this.fired.set(k, 0);
  }
  /** Called by orchestrator after orchestration starts (resets clock). */
  reset() { this.startMs = Date.now(); }
  recordFire(actionName) {
    if (!this.fired.has(actionName)) this.fired.set(actionName, 0);
    this.fired.set(actionName, this.fired.get(actionName) + 1);
  }
  /** Returns the action name to force-pick, or null to defer to the menu. */
  forcedPick() {
    const elapsed = Date.now() - this.startMs;
    if (elapsed < this.durationMs * this.biasAfterFraction) return null;
    if (Math.random() >= this.biasProbability) return null;
    const under = [];
    for (const [name, target] of Object.entries(this.targets)) {
      const fired = this.fired.get(name) ?? 0;
      if (fired < target) under.push({ name, fired, target, deficit: target - fired });
    }
    if (under.length === 0) return null;
    // Weight by deficit so the most-under actions get picked more.
    const totalDeficit = under.reduce((a, u) => a + u.deficit, 0);
    let r = Math.random() * totalDeficit;
    for (const u of under) {
      r -= u.deficit;
      if (r <= 0) return u.name;
    }
    return under[under.length - 1].name;
  }
  status() {
    const out = [];
    for (const [name, target] of Object.entries(this.targets)) {
      const fired = this.fired.get(name) ?? 0;
      out.push({ name, fired, target, met: fired >= target });
    }
    return out;
  }
}

export const DEFAULT_MIN_COVERAGE_TARGETS = {
  emailToSelf: 5,
  morningRoundsPrep: 5,
  orthoCalcMath: 5,
  resetPasswordLanding: 3,
};
