import { describe, it, expect } from 'vitest';
import { translateAnthropicError } from '@/ai/dispatch';

describe('translateAnthropicError', () => {
  const overloadedJson = JSON.stringify({
    type: 'error',
    error: { type: 'overloaded_error', message: 'Overloaded' },
    request_id: 'req_011CaoBgxRwknvFY1ishPj4e',
  });

  it('translates 529 + overloaded_error to friendly Hebrew', () => {
    const err = translateAnthropicError('anthropic', 529, overloadedJson);
    expect(err.message).toContain('השרת של Anthropic עמוס');
    expect(err.message).toContain('(HTTP 529)');
    // Raw JSON must NOT leak through
    expect(err.message).not.toContain('overloaded_error');
    expect(err.message).not.toContain('request_id');
    expect(err.message).not.toContain('{');
  });

  it('translates overloaded_error body even when status is something else', () => {
    // Anthropic occasionally wraps overload as 200 with error body, or 503.
    const err = translateAnthropicError('anthropic', 503, overloadedJson);
    expect(err.message).toContain('עמוס');
    expect(err.message).toContain('(HTTP 503)');
  });

  it('translates 503 to "service unavailable" Hebrew', () => {
    const err = translateAnthropicError('anthropic', 503, '');
    expect(err.message).toContain('לא זמין');
    expect(err.message).toContain('(HTTP 503)');
  });

  it('translates 504 to "timeout, reduce images" Hebrew', () => {
    const err = translateAnthropicError('proxy', 504, '');
    expect(err.message).toContain('פסק זמן');
    expect(err.message).toContain('(HTTP 504)');
  });

  it('translates 429 to "rate limit" Hebrew', () => {
    const err = translateAnthropicError('anthropic', 429, '');
    expect(err.message).toContain('חריגה ממכסת');
    expect(err.message).toContain('(HTTP 429)');
  });

  it('keeps HTTP <code> in the message so isTransient still matches', () => {
    // isTransient checks /\bHTTP 5\d\d\b/.test(m). The translator must not
    // strip that pattern, or the retry path silently breaks.
    const err = translateAnthropicError('anthropic', 529, overloadedJson);
    expect(/\bHTTP 5\d\d\b/.test(err.message)).toBe(true);
  });

  it('falls through to raw form for non-translated codes (400 etc.)', () => {
    const err = translateAnthropicError('anthropic', 400, 'invalid request shape');
    expect(err.message).toBe('anthropic HTTP 400: invalid request shape');
  });

  it('falls through cleanly when body is not JSON', () => {
    const err = translateAnthropicError('proxy', 502, '<html>Bad Gateway</html>');
    // 502 is not in the curated list → falls through to raw form
    expect(err.message).toContain('proxy HTTP 502');
  });

  it('truncates raw fall-through body to 200 chars', () => {
    const long = 'x'.repeat(500);
    const err = translateAnthropicError('anthropic', 418, long);
    // 418 isn't translated; raw form is returned with .slice(0, 200)
    expect(err.message.length).toBeLessThan(260);
  });

  it('uses provided prefix on non-translated errors', () => {
    const a = translateAnthropicError('anthropic', 400, 'foo');
    const p = translateAnthropicError('proxy', 400, 'foo');
    expect(a.message).toMatch(/^anthropic HTTP/);
    expect(p.message).toMatch(/^proxy HTTP/);
  });
});
