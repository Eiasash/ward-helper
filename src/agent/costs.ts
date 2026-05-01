/**
 * Per-turn token + USD cost tracking, persisted in localStorage.
 *
 * Pricing for claude-opus-4-7 (what the app uses — see MODEL_DIRECT in
 * src/agent/client.ts and the proxy's default model):
 *   input:  $5/M tokens
 *   output: $25/M tokens
 *
 * Note: Opus 4.7's tokenizer produces ~5-35% more tokens for the same text
 * than Sonnet 4.6 did. Per-request bills run ~1.67x base + tokenizer inflation
 * = roughly 2-2.25x what Sonnet 4.6 was. Adaptive thinking is metered into
 * output tokens, so simple Q&A stays cheap and complex reasoning pays in
 * proportion to actual depth used.
 *
 * If you swap the underlying model again, update these TWO constants AND
 * the model string in client.ts at the same time.
 *
 * NOTE: prior versions of this file used Opus pricing (5x too high).
 * Per-patient cost readouts written before 2026-04-24 are inflated 5x —
 * the patient map is cumulative and NOT retroactively corrected. Fresh
 * patients after this change will show real costs.
 *
 * Three accounting layers:
 *   - global totals     — lifetime of the install
 *   - current session   — accumulates from Capture through Save; flushed to
 *                         a patient bucket once the patient ID is minted
 *   - per-patient map   — patientId -> Totals, for the "this patient burned
 *                         $X on N re-extractions" readout in Settings
 */

const IN_PER_TOKEN = 5 / 1_000_000;
const OUT_PER_TOKEN = 25 / 1_000_000;
const KEY = 'ward-helper.costs';
const SESSION_KEY = 'ward-helper.costs.session';
const PATIENT_KEY = 'ward-helper.costs.perPatient';

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

const EMPTY: Totals = { inputTokens: 0, outputTokens: 0, usd: 0 };

// Sanitize untrusted numeric input from the proxy / from prior localStorage state.
// The proxy strips tools/tool_choice and re-shapes responses, so a malformed
// `usage` (NaN, undefined, negative, non-integer) is plausible. Any of those
// values flowing into the accumulator would corrupt the running USD total
// permanently — NaN propagates and there's no way back without a hard reset.
function sanitizeTokenCount(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function sanitizeUsd(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

function turnCost(usage: { input_tokens: number; output_tokens: number }): Totals {
  const inTok = sanitizeTokenCount(usage?.input_tokens);
  const outTok = sanitizeTokenCount(usage?.output_tokens);
  return {
    inputTokens: inTok,
    outputTokens: outTok,
    usd: inTok * IN_PER_TOKEN + outTok * OUT_PER_TOKEN,
  };
}

function addTotals(a: Totals, b: Totals): Totals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    usd: a.usd + b.usd,
  };
}

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / SSR — ignore */
  }
}

export function addTurn(usage: { input_tokens: number; output_tokens: number }): Totals {
  const delta = turnCost(usage);

  const globalNext = addTotals(load(), delta);
  safeSet(KEY, globalNext);

  // Also accumulate into the live session bucket, if one is open.
  const session = safeGet<Totals | null>(SESSION_KEY, null);
  if (session) safeSet(SESSION_KEY, addTotals(session, delta));

  return globalNext;
}

export function load(): Totals {
  // Defend against pre-sanitization-era localStorage values that may already
  // hold NaN or negative numbers from a prior corrupted turn. Read-back is
  // the right place to rehabilitate; otherwise a single bad write is permanent.
  const raw = safeGet<Partial<Totals>>(KEY, {});
  return {
    inputTokens: sanitizeTokenCount(raw?.inputTokens),
    outputTokens: sanitizeTokenCount(raw?.outputTokens),
    usd: sanitizeUsd(raw?.usd),
  };
}

export function reset(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Open a cost-attribution session (e.g. when Capture mounts). Idempotent:
 *  calling twice without a finalize wipes the prior session. */
export function startSession(): void {
  safeSet(SESSION_KEY, { ...EMPTY });
}

/** Close the session, attributing its accumulated cost to `patientId`. */
export function finalizeSessionFor(patientId: string): void {
  const session = safeGet<Totals | null>(SESSION_KEY, null);
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  if (!session || (session.inputTokens === 0 && session.outputTokens === 0)) return;
  const map = loadPerPatient();
  map[patientId] = addTotals(map[patientId] ?? { ...EMPTY }, session);
  safeSet(PATIENT_KEY, map);
}

export function loadPerPatient(): Record<string, Totals> {
  return safeGet<Record<string, Totals>>(PATIENT_KEY, {});
}

export function resetPerPatient(): void {
  try {
    localStorage.removeItem(PATIENT_KEY);
  } catch {
    /* ignore */
  }
}
