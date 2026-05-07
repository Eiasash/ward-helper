/**
 * Single chokepoint for every Claude call in the app.
 *
 * Routing rule (the 3-state design):
 *
 *   State 1 — guest (no account)              → proxy
 *   State 2 — logged in, no personal key      → proxy
 *   State 3 — logged in + wardhelper_apikey   → direct to api.anthropic.com
 *
 * The personal-key path uses the `anthropic-dangerous-direct-browser-access`
 * header (required by api.anthropic.com for browser-origin requests). 401/403
 * with the user's own key throws a clear Hebrew error — we deliberately do
 * NOT silently fall back to the proxy. The user must see their key is broken
 * so they can fix it; a hidden fallback would let a stolen/expired key keep
 * "working" (via the proxy) until the next billing surprise.
 *
 * The localStorage key name (`wardhelper_apikey`) mirrors the shlav-a-mega
 * `samega_apikey` pattern. Storage is plaintext localStorage — same posture
 * as samega: a determined attacker with devtools on the same browser profile
 * recovers the key, which is acceptable because the key never leaves the
 * device's same-origin storage and PHI is already in IndexedDB plaintext.
 */
import {
  type AnthropicRequest,
  type AnthropicResponse,
  type CallOptions,
  ANTHROPIC_URL,
  ANTHROPIC_VERSION,
  MODEL_DIRECT,
  PROXY_URL,
  PROXY_SECRET,
} from '@/agent/client';
import { getCurrentUser } from '@/auth/auth';

export const LOCAL_API_KEY_LS = 'wardhelper_apikey';

const DIRECT_TIMEOUT_MS = 90_000;
const PROXY_TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = 2_000;

/** Read the personal API key from localStorage. Gated on a logged-in user — guests never get the BYOK path even if the key happens to be present. */
export function getLocalApiKey(): string | null {
  if (typeof localStorage === 'undefined') return null;
  if (!getCurrentUser()) return null;
  const raw = localStorage.getItem(LOCAL_API_KEY_LS);
  return raw && raw.trim() ? raw.trim() : null;
}

export function setLocalApiKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LOCAL_API_KEY_LS, key.trim());
}

export function clearLocalApiKey(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LOCAL_API_KEY_LS);
}

/** Used by Settings + AccountSection badges. */
export function activeAiPath(): 'direct' | 'proxy' {
  return getLocalApiKey() ? 'direct' : 'proxy';
}

/**
 * Cheap key-validation probe. Calls /v1/models (a lightweight GET) and reports
 * whether Anthropic accepts the key. Used by AccountSection before persisting.
 */
export async function validateApiKey(key: string): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, message: text.slice(0, 200) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function isTransient(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message;
  return /\bHTTP 5\d\d\b/.test(m) || /Upstream timeout/i.test(m) || /network|aborted|fetch failed|load failed/i.test(m);
}

function linkExternalAbort(external: AbortSignal | undefined, internal: AbortController): () => void {
  if (!external) return () => {};
  if (external.aborted) {
    internal.abort();
    return () => {};
  }
  const onAbort = () => internal.abort();
  external.addEventListener('abort', onAbort, { once: true });
  return () => external.removeEventListener('abort', onAbort);
}

/**
 * Direct call with the user's own key. 401/403 surface as a clear Hebrew error
 * and DO NOT trigger a proxy fallback — the user has to fix their key.
 */
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
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ ...req, model: MODEL_DIRECT }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `מפתח Anthropic האישי שלך נדחה (HTTP ${res.status}). בדוק/החלף את המפתח בהגדרות. לא בוצעה החזרה אוטומטית ל-proxy — כדי שלא תפספס שהמפתח שבור.`,
        );
      }
      throw new Error(`anthropic HTTP ${res.status}${text ? ': ' + text.slice(0, 300) : ''}`);
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
 * Single chokepoint. Picks direct vs proxy on every call (re-checked, not
 * cached) so a key save/clear takes effect on the very next request.
 */
export async function callClaude(
  req: AnthropicRequest,
  opts: CallOptions = {},
): Promise<AnthropicResponse> {
  const apiKey = getLocalApiKey();
  const maxRetries = Math.max(0, opts.retryOnTransient ?? 0);
  const externalSignal = opts.signal;

  const attempt = async (): Promise<AnthropicResponse> => {
    if (apiKey) return callDirectOnce(req, apiKey, externalSignal);
    return callProxyOnce(req, externalSignal);
  };

  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    if (externalSignal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      if (externalSignal?.aborted && (e as { name?: string })?.name === 'AbortError') {
        throw e;
      }
      if (i >= maxRetries || !isTransient(e)) break;
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (i + 1)));
    }
  }
  if (!apiKey && maxRetries > 0 && isTransient(lastErr)) {
    throw new Error(
      'הפרוקסי של Toranot אינו מספיק למסמכים ארוכים (פסק זמן 10 שניות). הגדר מפתח API אישי בהגדרות — זה פותר את הבעיה.',
    );
  }
  throw lastErr;
}
