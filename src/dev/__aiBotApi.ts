/**
 * Bot-only AI-dispatch adapter — exposes callClaude + a fetch interceptor
 * to `window` for Playwright `page.evaluate()` use. Strictly gated on
 * `localStorage['ward-helper.botApi'] === '1'`; the module imports ship in
 * the bundle only via dynamic import from main.tsx, and the attachment
 * function is a strict no-op without the flag set.
 *
 * Required by `scripts/lib/scenAiEmitRetry.mjs` to cover the AbortError-
 * final invariant at `src/ai/dispatch.ts:249` — when the user aborts a
 * Claude call mid-fetch, the retry loop MUST surface the original
 * AbortError and MUST NOT sleep RETRY_BACKOFF_MS before throwing.
 *
 * The scenario distinguishes L249 (the invariant) from L242 (the pre-
 * attempt guard) via two observables:
 *
 *   1. Error identity. L249 propagates the AbortError the wrapped fetch
 *      threw (message: a distinctive stub string set by the scenario).
 *      L242 throws a fresh `new DOMException('aborted', 'AbortError')`
 *      whose message is the literal `'aborted'`.
 *   2. Timing. L249 throws synchronously after fetch reject. L242 only
 *      fires after `RETRY_BACKOFF_MS * (i + 1)` ms of sleep.
 *
 * Security profile — the localStorage gate is the only thing between
 * production users and a window-attached `callClaude`. Threat model:
 * an XSS payload already has full window access and can call any
 * imported module via bundle archaeology; this surface makes that
 * uplift cheaper but does not introduce a new capability. Production
 * users never set the flag; the attachment IIFE returns immediately
 * if the flag is absent or invalid. Same posture as `__phiBotApi.ts`.
 *
 * Not a coverage badge for the dispatch path — see tests/clientProxy.test.ts
 * and tests/dispatchErrorTranslation.test.ts for unit coverage. This file's
 * only purpose is bot-runtime invariant probing.
 */
import { callClaude } from '@/ai/dispatch';
import type { AnthropicRequest, AnthropicResponse, CallOptions } from '@/agent/client';

export interface AiBotApi {
  /**
   * Direct handle to the production dispatch function. The scenario
   * supplies its own AbortController to exercise the cancel path.
   */
  callClaude: (req: AnthropicRequest, opts?: CallOptions) => Promise<AnthropicResponse>;
  /**
   * Replace globalThis.fetch with a wrapper that, for AI-endpoint URLs
   * (api.anthropic.com/v1/messages or toranot.netlify.app/api/claude),
   * returns a never-resolving promise that throws an AbortError on
   * signal abort. Non-AI URLs pass through to the original fetch.
   *
   * The thrown AbortError's `message` is set to `stubMessage` so the
   * scenario can distinguish L249-preserved-original (message ===
   * stubMessage) from L242-fresh-throw (message === 'aborted'). The
   * default stub mirrors Chromium's user-cancel message; pass a unique
   * value to make the probe deterministic across browser engines.
   *
   * Counts every AI-URL call. Subsequent installs are no-ops (the
   * first install caches the original fetch; re-wrapping would double-
   * wrap and break passthrough). Call `uninstallAiFetchInterceptor()`
   * + reinstall if you need to reset.
   */
  installAiFetchInterceptor: (stubMessage?: string) => void;
  /** Restore the original globalThis.fetch and reset the counter. */
  uninstallAiFetchInterceptor: () => void;
  /** Count of fetch calls targeting AI endpoints since last reset/install. */
  getFetchCount: () => number;
  /** Reset the counter without uninstalling the interceptor. */
  resetFetchCount: () => void;
}

declare global {
  interface Window {
    __aiBotApi?: AiBotApi;
  }
}

const BOT_API_FLAG = 'ward-helper.botApi';

const AI_URL_PATTERNS: RegExp[] = [
  /\/v1\/messages(\b|$)/,
  /\/api\/claude(\b|$)/,
];

export function attachAiBotApiIfEnabled(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(BOT_API_FLAG) !== '1') return;
  } catch {
    return;
  }

  let fetchCount = 0;
  let originalFetch: typeof globalThis.fetch | null = null;

  const installAiFetchInterceptor: AiBotApi['installAiFetchInterceptor'] = (
    stubMessage = 'The user aborted a request',
  ) => {
    if (originalFetch) return;
    originalFetch = globalThis.fetch.bind(globalThis);
    fetchCount = 0;

    const wrapped: typeof globalThis.fetch = (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url ?? '';
      const isAi = AI_URL_PATTERNS.some((re) => re.test(url));
      if (!isAi) {
        return originalFetch!(input, init);
      }
      fetchCount++;
      const signal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException(stubMessage, 'AbortError'));
          return;
        }
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException(stubMessage, 'AbortError'));
            },
            { once: true },
          );
        }
      });
    };
    globalThis.fetch = wrapped;
  };

  const uninstallAiFetchInterceptor: AiBotApi['uninstallAiFetchInterceptor'] = () => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = null;
    }
    fetchCount = 0;
  };

  window.__aiBotApi = {
    callClaude,
    installAiFetchInterceptor,
    uninstallAiFetchInterceptor,
    getFetchCount: () => fetchCount,
    resetFetchCount: () => {
      fetchCount = 0;
    },
  };
}
