/**
 * Claude access via the Toranot proxy (toranot.netlify.app/api/claude).
 *
 * Why the proxy instead of api.anthropic.com + BYO key:
 *   - Mobile Chrome silently stalls on multi-MB POSTs to api.anthropic.com.
 *     The proxy runs on Netlify edge, offloading the large upload.
 *   - No CORS preflight to api.anthropic.com.
 *   - No BYO-key friction — same shared secret your other PWAs use.
 *
 * Tradeoff: the proxy strips the `tools` / `tool_choice` fields, so we
 * drive structured output via JSON-mode prompting instead of the Anthropic
 * tool-use API. `runExtractTurn` and `runEmitTurn` parse strict JSON from
 * the model's text response.
 */

export const PROXY_URL = 'https://toranot.netlify.app/api/claude';
export const PROXY_SECRET = 'shlav-a-mega-2026';

// Proxy defaults to claude-sonnet-4-6. The model string is informational
// only — the proxy server chooses the actual model.
export const MODEL = 'proxy:claude-sonnet-4-6';

const TIMEOUT_MS = 60_000;

/**
 * The Toranot proxy runs on Netlify Functions with a ~10s execution budget.
 * Opus 4.7 generating a long admission note regularly exceeds that, surfacing
 * as `proxy HTTP 504: Upstream timeout` to the client. A single cold-start
 * also often produces a spurious 504 that a retry resolves.
 *
 * Retry policy (callers opt in): up to 2 attempts on 504, 2s backoff between.
 * Non-504 errors (auth, body, 500, abort) fail fast — retrying them just
 * burns the user's tokens on a call that will never succeed.
 */
export interface CallProxyOptions {
  /** Max additional attempts on 504 (0 = no retry, single call). Default 0. */
  retryOn504?: number;
}

const RETRY_BACKOFF_MS = 2_000;

function isProxy504(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /proxy HTTP 504\b/.test(e.message);
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

async function callProxyOnce(req: AnthropicRequest): Promise<AnthropicResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

export async function callProxy(
  req: AnthropicRequest,
  opts: CallProxyOptions = {},
): Promise<AnthropicResponse> {
  const maxRetries = Math.max(0, opts.retryOn504 ?? 0);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callProxyOnce(req);
    } catch (e) {
      lastErr = e;
      if (attempt >= maxRetries || !isProxy504(e)) break;
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
    }
  }
  throw lastErr;
}
