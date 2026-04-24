import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock keystore so callAnthropic takes the proxy path consistently.
// Direct-path tests pass an explicit key via the keystore mock.
vi.mock('@/crypto/keystore', () => ({
  loadApiKey: vi.fn(async () => null),
}));

import {
  callAnthropic,
  callProxy,
  PROXY_URL,
  PROXY_SECRET,
  ANTHROPIC_URL,
  ANTHROPIC_VERSION,
  MODEL,
  MODEL_PROXY,
  MODEL_DIRECT,
  activePath,
} from '@/agent/client';
import * as keystore from '@/crypto/keystore';

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
  (keystore.loadApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('module surface', () => {
  it('exports stable URLs and model identifiers', () => {
    expect(PROXY_URL).toBe('https://toranot.netlify.app/api/claude');
    expect(ANTHROPIC_URL).toBe('https://api.anthropic.com/v1/messages');
    expect(ANTHROPIC_VERSION).toBe('2023-06-01');
    expect(MODEL_PROXY).toMatch(/^proxy:/);
    expect(MODEL_DIRECT).toMatch(/^claude-/);
  });

  it('callProxy is a legacy alias for callAnthropic (preserves backward compat)', () => {
    expect(callProxy).toBe(callAnthropic);
  });

  it('MODEL is a legacy alias for MODEL_PROXY', () => {
    expect(MODEL).toBe(MODEL_PROXY);
  });
});

describe('activePath', () => {
  it("returns 'proxy' when no API key is stored", async () => {
    (keystore.loadApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await activePath()).toBe('proxy');
  });

  it("returns 'direct' when an API key is present", async () => {
    (keystore.loadApiKey as ReturnType<typeof vi.fn>).mockResolvedValue('sk-ant-fake');
    expect(await activePath()).toBe('direct');
  });
});

describe('callAnthropic — proxy path (no API key)', () => {
  it('POSTs to PROXY_URL with x-api-secret header and JSON body', async () => {
    const fetchSpy = mockOk('hello');
    vi.stubGlobal('fetch', fetchSpy);
    const res = await callAnthropic({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 });
    expect(res.content[0]!.text).toBe('hello');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PROXY_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-api-secret']).toBe(PROXY_SECRET);
    // Proxy body does NOT inject `model` (the proxy chooses).
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
    });
  });

  it('surfaces 4xx errors with HTTP status + body excerpt', async () => {
    vi.stubGlobal('fetch', mockHttp(401, 'Unauthorized — no session or API secret'));
    await expect(callAnthropic({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 })).rejects.toThrow(
      /proxy HTTP 401.*Unauthorized/,
    );
  });

  it('surfaces 5xx without body', async () => {
    vi.stubGlobal('fetch', mockHttp(500, ''));
    await expect(callAnthropic({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 })).rejects.toThrow(
      /proxy HTTP 500/,
    );
  });

  it('does NOT retry 4xx even when retryOnTransient is set', async () => {
    const fetchSpy = mockHttp(401, 'no');
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      callAnthropic({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }, { retryOnTransient: 5 }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('callAnthropic — direct path (API key present)', () => {
  beforeEach(() => {
    (keystore.loadApiKey as ReturnType<typeof vi.fn>).mockResolvedValue('sk-ant-test');
  });

  it('POSTs to ANTHROPIC_URL with x-api-key + anthropic-version + browser-bypass headers', async () => {
    const fetchSpy = mockOk('direct ok');
    vi.stubGlobal('fetch', fetchSpy);
    const res = await callAnthropic({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 });
    expect(res.content[0]!.text).toBe('direct ok');
    const [url, init] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    // Direct path injects model into body.
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(MODEL_DIRECT);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('surfaces direct-API errors with "anthropic HTTP" prefix', async () => {
    vi.stubGlobal('fetch', mockHttp(429, 'rate limit'));
    await expect(callAnthropic({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 })).rejects.toThrow(
      /anthropic HTTP 429.*rate limit/,
    );
  });
});

describe('callAnthropic — transient retry policy (proxy path)', () => {
  it('does not retry by default (retryOnTransient unset)', async () => {
    const fetchSpy = mockHttp(504, 'Upstream timeout');
    vi.stubGlobal('fetch', fetchSpy);
    await expect(callAnthropic({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 })).rejects.toThrow(
      /proxy HTTP 504/,
    );
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
    const promise = callAnthropic(
      { messages: [{ role: 'user', content: 'x' }], max_tokens: 1 },
      { retryOnTransient: 1 },
    );
    await vi.advanceTimersByTimeAsync(2_500);
    const res = await promise;
    expect(res.content[0]!.text).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('also retries on generic 5xx (transient detector matches /HTTP 5dd/)', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}), text: async () => 'Bad Gateway' })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'recovered' }], usage: { input_tokens: 1, output_tokens: 1 } }),
        text: async () => '',
      }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    const promise = callAnthropic(
      { messages: [{ role: 'user', content: 'x' }], max_tokens: 1 },
      { retryOnTransient: 1 },
    );
    await vi.advanceTimersByTimeAsync(2_500);
    const res = await promise;
    expect(res.content[0]!.text).toBe('recovered');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('after exhausting retries on proxy path, throws the Hebrew "set an API key" guidance', async () => {
    const fetchSpy = mockHttp(504, 'Upstream timeout');
    vi.stubGlobal('fetch', fetchSpy);
    const promise = callAnthropic(
      { messages: [{ role: 'user', content: 'x' }], max_tokens: 1 },
      { retryOnTransient: 2 },
    );
    promise.catch(() => {}); // suppress unhandled-rejection chatter under fake timers
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).rejects.toThrow(/Toranot.*מפתח API|מפתח API.*Toranot/);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
