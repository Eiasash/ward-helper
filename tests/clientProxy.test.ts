import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callProxy, PROXY_URL, PROXY_SECRET, MODEL } from '@/agent/client';

function mockOk(text = '{}') {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } }),
    text: async () => '',
  })) as unknown as typeof fetch;
}

function mockHttp(status: number, body = '') {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('callProxy — happy path', () => {
  it('POSTs to PROXY_URL with the secret header and JSON body', async () => {
    const fetchSpy = mockOk('hello');
    vi.stubGlobal('fetch', fetchSpy);
    const res = await callProxy({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 });
    expect(res.content[0]!.text).toBe('hello');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PROXY_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-api-secret']).toBe(PROXY_SECRET);
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
    });
  });

  it('exports PROXY_URL pointing at the Toranot proxy', () => {
    expect(PROXY_URL).toBe('https://toranot.netlify.app/api/claude');
  });

  it('exports a model identifier (not an Anthropic model ID)', () => {
    expect(MODEL).toMatch(/^proxy:/);
  });
});

describe('callProxy — error surfacing', () => {
  it('throws with HTTP status + body excerpt on 4xx', async () => {
    vi.stubGlobal('fetch', mockHttp(401, 'Unauthorized — no session or API secret'));
    await expect(
      callProxy({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }),
    ).rejects.toThrow(/proxy HTTP 401.*Unauthorized/);
  });

  it('throws with HTTP status on 500 even without body', async () => {
    vi.stubGlobal('fetch', mockHttp(500, ''));
    await expect(
      callProxy({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }),
    ).rejects.toThrow(/proxy HTTP 500/);
  });

  it('does NOT retry on 401 even when retryOn504 is set', async () => {
    const fetchSpy = mockHttp(401, 'no');
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      callProxy({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }, { retryOn504: 5 }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('callProxy — 504 retry policy', () => {
  it('does not retry by default (retryOn504 unset)', async () => {
    const fetchSpy = mockHttp(504, 'Upstream timeout');
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      callProxy({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }),
    ).rejects.toThrow(/proxy HTTP 504/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once on 504 then succeeds', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false, status: 504, json: async () => ({}), text: async () => 'Upstream timeout',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
        text: async () => '',
      }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    const promise = callProxy(
      { messages: [{ role: 'user', content: 'x' }], max_tokens: 1 },
      { retryOn504: 1 },
    );
    await vi.advanceTimersByTimeAsync(2_500); // backoff = 2s × (attempt+1)
    const res = await promise;
    expect(res.content[0]!.text).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caps retries at retryOn504 and propagates the last 504', async () => {
    const fetchSpy = mockHttp(504, 'Upstream timeout');
    vi.stubGlobal('fetch', fetchSpy);
    const promise = callProxy(
      { messages: [{ role: 'user', content: 'x' }], max_tokens: 1 },
      { retryOn504: 2 },
    );
    promise.catch(() => {}); // suppress unhandled rejection in fake timers
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).rejects.toThrow(/proxy HTTP 504/);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
