/**
 * Claude access with automatic fallback.
 *
 * Path A (preferred, when user has configured their own API key):
 *   direct POST to api.anthropic.com/v1/messages. No 10s Netlify Function
 *   ceiling — Anthropic's own timeouts apply (5 minutes streaming, ~60s
 *   non-streaming). Long admission/discharge emits actually complete.
 *
 * Path B (fallback, when no user key is set):
 *   POST to the Toranot proxy (toranot.netlify.app/api/claude). This is the
 *   text-only path shared with the three board-exam PWAs. It has a ~10s
 *   upstream timeout which is NOT enough for long emit calls — users will
 *   see 504s. The Settings screen prompts for a key for exactly this reason.
 *
 * Why the architecture looks like this:
 *   A previous refactor removed the @anthropic-ai/sdk and routed everything
 *   through the proxy. That's fine for chat completions in the study apps
 *   where prompts are short and outputs are a few hundred tokens — but ward-
 *   helper emits admission notes with 25 KB of skill content + 4096 output
 *   tokens, which regularly hits 20-40s of compute. The proxy's Netlify-
 *   Function ceiling truncates the response with HTTP 504.
 *
 *   Going direct with a user's own key is the honest fix. It also restores
 *   the original BYO-key design the CSP was built around.
 */

import { loadApiKey } from '@/crypto/keystore';

export const PROXY_URL = 'https://toranot.netlify.app/api/claude';
export const PROXY_SECRET = 'shlav-a-mega-1f97f311d307-2026';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// Model string for direct calls. Sonnet 4.6 matches what the proxy selects.
export const MODEL_DIRECT = 'claude-opus-4-7';
// Informational label for proxy path (server chooses the actual model).
export const MODEL_PROXY = 'proxy:claude-opus-4-7';

// Timeouts. The client abort timer is the ceiling; Anthropic's own timeout
// for non-streaming messages is typically well under this.
const DIRECT_TIMEOUT_MS = 90_000; // admission emits can hit 40-50s on a cold path
const PROXY_TIMEOUT_MS = 30_000; // proxy itself bails at ~10s; give it room to fail fast

/** Retry policy. Callers opt in — default is 0 (single call). */
export interface CallOptions {
  /** Max additional attempts on transient failure (504/timeout/network). Default 0. */
  retryOnTransient?: number;
  /**
   * External AbortSignal — when fired, the in-flight fetch is canceled
   * and any pending retry-backoff is short-circuited. Used by the batch
   * SOAP runner so a "בטל" tap on patient 3 of 5 cancels the in-flight
   * extract immediately rather than waiting up to 90s for it to finish.
   * Distinct from the per-call internal AbortController used for the
   * timeout — both signals are linked: either one firing aborts the
   * underlying fetch.
   */
  signal?: AbortSignal;
}

const RETRY_BACKOFF_MS = 2_000;

function isTransient(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message;
  return (
    /\bHTTP 5\d\d\b/.test(m) || // any 5xx
    /Upstream timeout/i.test(m) ||
    /network|aborted|fetch failed|load failed/i.test(m)
  );
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
        data: string;
      };
    }
  | {
      // PDF documents: Sonnet 4.6 reads them natively. Same base64 envelope
      // as images, distinct content-block type.
      type: 'document';
      source: {
        type: 'base64';
        media_type: 'application/pdf';
        data: string;
      };
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/** Adaptive thinking effort dial. Opus 4.7 only — used as soft guidance for how much reasoning the model allocates. */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicRequest {
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  /** Set to {type:'adaptive'} to enable Opus 4.7 adaptive thinking. Off when omitted. */
  thinking?: { type: 'adaptive' | 'disabled' };
  /** Soft hint for adaptive thinking depth; ignored when thinking is off/absent. */
  output_config?: { effort: ThinkingEffort };
}

export interface AnthropicResponse {
  content: Array<{ type: 'text'; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type RequestPath = 'direct' | 'proxy';

/** For Settings UI: which path is active right now? */
export async function activePath(): Promise<RequestPath> {
  const key = await loadApiKey();
  return key ? 'direct' : 'proxy';
}

/**
 * Wire an external AbortSignal so its abort propagates to the per-call
 * internal AbortController. Returns a teardown that detaches the listener
 * so we don't leak event listeners when the call resolves normally.
 *
 * Idempotent on already-aborted external signals — fires the internal
 * abort synchronously before the caller has a chance to start the fetch,
 * so the fetch fails fast with AbortError instead of consuming network.
 */
function linkExternalAbort(
  external: AbortSignal | undefined,
  internal: AbortController,
): () => void {
  if (!external) return () => {};
  if (external.aborted) {
    internal.abort();
    return () => {};
  }
  const onAbort = () => internal.abort();
  external.addEventListener('abort', onAbort, { once: true });
  return () => external.removeEventListener('abort', onAbort);
}

async function callDirectOnce(
  req: AnthropicRequest,
  apiKey: string,
  externalSignal?: AbortSignal,
): Promise<AnthropicResponse> {
  const controller = new AbortController();
  const detach = linkExternalAbort(externalSignal, controller);
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Required to call api.anthropic.com from a browser. Low risk here
        // because the key lives only on this device, XOR-obfuscated in IDB,
        // and never leaves the app.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ ...req, model: MODEL_DIRECT }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `anthropic HTTP ${res.status}${text ? ': ' + text.slice(0, 300) : ''}`,
      );
    }
    return (await res.json()) as AnthropicResponse;
  } finally {
    clearTimeout(timer);
    detach();
  }
}

