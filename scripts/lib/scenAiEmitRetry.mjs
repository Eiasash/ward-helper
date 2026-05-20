/**
 * AbortError-final invariant scenario — fixture-only, single-shot per
 * persona. Covers `src/ai/dispatch.ts:249`:
 *
 *     if (externalSignal?.aborted && (e as { name?: string })?.name === 'AbortError') {
 *       throw e;  // external abort → final, NEVER retry
 *     }
 *
 * A regression that swallows the abort and lets the retry loop iterate
 * after a user cancel would either (a) re-fire a real fetch — a 20-40s
 * emit against an already-canceled user intent — or (b) sleep
 * RETRY_BACKOFF_MS before throwing a *different* AbortError than the
 * original. The kickoff (`docs/audit/2026-05-20-scen-ai-emit-retry-kickoff.md`)
 * cited (a) as the primary probe; STEP 0 surfaced that L242 (the
 * pre-attempt guard) prevents (a) even when L249 is removed, so the
 * adapted probe targets (b) instead — see the §STEP 0 deviation block
 * in the PR body.
 *
 * Adapted probe (load-bearing):
 *
 *   1. PRIMARY HIGH `wrong-error-on-cancel` — fires when BOTH:
 *      - lastError.message === 'aborted'  (the literal L242 DOMException
 *        message, distinguishable from the stubMessage the scenario
 *        injected into the wrapped fetch's AbortError)
 *      - msAfterCancel >= CANCEL_DELAY_HIGH_MS  (≈ RETRY_BACKOFF_MS sleep
 *        before L242 catches on iter 2)
 *      Both signals together = unambiguous L249 removal. Either alone
 *      could be engine drift or sleep-timer jitter.
 *
 *   2. SECONDARY MEDIUM `cancel-throw-delayed` — fires when timing
 *      regressed but message held. UX dead-end: cancel feels broken
 *      for 2s even though the error eventually lands. Worth surfacing
 *      but does not fail the scenario.
 *
 *   3. SECONDARY MEDIUM `wrong-error-identity` — fires when message
 *      regressed but timing held. Implies L249 was replaced by a fast-
 *      path that throws the wrong identity (an unusual refactor, but
 *      worth catching).
 *
 *   4. INFORMATIONAL HIGH `unexpected-retry-fetch` — fires when fetch
 *      count rises above 1. If this ever fires, BOTH L242 and L249 are
 *      broken — a more serious regression than the scenario was designed
 *      to catch. Logging as HIGH so the audit doesn't miss it.
 *
 * §3 detector-armed — calibration procedure: comment out L249-251 in
 * src/ai/dispatch.ts locally and confirm this scenario goes RED with a
 * `wrong-error-on-cancel` HIGH. Restore and confirm GREEN. NOT in CI.
 *
 * Why not vitest? The invariant is in a runtime code path that the
 * mega-bot fleet exercises on every CI bot run; integrating into the
 * persona rotation makes regression detection automatic. Unit tests
 * for translateAnthropicError + the retry loop's transient detection
 * already exist (tests/clientProxy.test.ts, tests/dispatchErrorTranslation.test.ts)
 * — this fills the abort-final gap they don't cover.
 *
 * Spec §6 simplification: the kickoff specified a UI-driven flow
 * (register synthetic user → add patient → trigger admission emit →
 * cancel via the בטל button). Since the invariant lives in the dispatch
 * function itself, the scenario invokes callClaude directly via
 * window.__aiBotApi.callClaude with a controlled AbortSignal — no
 * register, no patient, no real API token spend, no UI flakiness. The
 * code path under test is identical; the wiring around it is bot-side.
 */
import { sleep, rand } from './megaPersona.mjs';

// Distinctive stub the wrapped fetch throws on abort. Chosen to mirror
// Chromium's real user-cancel message format ("The user aborted a
// request") so an absent-or-broken interceptor doesn't accidentally
// produce a passing GREEN; the L242 message is the literal 'aborted'
// which is unmistakably different. Do NOT change to 'aborted' or any
// substring of it without re-examining the assertion logic below.
const STUB_ABORT_MESSAGE = 'The user aborted a request (bot stub)';

// Fire abort `CANCEL_AFTER_MS` after the AI call starts. Needs to be:
//  - long enough for the fetch to actually fire (interceptor counter ≥ 1)
//  - short enough that a real bot tick stays bounded
// 1000ms is well above the < 50ms typical fetch-fire latency in JSDOM /
// Playwright and well below any plausible UI latency budget.
const CANCEL_AFTER_MS = 1000;

// Wait this long AFTER firing abort for the error to surface. With L249
// present, we expect < 200ms. With L249 removed, RETRY_BACKOFF_MS sleeps
// for 2000ms before L242 fires. 3500ms gives 1.5s margin even on slow CI.
const SETTLE_AFTER_CANCEL_MS = 3500;

// Threshold for the timing probe — if the error landed within this many
// ms of the cancel, L249 was present. Set conservatively (3/4 of the
// 2000ms RETRY_BACKOFF_MS) to absorb event-loop jitter.
const CANCEL_DELAY_HIGH_MS = 1500;

