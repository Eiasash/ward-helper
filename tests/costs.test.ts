import { describe, it, expect, beforeEach } from 'vitest';
import { addTurn, load, reset } from '@/agent/costs';

// Pricing constants mirrored from src/agent/costs.ts.
// These are intentionally duplicated here so that any accidental pricing change
// in production immediately breaks this test and forces a conscious update.
const IN_PER_TOKEN = 15 / 1_000_000;
const OUT_PER_TOKEN = 75 / 1_000_000;

beforeEach(() => {
  reset();
});

describe('costs: load', () => {
  it('returns zeros on empty localStorage', () => {
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(0);
    expect(t.usd).toBe(0);
  });

  it('handles corrupted JSON gracefully and returns zeros', () => {
    localStorage.setItem('ward-helper.costs', '{bad json}');
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(0);
    expect(t.usd).toBe(0);
  });
});

describe('costs: addTurn', () => {
  it('accumulates input and output token counts', () => {
    addTurn({ input_tokens: 1000, output_tokens: 200 });
    const t = load();
    expect(t.inputTokens).toBe(1000);
    expect(t.outputTokens).toBe(200);
  });

  it('computes USD at $15/M input tokens', () => {
    addTurn({ input_tokens: 1_000_000, output_tokens: 0 });
    expect(load().usd).toBeCloseTo(15, 5);
  });

  it('computes USD at $75/M output tokens', () => {
    addTurn({ input_tokens: 0, output_tokens: 1_000_000 });
    expect(load().usd).toBeCloseTo(75, 5);
  });

  it('accumulates correctly across multiple calls', () => {
    addTurn({ input_tokens: 100, output_tokens: 50 });
    addTurn({ input_tokens: 200, output_tokens: 100 });
    const t = load();
    expect(t.inputTokens).toBe(300);
    expect(t.outputTokens).toBe(150);
    expect(t.usd).toBeCloseTo(300 * IN_PER_TOKEN + 150 * OUT_PER_TOKEN, 10);
  });

  it('returns updated totals immediately', () => {
    const t = addTurn({ input_tokens: 500, output_tokens: 250 });
    expect(t.inputTokens).toBe(500);
    expect(t.outputTokens).toBe(250);
  });
});

describe('costs: reset', () => {
  it('clears accumulated totals to zero', () => {
    addTurn({ input_tokens: 5000, output_tokens: 1000 });
    reset();
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(0);
    expect(t.usd).toBe(0);
  });

  it('is idempotent — calling reset twice does not throw', () => {
    reset();
    expect(() => reset()).not.toThrow();
  });
});