async function callProxyOnce(
  req: AnthropicRequest,
  externalSignal?: AbortSignal,
): Promise<AnthropicResponse> {
  const controller = new AbortController();
  const detach = linkExternalAbort(externalSignal, controller);
  const timer = setTimeout(() => {
    // Log the timeout abort path explicitly. Browser-level cancels (user navigated
    // away mid-call, network interruption) won't reach this branch — they surface
    // as net::ERR_ABORTED in the catch below. Visibility for "AI never returned"
    // user reports — was opaque before, surfaced by 1h chaos run 2026-05-05.
    console.warn('[ai] proxy abort fired (timeout)', { ms: PROXY_TIMEOUT_MS });
    controller.abort();
  }, PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': PROXY_SECRET,
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`proxy HTTP ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`);
    }
    return (await res.json()) as AnthropicResponse;
  } catch (err) {
    // Distinguish the three failure flavors so future "request canceled" reports
    // are diagnosable without re-running chaos:
    //   - controller.signal.aborted → our 30s timeout fired
    //   - err.name === 'AbortError' from elsewhere → browser-level cancel (nav, etc.)
    //   - other → real network/HTTP error (already covered by msg above)
    if (controller.signal.aborted) {
      console.warn('[ai] proxy request aborted by client timeout');
    } else if (err && (err as { name?: string }).name === 'AbortError') {
      console.warn('[ai] proxy request aborted by browser (nav or external cancel)');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    detach();
  }
}

/**
 * Single call surface. Picks direct-API when an API key is present, proxy
 * otherwise. `callAnthropic` is the only entry point the agent loop should use.
 */
export async function callAnthropic(
  req: AnthropicRequest,
  opts: CallOptions = {},
): Promise<AnthropicResponse> {
  const apiKey = await loadApiKey();
  const maxRetries = Math.max(0, opts.retryOnTransient ?? 0);
  const externalSignal = opts.signal;

  const attempt = async (): Promise<AnthropicResponse> => {
    if (apiKey) return callDirectOnce(req, apiKey, externalSignal);
    return callProxyOnce(req, externalSignal);
  };

  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    // External abort short-circuits both the next attempt and the
    // backoff between attempts. Without this check, an abort during
    // the 2s/4s sleep would silently roll into another attempt.
    if (externalSignal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      // AbortError on an externally-aborted call is a final result, not
      // transient — don't retry, surface it to the caller.
      if (
        externalSignal?.aborted &&
        (e as { name?: string })?.name === 'AbortError'
      ) {
        throw e;
      }
      if (i >= maxRetries || !isTransient(e)) break;
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (i + 1)));
    }
  }
  // Re-throw with a friendlier Hebrew message ONLY when we exhausted retries
  // on the proxy path — that's the "proxy is too slow for long notes" case
  // that users need guidance for. A single-attempt 5xx surfaces the real
  // error string unchanged (for debugging + the extract path which doesn't
  // retry).
  if (!apiKey && maxRetries > 0 && isTransient(lastErr)) {
    throw new Error(
      'הפרוקסי של Toranot אינו מספיק למסמכים ארוכים (פסק זמן 10 שניות). הגדר מפתח API אישי בהגדרות — זה פותר את הבעיה.',
    );
  }
  throw lastErr;
}

// Legacy aliases — keep for gradual migration. New code should use callAnthropic.
export const callProxy = callAnthropic;
export const MODEL = MODEL_PROXY;
