import { describe, it, expect } from 'vitest';
import { extractJsonObject, extractJsonStrategy } from '@/agent/loop';

/**
 * extractJsonStrategy returns BOTH the parsed-out JSON string AND which of
 * the four strategies resolved the parse. The string-return contract is
 * already covered by extractJsonObject.test.ts (extractJsonObject is a shim
 * over extractJsonStrategy). These tests pin the strategy reporting itself —
 * what the debug panel shows the doctor about model behavior.
 *
 * Strategy taxonomy:
 *   'fast'     — clean JSON or fence-bookended (model behaved)
 *   'fenced'   — ```json fence inside prose preamble (most common misbehavior)
 *   'brace'    — raw {...} inside prose, no fences (least common, riskiest)
 *   'fallback' — no JSON found; caller's JSON.parse will throw
 */

describe('extractJsonStrategy — strategy classification', () => {
  it('reports "fast" for already-clean JSON', () => {
    const result = extractJsonStrategy('{"ok":true}');
    expect(result.strategy).toBe('fast');
    expect(result.json).toBe('{"ok":true}');
  });

  it('reports "fast" for pure fence-wrapped JSON (no preamble or postamble)', () => {
    // stripMarkdownFence handles fences anchored at start/end of the body —
    // that case stays in the fast path because the stripped result is
    // already well-formed JSON.
    const result = extractJsonStrategy('```json\n{"ok":true}\n```');
    expect(result.strategy).toBe('fast');
  });

  it('reports "fenced" when prose preamble precedes a ```json fence', () => {
    // The v1.21.0 production case: model emits "Pass 1 / Pass 2" reasoning
    // before the JSON envelope. Strategy 1 fails because the body doesn't
    // start with {. Strategy 2 finds the fenced block and wins.
    const body = `Looking at this carefully:

\`\`\`json
{"ok":true}
\`\`\``;
    const result = extractJsonStrategy(body);
    expect(result.strategy).toBe('fenced');
    expect(result.json).toBe('{"ok":true}');
  });

  it('reports "fenced" when prose surrounds the fence on both sides', () => {
    const body = `Pre-amble.\n\n\`\`\`json\n{"a":1}\n\`\`\`\n\nPost-amble.`;
    expect(extractJsonStrategy(body).strategy).toBe('fenced');
  });

  it('reports "brace" when no fence is present, raw {...} inside prose', () => {
    // Most-misbehaved path. Recovery via the string-literal-aware brace walker.
    const body = 'Sure: {"answer":42} — done.';
    const result = extractJsonStrategy(body);
    expect(result.strategy).toBe('brace');
    expect(result.json).toBe('{"answer":42}');
  });

  it('reports "brace" when a JSON string value contains literal braces', () => {
    // String-literal-aware walker. Without it the depth counter would close
    // on the inner } and return invalid truncated JSON. The strategy here is
    // brace because the outer body has no fence, and the walker has to
    // understand string literals to reach the correct closing brace.
    const body = 'Here: {"note":"contains { and } in the string","ok":true}';
    const result = extractJsonStrategy(body);
    expect(result.strategy).toBe('brace');
    expect(JSON.parse(result.json)).toEqual({
      note: 'contains { and } in the string',
      ok: true,
    });
  });

  it('reports "fallback" when no JSON-shaped content is in the body', () => {
    // Model output is genuinely garbage (refusal, error string, plain text).
    // Strategy 4 returns the stripped body so caller's JSON.parse throws a
    // real diagnostic with the bad payload visible in the error message.
    const result = extractJsonStrategy('I cannot help with that request.');
    expect(result.strategy).toBe('fallback');
  });

  it('reports "fast" on empty input (defensive default, no recovery needed)', () => {
    expect(extractJsonStrategy('').strategy).toBe('fast');
    expect(extractJsonStrategy('').json).toBe('');
  });

  it('strategy ordering: fenced beats brace when both could match', () => {
    // If a body has BOTH a ```json fence AND a raw {...} elsewhere, fenced
    // should win because it's the more reliable signal of intent. This pins
    // the priority so a refactor doesn't accidentally flip them.
    const body = `Maybe: {"draft":1}

But really:

\`\`\`json
{"final":2}
\`\`\``;
    const result = extractJsonStrategy(body);
    expect(result.strategy).toBe('fenced');
    expect(JSON.parse(result.json)).toEqual({ final: 2 });
  });

  it('round-trip: extractJsonObject == extractJsonStrategy(...).json', () => {
    // Sanity: the legacy shim agrees with the new function on a representative
    // sample. If these ever diverge we have a dual-implementation bug.
    const samples = [
      '{"a":1}',
      '```json\n{"a":1}\n```',
      'preamble\n```json\n{"a":1}\n```',
      'raw {"a":1} inline',
      'no json here at all',
      '',
    ];
    for (const s of samples) {
      expect(extractJsonObject(s), `mismatch for input: ${s.slice(0, 40)}`).toBe(
        extractJsonStrategy(s).json,
      );
    }
  });
});
