/**
 * AbortError-final invariant — fast-failing vitest counterpart to
 * scripts/lib/scenAiEmitRetry.mjs (the mega-bot scenario).
 *
 * Covers `src/ai/dispatch.ts:249`:
 *
 *     if (externalSignal?.aborted && (e as { name?: string })?.name === 'AbortError') {
 *       throw e;  // external abort → final, NEVER retry
 *     }
 *
 * The bot scenario exercises this in a real browser under the persona
 * rotation; this vitest pins the same observable signature at the unit
 * level so a regression fails CI within seconds rather than waiting for
 * the next bot run.
 *
 * The probe distinguishes L249 (the invariant under test) from L242
 * (the pre-attempt guard one line above) via TWO observables:
 *
 *   - Message identity. L249 throws the original AbortError from the
 *     wrapped fetch (message === STUB_ABORT_MESSAGE here). L242 throws
 *     a fresh `new DOMException('aborted', 'AbortError')` whose message
 *     is the literal `'aborted'`.
 *   - Timing. L249 throws synchronously after fetch reject (< 200ms in
 *     this test). L242 only fires after `RETRY_BACKOFF_MS * (i + 1)`
 *     = 2000ms of sleep on the next iteration.
 *
 * Calibration §3 evidence: commenting out lines 249-251 in dispatch.ts
 * makes the `message === STUB_ABORT_MESSAGE` assertion fail (the fresh
 * DOMException leaks through with message === 'aborted'). Restoring
 * the lines makes it pass. The test also asserts elapsed time < 1500ms,
 * which independently catches the same regression via the timing axis.
 *
 * Why both assertions when either alone is sufficient: the calibration
 * is more defensible when two independent observables corroborate. If
 * the test ever passes one assertion but fails the other, the
 * regression is partial (e.g., L249 replaced by a fast-path that
 * throws the wrong identity) and worth pinning specifically.
 *
 * STEP 0 deviation note: the kickoff (docs/audit/2026-05-20-scen-ai-
 * emit-retry-kickoff.md) §1.5 specified vitest only for the bot adapter
 * attach gate. Adding this dispatch-level test as well because the
 * adapter test alone doesn't prove the regression class is detectable
 * — the bot scenario's interpretation logic needs an independent unit
 * pin, otherwise a refactor that breaks both leaves no detector.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { callClaude } from '@/ai/dispatch';

const STUB_ABORT_MESSAGE = 'The user aborted a request (test stub)';

// AI URL patterns mirror src/dev/__aiBotApi.ts. Kept inline rather than
// re-exported because this test imports dispatch directly and shouldn't
// have a transitive dependency on the bot adapter.
const AI_URL_PATTERNS: RegExp[] = [/\/v1\/messages(\b|$)/, /\/api\/claude(\b|$)/];

let originalFetch: typeof globalThis.fetch;

function installCancelFetchStub(): { getFetchCount: () => number } {
  let fetchCount = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url ?? '';
    const isAi = AI_URL_PATTERNS.some((re) => re.test(url));
    if (!isAi) return originalFetch(input, init);
    fetchCount++;
    const signal = init?.signal ?? null;
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException(STUB_ABORT_MESSAGE, 'AbortError'));
        return;
      }
      if (signal) {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException(STUB_ABORT_MESSAGE, 'AbortError')),
          { once: true },
        );
      }
    });
  }) as typeof globalThis.fetch;
  return { getFetchCount: () => fetchCount };
}

describe('callClaude — AbortError-final invariant (dispatch.ts:249)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('wardhelper_apikey');
      localStorage.removeItem('ward-helper.auth.user');
    } catch {
      /* localStorage disabled — proxy path will be taken regardless */
    }
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  test('preserves original AbortError identity and throws synchronously when user cancels mid-fetch', async () => {
    const probe = installCancelFetchStub();
    const ctrl = new AbortController();
    const t0 = Date.now();

    // Abort 300ms after the call starts. Long enough that fetch fires
    // first (the stub's promise registers the abort listener before
    // returning); short enough that the test stays under 1s on GREEN.
    setTimeout(() => ctrl.abort(), 300);

    let caught: unknown;
    try {
      await callClaude(
        { messages: [{ role: 'user', content: 'noop' }], max_tokens: 1 },
        { retryOnTransient: 1, signal: ctrl.signal },
      );
      throw new Error('expected callClaude to throw');
    } catch (e) {
      caught = e;
    }

    const elapsed = Date.now() - t0;
    const err = caught as { name?: string; message?: string };

    expect(err.name).toBe('AbortError');

    // Primary probe — L249-removal regression makes this fail with
    // message === 'aborted' (the L242 DOMException fingerprint).
    expect(err.message).toBe(STUB_ABORT_MESSAGE);

    // Independent probe — L249-removal regression also makes this fail
    // because the retry loop sleeps RETRY_BACKOFF_MS=2000ms before L242
    // fires on the next iteration.
    expect(elapsed).toBeLessThan(1500);

    // Sanity — fetch fired exactly once. > 1 would mean BOTH L242 and
    // L249 are broken (the scenario's `unexpected-retry-fetch` case);
    // 0 would mean the stub didn't catch the call.
    expect(probe.getFetchCount()).toBe(1);
  });

  test('retryOnTransient: 0 — single attempt, same identity preservation', async () => {
    // With maxRetries=0 the loop only iterates once, so L249 and L252's
    // natural break converge. Test included to pin the no-retry path's
    // behavior matches expectations (and so a future refactor that
    // treats maxRetries=0 specially has a regression guard).
    const probe = installCancelFetchStub();
    const ctrl = new AbortController();
    const t0 = Date.now();

    setTimeout(() => ctrl.abort(), 300);

    let caught: unknown;
    try {
      await callClaude(
        { messages: [{ role: 'user', content: 'noop' }], max_tokens: 1 },
        { retryOnTransient: 0, signal: ctrl.signal },
      );
      throw new Error('expected callClaude to throw');
    } catch (e) {
      caught = e;
    }

    const elapsed = Date.now() - t0;
    const err = caught as { name?: string; message?: string };

    expect(err.name).toBe('AbortError');
    expect(err.message).toBe(STUB_ABORT_MESSAGE);
    expect(elapsed).toBeLessThan(1500);
    expect(probe.getFetchCount()).toBe(1);
  });
});
