/**
 * Per-turn token + USD cost tracking, persisted in localStorage.
 * Opus 4.7 pricing as of 2026-04: $15/M input, $75/M output.
 * Update IN_PER_TOKEN / OUT_PER_TOKEN if pricing changes.
 */

const IN_PER_TOKEN = 15 / 1_000_000;
const OUT_PER_TOKEN = 75 / 1_000_000;
const KEY = 'ward-helper.costs';

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

const EMPTY: Totals = { inputTokens: 0, outputTokens: 0, usd: 0 };

export function addTurn(usage: { input_tokens: number; output_tokens: number }): Totals {
  const prev = load();
  const next: Totals = {
    inputTokens: prev.inputTokens + usage.input_tokens,
    outputTokens: prev.outputTokens + usage.output_tokens,
    usd: prev.usd + usage.input_tokens * IN_PER_TOKEN + usage.output_tokens * OUT_PER_TOKEN,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / SSR — ignore */
  }
  return next;
}

export function load(): Totals {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Totals>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export function reset(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