// Spec §1.1 — fixture-only. The scenario does not register users or
// mutate auth state, but it DOES replace globalThis.fetch for the AI
// endpoints, which would corrupt a non-fixture run's real emits.
// FIXTURE_MODE gate matches scenPhiColdUnlock.
const FIXTURE_MODE = process.env.WARD_BOT_FIXTURE === '1';

export async function scenAiEmitRetry(
  page,
  _browser,
  scenario,
  persona,
  _guard,
  _reportDir,
  logBug,
) {
  const subject = 'aiEmitRetry';
  const scenId = scenario.scenario_id;

  if (!FIXTURE_MODE) {
    return { ok: true, _botSubject: subject, _skipped: 'non-fixture-mode' };
  }

  // Single-shot per persona. The fetch interceptor is invasive (it
  // replaces globalThis.fetch for the page lifetime), and even though
  // uninstall is called at the end, a re-fire would race with the
  // post-uninstall page navigation. Mirrors scenPhiColdUnlock Gate 2.
  const RAN_KEY = 'ward-helper.aiEmitRetryRan';
  const alreadyRan = await page
    .evaluate((k) => {
      try {
        return localStorage.getItem(k) === '1';
      } catch {
        return false;
      }
    }, RAN_KEY)
    .catch(() => false);
  if (alreadyRan) {
    return { ok: true, _botSubject: subject, _skipped: 'already-ran-this-persona' };
  }

  // Mark on entry — every exit path from here counts as "this persona
  // has had its aiEmitRetry attempt." Same rationale as scenPhiColdUnlock.
  await page
    .evaluate((k) => {
      try {
        localStorage.setItem(k, '1');
      } catch {
        /* localStorage disabled — Gate 2 becomes a no-op; acceptable */
      }
    }, RAN_KEY)
    .catch(() => {});

  // ─── 1. Bootstrap: enable bot API, reload, verify attach ──────────────
  await page
    .evaluate(() => {
      try {
        localStorage.setItem('ward-helper.botApi', '1');
      } catch {
        /* localStorage disabled */
      }
    })
    .catch(() => {});
  await page
    .reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    .catch(() => {});
  await sleep(1500);

  const apiReady = await page
    .evaluate(() => {
      return (
        typeof window.__aiBotApi?.callClaude === 'function' &&
        typeof window.__aiBotApi?.installAiFetchInterceptor === 'function'
      );
    })
    .catch(() => false);
  if (!apiReady) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/aiEmitRetry/bot-api-missing`,
      `window.__aiBotApi not attached — see src/dev/__aiBotApi.ts wiring + src/main.tsx dynamic import | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // ─── 2. Drive the invariant via direct callClaude ─────────────────────
  //
  // Page-side closure: install interceptor, fire callClaude with our own
  // AbortController, wait CANCEL_AFTER_MS, abort, wait SETTLE_AFTER_CANCEL_MS,
  // capture the outcome. Everything runs in one page.evaluate so timing
  // is engine-local (no Playwright-side delay between abort and capture).
  const result = await page
    .evaluate(
      async ({
        stubMessage,
        cancelAfterMs,
        settleAfterCancelMs,
      }) => {
        const api = window.__aiBotApi;
        if (!api) {
          return { __error: 'api-disappeared' };
        }
        api.installAiFetchInterceptor(stubMessage);
        api.resetFetchCount();

        const ctrl = new AbortController();
        let lastError = null;
        let errorAtMs = 0;
        let cancelAtMs = 0;

        const startTs = Date.now();

        // Fire callClaude. The bot's wrapped fetch will catch the AI URL
        // and return a never-resolving promise that rejects on signal
        // abort. retryOnTransient: 1 mirrors the extract-turn config in
        // src/agent/loop.ts L312 — minimum retry count needed to make
        // L249's effect observable (with maxRetries=0, L249 is a no-op
        // because L252 breaks anyway).
        const callPromise = api
          .callClaude(
            // Minimal valid AnthropicRequest. The wrapped fetch never
            // examines the body — it just rejects on abort — so any
            // shape passes the dispatch's pre-fetch checks. model is
            // overridden by callDirectOnce/callProxyOnce internally.
            { messages: [{ role: 'user', content: 'noop' }], max_tokens: 1 },
            { retryOnTransient: 1, signal: ctrl.signal },
          )
          .catch((e) => {
            errorAtMs = Date.now();
            lastError = {
              name: (e && e.name) || 'UnknownError',
              message: (e && e.message) || String(e),
            };
          });

        // Wait for fetch to actually fire before aborting. Without this,
        // a slow JS startup could let abort win the race and the wrapped
        // fetch never gets to count. 50ms poll * 20 = up to 1s before
        // giving up and aborting anyway.
        for (let i = 0; i < 20; i++) {
          if (api.getFetchCount() >= 1) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        // Now wait the rest of cancelAfterMs (whatever wasn't consumed
        // by the poll above), then abort. Codex P2 (PR #212): basing
        // this delta on errorAtMs (init=0=epoch) collapsed `remaining`
        // to 0 on every normal run, making the abort fire immediately
        // after the poll. Benign here because the poll already
        // guarantees fetch-in-flight, but the intent — honor
        // cancelAfterMs since call start — needs startTs.
        const elapsedSinceStart = Date.now() - startTs;
        const remaining = Math.max(0, cancelAfterMs - elapsedSinceStart);
        await new Promise((r) => setTimeout(r, remaining));

        cancelAtMs = Date.now();
        ctrl.abort();

        // Settle.
        await new Promise((r) => setTimeout(r, settleAfterCancelMs));

        // Await the call promise itself so we know the catch fired.
        await callPromise;

        const fetchCount = api.getFetchCount();
        api.uninstallAiFetchInterceptor();

        return {
          fetchCount,
          lastError,
          cancelAtMs,
          errorAtMs,
          msAfterCancel: errorAtMs > 0 ? errorAtMs - cancelAtMs : -1,
        };
      },
      {
        stubMessage: STUB_ABORT_MESSAGE,
        cancelAfterMs: CANCEL_AFTER_MS,
        settleAfterCancelMs: SETTLE_AFTER_CANCEL_MS,
      },
    )
    .catch((e) => ({ __error: String((e && e.message) || e) }));

  if (result && result.__error) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/aiEmitRetry/page-evaluate-failed`,
      `page.evaluate threw: ${result.__error} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  const { fetchCount, lastError, msAfterCancel } = result;

  // ─── 3. Assertions ────────────────────────────────────────────────────

  // 3a. Sanity: fetch must have fired at least once. If it didn't, the
  // interceptor wasn't called — likely because callClaude returned
  // early (no apiKey path took a different branch, or an unrelated
  // error short-circuited). Without a fetch we can't test the abort
  // path. HIGH because the bot infra is broken, not the invariant.
  if (fetchCount === 0) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/aiEmitRetry/no-fetch-fired`,
      `Interceptor counted 0 AI-endpoint fetches — callClaude likely short-circuited before reaching fetch. lastError:${JSON.stringify(lastError)} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3b. Informational HIGH: fetch count > 1 means BOTH L242 and L249 are
  // broken (or L242 was refactored away). A more serious regression than
  // this scenario was designed to catch; surface unambiguously.
  if (fetchCount > 1) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/aiEmitRetry/unexpected-retry-fetch`,
      `Fetch count = ${fetchCount} after abort — at least one fetch fired AFTER user cancel. BOTH dispatch.ts:242 (pre-attempt guard) AND :249 (post-throw guard) appear broken. lastError:${JSON.stringify(lastError)} msAfterCancel:${msAfterCancel} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3c. Error must be AbortError. If it's something else, the dispatch
  // wrapped or substituted the abort — a refactor we'd want to know
  // about even if the invariant text technically still holds.
  if (!lastError || lastError.name !== 'AbortError') {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/aiEmitRetry/wrong-error-name`,
      `Expected AbortError as final thrown; got ${JSON.stringify(lastError)} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3d. PRIMARY HIGH probe — L249 removal signature. Both conditions
  // together for unambiguous detection.
  const messageRegressed = lastError.message === 'aborted';
  const timingRegressed = msAfterCancel >= 0 && msAfterCancel >= CANCEL_DELAY_HIGH_MS;

  if (messageRegressed && timingRegressed) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/aiEmitRetry/wrong-error-on-cancel`,
      `AbortError-final invariant (dispatch.ts:249) broken — fresh DOMException('aborted') reached caller after ${msAfterCancel}ms sleep instead of original AbortError. lastError:${JSON.stringify(lastError)} fetchCount:${fetchCount} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3e. SECONDARY MEDIUM — only message regressed. Could be an
  // unintended refactor that re-throws a wrapped error but preserves
  // timing. UX consequence: minor; surface as MEDIUM, don't fail.
  if (messageRegressed && !timingRegressed) {
    logBug(
      'MEDIUM',
      scenId,
      `${persona.name}/aiEmitRetry/wrong-error-identity`,
      `Final error is AbortError but message is the literal 'aborted' (L242 fingerprint) instead of the stub the wrapped fetch threw — possible identity-preservation regression. lastError:${JSON.stringify(lastError)} msAfterCancel:${msAfterCancel} | _botSubject:${subject}`,
    );
    // Continue — informational.
  }

  // 3f. SECONDARY MEDIUM — only timing regressed. UX dead-end (cancel
  // feels broken for ~2s) but error identity is preserved.
  if (!messageRegressed && timingRegressed) {
    logBug(
      'MEDIUM',
      scenId,
      `${persona.name}/aiEmitRetry/cancel-throw-delayed`,
      `Final error identity preserved but cancel→throw delay = ${msAfterCancel}ms (>= ${CANCEL_DELAY_HIGH_MS}ms threshold). UX dead-end on user cancel. lastError:${JSON.stringify(lastError)} | _botSubject:${subject}`,
    );
    // Continue — informational.
  }

  // Light jitter so the persona's downstream actions don't fire on
  // the exact same tick boundary every time.
  await sleep(rand(80, 240));

  return { ok: true, _botSubject: subject };
}
