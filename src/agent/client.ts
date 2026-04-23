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
export const PROXY_SECRET = 'shlav-a-mega-2026';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// Model string for direct calls. Sonnet 4.6 matches what the proxy selects.
export const MODEL_DIRECT = 'claude-sonnet-4-6';
// Informational label for proxy path (server chooses the actual model).
export const MODEL_PROXY = 'proxy:claude-sonnet-4-6';

// Timeouts. The client abort timer is the ceiling; Anthropic's own timeout
// for non-streaming messages is typically well under this.
const DIRECT_TIMEOUT_MS = 90_000; // admission emits can hit 40-50s on a cold path
const PROXY_TIMEOUT_MS = 30_000; // proxy itself bails at ~10s; give it room to fail fast

/** Retry policy. Callers opt in — default is 0 (single call). */
export interface CallOptions {
  /** Max additional attempts on transient failure (504/timeout/network). Default 0. */
  retryOnTransient?: number;
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
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicRequest {
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
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

async function callDirectOnce(
  req: AnthropicRequest,
  apiKey: string,
): Promise<AnthropicResponse> {
  const controller = new AbortController();
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
  }
}

async function callProxyOnce(req: AnthropicRequest): Promise<AnthropicResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
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
  } finally {
    clearTimeout(timer);
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

  const attempt = async (): Promise<AnthropicResponse> => {
    if (apiKey) return callDirectOnce(req, apiKey);
    return callProxyOnce(req);
  };

  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
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
