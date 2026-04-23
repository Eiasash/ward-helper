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

  it('throws on HTTP error from proxy', { timeout: 15_000 }, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'internal server error',
      })),
    );
    // Extract does NOT set retryOnTransient, so 500 fails after one attempt.
    await expect(
      runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill'),
    ).rejects.toThrow(/HTTP 500/);
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

describe('runExtractTurn — confidence filter', () => {
  it('strips non-critical-3 confidence keys (model compliance hedge)', async () => {
    // Observed in prod v1.6.0: model emits low-conf on room + chiefComplaint
    // despite prompt. The client filter is the UI trust boundary.
    const payload = JSON.stringify({
      fields: { name: 'A', room: '7', chiefComplaint: 'x' },
      confidence: {
        name: 'high',
        teudatZehut: 'med',
        age: 'low',
        room: 'low',
        chiefComplaint: 'low',
        meds: 'low',
      },
    });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill');
    expect(Object.keys(result.confidence).sort()).toEqual(['age', 'name', 'teudatZehut']);
    expect(result.confidence['room']).toBeUndefined();
    expect(result.confidence['chiefComplaint']).toBeUndefined();
  });

  it('drops confidence values that are not low/med/high', async () => {
    const payload = JSON.stringify({
      fields: { name: 'X' },
      // Model garbling — null, booleans, typos. All must be rejected.
      confidence: { name: 'high', age: 'very-high', teudatZehut: null },
    });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(['data:image/jpeg;base64,/9j/'], 'skill');
    expect(result.confidence['name']).toBe('high');
    expect(result.confidence['age']).toBeUndefined();
    expect(result.confidence['teudatZehut']).toBeUndefined();
  });
});

describe('runEmitTurn — transient retry', () => {
  // Real backoff is 2s + 4s = 6s; bump this test's timeout past vitest default.
  it('retries emit twice on 504 before failing', { timeout: 15_000 }, async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call++;
      if (call < 3) {
        return {
          ok: false,
          status: 504,
          json: async () => ({}),
          text: async () => 'Upstream timeout',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: JSON.stringify({ noteHebrew: 'קבלה...' }) }],
          usage: { input_tokens: 5, output_tokens: 5 },
        }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchFn);
    const note = await runEmitTurn('admission', { name: 'X' }, 'skill');
    expect(note).toContain('קבלה');
    expect(call).toBe(3);
  });

  // 503 is also transient — retry policy (v1.7.0+) retries all 5xx,
  // not just 504. That's the correct behavior: a 503 from the proxy is
  // typically a cold-function failure that resolves on retry.
  it(
    'retries on 503 (all 5xx are transient)',
    { timeout: 15_000 },
    async () => {
      let call = 0;
      const fetchFn = vi.fn(async () => {
        call++;
        if (call < 2) {
          return {
            ok: false,
            status: 503,
            json: async () => ({}),
            text: async () => 'service unavailable',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ type: 'text', text: JSON.stringify({ noteHebrew: 'קבלה' }) }],
            usage: { input_tokens: 3, output_tokens: 3 },
          }),
          text: async () => '',
        };
      }) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchFn);
      const note = await runEmitTurn('admission', {}, 'skill');
      expect(note).toContain('קבלה');
      expect(call).toBe(2);
    },
  );

  // 4xx (auth, body errors) must NOT retry — those never become success.
  it('does not retry 4xx errors (e.g. 401)', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call++;
      return {
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => 'invalid api key',
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchFn);
    await expect(runEmitTurn('admission', {}, 'skill')).rejects.toThrow(/401/);
    expect(call).toBe(1);
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
