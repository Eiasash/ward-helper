import { describe, it, expect, beforeEach } from 'vitest';
import {
  addTurn,
  load,
  reset,
  startSession,
  finalizeSessionFor,
  loadPerPatient,
  resetPerPatient,
} from '@/agent/costs';

// Pricing constants mirrored from src/agent/costs.ts.
// Sonnet 4.6: $3/M input, $15/M output.
// Duplicated here intentionally — any accidental change in production
// breaks this test and forces a conscious update.
const IN_PER_TOKEN = 5 / 1_000_000;
const OUT_PER_TOKEN = 25 / 1_000_000;

beforeEach(() => {
  reset();
  resetPerPatient();
  localStorage.removeItem('ward-helper.costs.session');
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

  it('computes USD at $5/M input tokens', () => {
    addTurn({ input_tokens: 1_000_000, output_tokens: 0 });
    expect(load().usd).toBeCloseTo(5, 5);
  });

  it('computes USD at $25/M output tokens', () => {
    addTurn({ input_tokens: 0, output_tokens: 1_000_000 });
    expect(load().usd).toBeCloseTo(25, 5);
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

describe('costs: per-patient attribution', () => {
  it('no session open: addTurn updates global only, not per-patient', () => {
    addTurn({ input_tokens: 100, output_tokens: 50 });
    finalizeSessionFor('patient-A');
    expect(loadPerPatient()).toEqual({});
    expect(load().inputTokens).toBe(100);
  });

  it('startSession + addTurn + finalize attributes cost to patient', () => {
    startSession();
    addTurn({ input_tokens: 1000, output_tokens: 500 });
    finalizeSessionFor('patient-A');
    const per = loadPerPatient();
    expect(per['patient-A']?.inputTokens).toBe(1000);
    expect(per['patient-A']?.outputTokens).toBe(500);
    expect(per['patient-A']?.usd).toBeCloseTo(1000 * IN_PER_TOKEN + 500 * OUT_PER_TOKEN, 10);
  });

  it('two sessions for the same patient accumulate', () => {
    startSession();
    addTurn({ input_tokens: 100, output_tokens: 10 });
    finalizeSessionFor('patient-A');
    startSession();
    addTurn({ input_tokens: 200, output_tokens: 20 });
    finalizeSessionFor('patient-A');
    const per = loadPerPatient();
    expect(per['patient-A']?.inputTokens).toBe(300);
    expect(per['patient-A']?.outputTokens).toBe(30);
  });

  it('finalize without any turns is a no-op — no entry created', () => {
    startSession();
    finalizeSessionFor('patient-A');
    expect(loadPerPatient()).toEqual({});
  });

  it('finalize clears the session so the next turn does not double-count', () => {
    startSession();
    addTurn({ input_tokens: 100, output_tokens: 50 });
    finalizeSessionFor('patient-A');
    // Next turn — no session open, should NOT be attributed to anyone.
    addTurn({ input_tokens: 999, output_tokens: 999 });
    finalizeSessionFor('patient-B');
    expect(loadPerPatient()['patient-A']?.inputTokens).toBe(100);
    expect(loadPerPatient()['patient-B']).toBeUndefined();
  });

  it('global totals still reflect every turn regardless of session state', () => {
    addTurn({ input_tokens: 100, output_tokens: 0 });
    startSession();
    addTurn({ input_tokens: 200, output_tokens: 0 });
    finalizeSessionFor('patient-A');
    addTurn({ input_tokens: 300, output_tokens: 0 });
    expect(load().inputTokens).toBe(600);
  });
});

describe('costs: malformed-input defense (NaN / negative / non-finite)', () => {
  // Defends against malformed proxy responses (the Toranot proxy strips
  // tools/tool_choice and reshapes responses — a bad usage block is plausible)
  // and against pre-sanitization-era localStorage values that may already hold
  // NaN. NaN propagates through arithmetic and would corrupt totals permanently.

  it('NaN input_tokens is treated as 0', () => {
    addTurn({ input_tokens: NaN, output_tokens: 100 });
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(100);
    expect(Number.isFinite(t.usd)).toBe(true);
  });

  it('NaN output_tokens is treated as 0', () => {
    addTurn({ input_tokens: 100, output_tokens: NaN });
    const t = load();
    expect(t.inputTokens).toBe(100);
    expect(t.outputTokens).toBe(0);
    expect(Number.isFinite(t.usd)).toBe(true);
  });

  it('Infinity is treated as 0', () => {
    addTurn({ input_tokens: Infinity, output_tokens: -Infinity });
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(0);
    expect(t.usd).toBe(0);
  });

  it('negative tokens are treated as 0', () => {
    addTurn({ input_tokens: -500, output_tokens: -100 });
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(0);
    expect(t.usd).toBe(0);
  });

  it('non-integer tokens are floored', () => {
    addTurn({ input_tokens: 100.9, output_tokens: 50.4 });
    const t = load();
    expect(t.inputTokens).toBe(100);
    expect(t.outputTokens).toBe(50);
  });

  it('missing usage fields (undefined) are treated as 0', () => {
    addTurn({ input_tokens: undefined as unknown as number, output_tokens: undefined as unknown as number });
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(0);
    expect(t.usd).toBe(0);
  });

  it('one bad turn does not corrupt subsequent good turns', () => {
    addTurn({ input_tokens: NaN, output_tokens: NaN });
    addTurn({ input_tokens: 100, output_tokens: 50 });
    const t = load();
    expect(t.inputTokens).toBe(100);
    expect(t.outputTokens).toBe(50);
    expect(t.usd).toBeCloseTo(100 * IN_PER_TOKEN + 50 * OUT_PER_TOKEN, 10);
  });

  it('load() rehabilitates pre-sanitization-era NaN already in localStorage', () => {
    // Simulate a corrupted state from before the sanitizer existed.
    localStorage.setItem('ward-helper.costs', JSON.stringify({
      inputTokens: NaN,
      outputTokens: 500,
      usd: NaN,
    }));
    const t = load();
    expect(t.inputTokens).toBe(0);
    expect(t.outputTokens).toBe(500);
    expect(t.usd).toBe(0);
  });

  it('load() rehabilitates negative usd already in localStorage', () => {
    localStorage.setItem('ward-helper.costs', JSON.stringify({
      inputTokens: 100,
      outputTokens: 100,
      usd: -42,
    }));
    expect(load().usd).toBe(0);
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
