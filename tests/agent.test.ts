import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runExtractTurn, runEmitTurn } from '@/agent/loop';
import type { CaptureBlock } from '@/camera/session';

/**
 * Build a single-image CaptureBlock list from a data URL — keeps tests that
 * predate the blocks API readable while still exercising the new signature.
 */
function imageBlocks(...urls: string[]): CaptureBlock[] {
  return urls.map((url) => ({
    kind: 'image',
    id: 'img-' + Math.random(),
    dataUrl: url,
    blobUrl: 'blob:fake',
    sourceLabel: 'gallery',
    addedAt: 0,
  }));
}

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
      imageBlocks('data:image/jpeg;base64,/9j/'),
      'SKILL CONTENT azma-ui',
    );
    expect(result.fields.name).toBe('דוד כהן');
    expect(result.confidence['name']).toBe('high');
    expect(result.confidence['teudatZehut']).toBe('low');
  });

  it('strips ```json code fences if the model ignored instructions', async () => {
    const payload = '```json\n{"fields":{"name":"X"},"confidence":{}}\n```';
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill');
    expect(result.fields.name).toBe('X');
  });

  it('throws when the model wraps JSON in prose (no brace-extraction fallback in v1.18.1)', async () => {
    // v1.18.0 silently extracted the outermost {...} from prose-wrapped responses.
    // v1.18.1 enforces fence-only tolerance: model must comply with the
    // "no preamble" instruction or the UI shows a regenerate prompt.
    const payload = 'Here is the JSON:\n{"fields":{"age":77},"confidence":{}}\nHope that helps!';
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    await expect(
      runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill'),
    ).rejects.toThrow(/failed to parse JSON/);
  });

  it('backfills missing confidence to empty object', async () => {
    const payload = JSON.stringify({ fields: { name: 'Y' } });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill');
    expect(result.confidence).toEqual({});
  });

  it('throws on truly non-JSON response', async () => {
    vi.stubGlobal('fetch', mockProxyResponse('plain text, no JSON at all'));
    await expect(
      runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill'),
    ).rejects.toThrow(/failed to parse JSON/);
  });

  it('throws on invalid data URL', async () => {
    vi.stubGlobal('fetch', mockProxyResponse('{}'));
    await expect(
      runExtractTurn(imageBlocks('not-a-data-url'), 'skill'),
    ).rejects.toThrow('invalid data URL');
  });

  it(
    'retries transient 500 once, then reports the final HTTP error',
    { timeout: 15_000 },
    async () => {
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          calls++;
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
            text: async () => 'internal server error',
          };
        }),
      );
      // Extract sets retryOnTransient: 1 (see loop.ts). So 2 attempts total
      // on 500, then the real error surfaces. Friendly Hebrew re-wrap only
      // fires when no API key is set AND retries exhausted — which is
      // exactly what happens in this test (no keystore mock), so we expect
      // the Hebrew message OR the raw HTTP 500, depending on keystore state.
      await expect(
        runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill'),
      ).rejects.toThrow(/500|הפרוקסי/);
      expect(calls).toBe(2);
    },
  );

  it('sends image with media_type jpeg for jpeg data URL', async () => {
    const fetchFn = mockProxyResponse(
      JSON.stringify({ fields: {}, confidence: {} }),
    );
    vi.stubGlobal('fetch', fetchFn);
    await runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill');
    const body = JSON.parse((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]![1].body) as {
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
    };
    // content[0] is the leading prompt text; image follows.
    const imageItem = body.messages[0]!.content.find((c) => c.type === 'image');
    expect(imageItem?.source?.media_type).toBe('image/jpeg');
  });

  it('falls back to image/jpeg for unknown media type', async () => {
    const fetchFn = mockProxyResponse(
      JSON.stringify({ fields: {}, confidence: {} }),
    );
    vi.stubGlobal('fetch', fetchFn);
    await runExtractTurn(imageBlocks('data:image/bmp;base64,abc'), 'skill');
    const body = JSON.parse((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]![1].body) as {
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
    };
    const imageItem = body.messages[0]!.content.find((c) => c.type === 'image');
    expect(imageItem?.source?.media_type).toBe('image/jpeg');
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
    const result = await runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill');
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
    const result = await runExtractTurn(imageBlocks('data:image/jpeg;base64,/9j/'), 'skill');
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

  it('parses ```json-fenced response (v1.18.1 admission regression fix)', async () => {
    const payload = '```json\n{"noteHebrew":"test"}\n```';
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const note = await runEmitTurn('admission', {}, 'skill');
    expect(note).toBe('test');
  });

  it('parses bare JSON without fences', async () => {
    vi.stubGlobal('fetch', mockProxyResponse('{"noteHebrew":"test"}'));
    const note = await runEmitTurn('admission', {}, 'skill');
    expect(note).toBe('test');
  });

  it('throws on non-JSON garbage instead of silently returning the raw body', async () => {
    // v1.18.0 returned `text` here so the user could see Hebrew prose; v1.18.1
    // throws so the UI shows the regenerate pill — copying ```json into
    // Chameleon is the failure mode this hotfix exists to prevent.
    vi.stubGlobal('fetch', mockProxyResponse('קבלה חופשית של דוד'));
    await expect(runEmitTurn('admission', {}, 'skill')).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('throws when JSON parses but is missing the noteHebrew field', async () => {
    vi.stubGlobal('fetch', mockProxyResponse('{"wrong":"field"}'));
    await expect(runEmitTurn('admission', {}, 'skill')).rejects.toThrow(
      /missing noteHebrew/,
    );
  });
});
