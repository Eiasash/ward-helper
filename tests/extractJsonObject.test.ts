import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '@/agent/loop';

describe('extractJsonObject', () => {
  // Backwards-compat with stripMarkdownFence — same inputs must yield JSON
  // strings that round-trip through JSON.parse cleanly.

  it('returns plain JSON unchanged', () => {
    const s = '{"noteHebrew":"קבלה"}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it('strips ```json fences on a clean fence-wrapped payload', () => {
    const wrapped = '```json\n{"noteHebrew":"x"}\n```';
    expect(extractJsonObject(wrapped)).toBe('{"noteHebrew":"x"}');
  });

  it('strips bare ``` fences (no language tag)', () => {
    const wrapped = '```\n{"noteHebrew":"x"}\n```';
    expect(extractJsonObject(wrapped)).toBe('{"noteHebrew":"x"}');
  });

  it('handles empty string', () => {
    expect(extractJsonObject('')).toBe('');
  });

  // The actual production bug — ward-helper v1.21.0 debug log 2026-04-26.
  // Sonnet was emitting "I'll read through all four images carefully..." +
  // "**Pass 1 — Identity:**" + clinical reasoning BEFORE the fenced JSON.
  // stripMarkdownFence couldn't anchor at start (prose was there), JSON.parse
  // saw "I'll read..." and threw "Unexpected token 'I'".
  it('extracts JSON when model emits prose preamble before the fence', () => {
    const body = `I'll read through all four images carefully.

**Pass 1 — Identity:**

From images 1 & 2 (lab printouts):
- name: x
- ID: y

\`\`\`json
{"fields":{"name":"פונארו אלדד","teudatZehut":"011895745","age":87}}
\`\`\``;
    const result = extractJsonObject(body);
    expect(JSON.parse(result)).toEqual({
      fields: {
        name: 'פונארו אלדד',
        teudatZehut: '011895745',
        age: 87,
      },
    });
  });

  it('extracts JSON when model emits prose AND postamble around the fence', () => {
    const body = `Here is my analysis.

\`\`\`json
{"fields":{"name":"דוד כהן"}}
\`\`\`

Note: I lowered confidence on age because the photo was blurry.`;
    const result = extractJsonObject(body);
    expect(JSON.parse(result)).toEqual({ fields: { name: 'דוד כהן' } });
  });

  it('extracts JSON from a bare ``` block (no json tag) inside prose', () => {
    const body = `Looking at this carefully:

\`\`\`
{"rows":[{"bed":"1A"}]}
\`\`\``;
    const result = extractJsonObject(body);
    expect(JSON.parse(result)).toEqual({ rows: [{ bed: '1A' }] });
  });

  // Fallback path: model emits prose + raw JSON (no fences at all). This was
  // never the documented behavior but happened occasionally on emit. The
  // balanced-brace walker should still recover.
  it('extracts a balanced { ... } block when no fences are present', () => {
    const body = `Sure, here you go: {"noteHebrew":"קבלה: דוד"} — let me know if more is needed.`;
    const result = extractJsonObject(body);
    expect(JSON.parse(result)).toEqual({ noteHebrew: 'קבלה: דוד' });
  });

  it('respects string literals when matching braces (does not break on `{` inside string values)', () => {
    // The Hebrew note text contains a literal "{ }" sequence — depth counter
    // must not be fooled. Without string-literal tracking the walker would
    // close on the inner `}` and return invalid truncated JSON.
    const body = `Here:

\`\`\`json
{"noteHebrew":"קבלה: { משהו } סוגריים בתוך מחרוזת","ok":true}
\`\`\``;
    const result = extractJsonObject(body);
    expect(JSON.parse(result)).toEqual({
      noteHebrew: 'קבלה: { משהו } סוגריים בתוך מחרוזת',
      ok: true,
    });
  });

  it('respects escaped quotes inside string literals', () => {
    const body = `\`\`\`json
{"noteHebrew":"a \\"quoted\\" word, and a {brace}","ok":true}
\`\`\``;
    const result = extractJsonObject(body);
    expect(JSON.parse(result)).toEqual({
      noteHebrew: 'a "quoted" word, and a {brace}',
      ok: true,
    });
  });

  it('preserves Hebrew content', () => {
    const wrapped =
      '```json\n{"noteHebrew":"קבלה: דוד כהן בן 82"}\n```';
    expect(extractJsonObject(wrapped)).toBe(
      '{"noteHebrew":"קבלה: דוד כהן בן 82"}',
    );
  });

  it('handles CRLF newlines around the fences', () => {
    const wrapped = '```json\r\n{"noteHebrew":"x"}\r\n```';
    expect(extractJsonObject(wrapped)).toBe('{"noteHebrew":"x"}');
  });

  it('is idempotent on already-extracted JSON', () => {
    const wrapped = 'preamble\n```json\n{"a":1}\n```\npostamble';
    const once = extractJsonObject(wrapped);
    const twice = extractJsonObject(once);
    expect(twice).toBe(once);
  });

  it('returns stripped text unchanged when nothing JSON-shaped is in the body — caller throws a real error', () => {
    const body = 'I cannot help with that request.';
    // Should not throw, should not return a malformed candidate. The result
    // must be such that JSON.parse(result) throws — the call sites catch that
    // and surface a useful error to the user.
    const result = extractJsonObject(body);
    expect(() => JSON.parse(result)).toThrow();
  });

  it('uppercase ```JSON variant still works', () => {
    const wrapped = '```JSON\n{"noteHebrew":"x"}\n```';
    expect(extractJsonObject(wrapped)).toBe('{"noteHebrew":"x"}');
  });
});
