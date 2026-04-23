import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runExtractTurn, runEmitTurn } from '@/agent/loop';

/** Build a fake fetch that returns a proxy-shaped text response. */
function mockProxyResponse(text: string, usage = { input_tokens: 10, output_tokens: 5 }) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
      usage,
    }),
    text: async () => '',
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  // Each test installs its own fetch stub; reset between tests.
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runExtractTurn — JSON-mode via proxy', () => {
  it('parses a well-formed JSON response into a ParseResult', async () => {
    const payload = JSON.stringify({
      fields: { name: 'דוד כהן', age: 82, chiefComplaint: 'קוצר נשימה' },
      confidence: { name: 'high', age: 'high', teudatZehut: 'low' },
    });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(
      ['data:image/jpeg;base64,/9j/'],
      'SKILL CONTENT azma-ui',
    );
    expect(result.fields.name).toBe('דוד כהן');
    expect(result.confidence['name']).toBe('high');
    expect(result.confidence['teudatZehut']).toBe('low');
  });

  it('strips ```json code fences if the model ignored instructions', async () => {
    const payload = '```json\n{"fields":{"name":"X"},"confidence":{}}\n```';
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill');
    expect(result.fields.name).toBe('X');
  });

  it('extracts the JSON object even with prose wrapper', async () => {
    const payload = 'Here is the JSON:\n{"fields":{"age":77},"confidence":{}}\nHope that helps!';
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill');
    expect(result.fields.age).toBe(77);
  });

  it('backfills missing confidence to empty object', async () => {
    const payload = JSON.stringify({ fields: { name: 'Y' } });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill');
    expect(result.confidence).toEqual({});
  });

  it('throws on truly non-JSON response', async () => {
    vi.stubGlobal('fetch', mockProxyResponse('plain text, no JSON at all'));
    await expect(
      runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill'),
    ).rejects.toThrow(/failed to parse JSON/);
  });

  it('throws on invalid data URL', async () => {
    vi.stubGlobal('fetch', mockProxyResponse('{}'));
    await expect(
      runExtractTurn(['not-a-data-url'], 'skill'),
    ).rejects.toThrow('invalid data URL');
  });

  it('throws on HTTP error from proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => 'service unavailable',
      })),
    );
    await expect(
      runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill'),
    ).rejects.toThrow(/proxy HTTP 503/);
  });

  it('sends image with media_type jpeg for jpeg data URL', async () => {
    const fetchFn = mockProxyResponse(
      JSON.stringify({ fields: {}, confidence: {} }),
    );
    vi.stubGlobal('fetch', fetchFn);
    await runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill');
    const body = JSON.parse((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]![1].body) as {
      messages: Array<{ content: Array<{ source?: { media_type: string } }> }>;
    };
    expect(body.messages[0]!.content[0]!.source?.media_type).toBe('image/jpeg');
  });

  it('falls back to image/jpeg for unknown media type', async () => {
    const fetchFn = mockProxyResponse(
      JSON.stringify({ fields: {}, confidence: {} }),
    );
    vi.stubGlobal('fetch', fetchFn);
    await runExtractTurn(['data:image/bmp;base64,abc'], 'skill');
    const body = JSON.parse((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]![1].body) as {
      messages: Array<{ content: Array<{ source?: { media_type: string } }> }>;
    };
    // Unknown media type -> default (image/jpeg in new code)
    expect(body.messages[0]!.content[0]!.source?.media_type).toBe('image/jpeg');
  });
});

describe('runEmitTurn — JSON-mode via proxy', () => {
  it('parses JSON with noteHebrew field', async () => {
    const payload = JSON.stringify({ noteHebrew: 'קבלה: דוד כהן, בן 82...' });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const note = await runEmitTurn(
      'admission',
      { name: 'דוד' },
      'szmc-clinical-notes skill content',
    );
    expect(note).toContain('קבלה');
  });

  it('falls back to raw text if the model ignored JSON instructions', async () => {
    // Model returned the note as raw Hebrew text, not wrapped in JSON.
    vi.stubGlobal('fetch', mockProxyResponse('קבלה חופשית של דוד'));
    const note = await runEmitTurn('admission', {}, 'skill');
    expect(note).toContain('קבלה');
  });
});
