# mega-bot v5 — SW-swap chaos injector (design)

**Date:** 2026-05-11
**Status:** approved (brainstorming gate); ready for implementation plan
**Predecessors:** v4.2 (PR #138 — runtime per-sub-bot `waitForSubject` ratchet), `feedback_bot_v5_sequencing.md` (v5 ordering: SW-swap → tabHopper → exifRotation; don't bundle).

## Goal

Add the first v5 chaos surface — **service-worker swap mid-session**. Models the production failure mode where a clinician has the ward-helper app open across a shift and a deploy pushes mid-shift, firing the SW lifecycle (install → activate → controllerchange) under their feet. Targets the version-trinity-desync class. Tests: does the page survive the activate event? Do in-flight requests get the new SW? Does IDB / localStorage state hold across the swap?

This is v5's centerpiece. tabHopper and exifRotation are subsequent design conversations per `feedback_bot_v5_sequencing.md`: don't bundle into a multi-feature monolith.

## Architecture

Three components in one PR. No new files, no new deps — all extends `scripts/lib/megaPersona.mjs`.

### Component A — `chaosSwapServiceWorker(page, tally, logBug)`

Injector function, same shape class as the other 12 chaos injectors. **Counter increment lives OUTSIDE the try; `page.evaluate` lives INSIDE; `page.unroute` lives in `finally`.** A throwing evaluate (page crash, navigation race) must still count as an attempt (or the 0.20 alarm denominator under-reports), and unroute must still run (or the mutation handler leaks across subsequent ticks — silent state corruption that surfaces as "chaos-sw-swap stops working after tick N in unrelated ways"):

```js
async function chaosSwapServiceWorker(page, tally, logBug) {
  // 1. Mutate the next sw.js fetch (chaos comment → byte diff → real swap).
  //    page.route is correct HERE because mutation IS the chaos —
  //    NOT in conflict with the encrypted-blob-smoke principle of
  //    'use waitForResponse, not route'. Different intent: observe vs mutate.
  await page.route('**/sw.js', async (route) => {
    const r = await route.fetch();
    const body = await r.text();
    await route.fulfill({
      response: r,
      body: body + `\n// chaos-${Date.now()}\n`,
      headers: { ...r.headers(), 'cache-control': 'no-cache' },
    });
  });

  // 2. Counter BEFORE the try — a throwing evaluate counts as an attempt
  //    so the 0.20-miss-rate alarm denominator doesn't under-report.
  tally.chaosSwapAttempts = (tally.chaosSwapAttempts || 0) + 1;

  let result;
  try {
    // 3. Force re-check + race against 8s timeout. No SKIP_WAITING postMessage —
    //    ward-helper's sw.js auto-skipWaitings (public/sw.js:6 v1.44.0).
    result = await page.evaluate(() => new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange',
        () => resolve('swapped'), { once: true });
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return resolve('no-registration');
        reg.update();
      });
      setTimeout(() => resolve('timeout-8s'), 8000);
    }));
    if (result !== 'swapped') {
      tally.chaosSwapTimeouts = (tally.chaosSwapTimeouts || 0) + 1;
    }
    if (result !== 'swapped' && result !== 'no-registration') {
      logBug('LOW', 'chaos-infra', 'chaos-sw-swap/result', `chaos-sw-swap: ${result}`);
    }
  } finally {
    // 4. ALWAYS unroute, even on throw. .catch swallows if the page is
    //    already closed (orchestrator hard-kill); leak is moot at that point.
    //    Without this guard, a single thrown evaluate poisons every subsequent
    //    tick that triggers an sw.js fetch — silent, non-deterministic.
    await page.unroute('**/sw.js').catch(() => {});
  }
  return { ok: result === 'swapped', _botSubject: 'chaos-sw-swap', result };
}
```

### Component B — `CHAOS_MENU` slot 13 + call-site wrap

The injector's signature `(page, tally, logBug)` doesn't match the standard `(page, browser, scenario, persona, guard, reportDir, logBug)` that the dispatcher passes (verified at `megaPersona.mjs:849` during plan-writing). The existing `chaos-random-click` entry already handles this by marking `fn` as a special string (`'__needs_scenario_logBug__'`) that the dispatcher pattern-matches at the call site. SW-swap follows the same pattern:

```js
// In CHAOS_MENU array (megaPersona.mjs:712-730), append:
{ weight: 1, name: 'chaos-sw-swap', fn: '__needs_swap_telemetry__', _meta: 'sw-swap' },
```

And in `runPersona`'s dispatch (around line 846-849), extend the existing branch:

```js
if (picked.fn === '__needs_scenario_logBug__') {
  result = await chaosRandomClick(page, persona, scenario.scenario_id, logBug);
} else if (picked.fn === '__needs_swap_telemetry__') {
  result = await chaosSwapServiceWorker(page, tally, logBug);
} else {
  result = await picked.fn(page, browser, scenario, persona, guard, reportDir, logBug);
}
```

Weight 1 matches the slowest existing chaos types (`chaos-midnight` w:2 holds 4s, `chaos-idb-quota` w:2). SW-swap can hold up to 8s + is invasive (the swapped SW persists across subsequent ticks until the next swap or page reload). Weight 1 means it fires roughly once per ~50 ticks per persona — enough coverage without dominating the run.

### Component C — End-of-run `chaos-infra` alarm

At persona-run teardown (after the action loop exits, before `await ctx.close()`), one place. Counter source is the per-persona `tally` object the dispatcher already mutates (verified at `megaPersona.mjs:862-872`); `logBug` signature is `(severity, scenarioId, locator, message)` per existing call at line 881:

```js
const swapTotal = tally.chaosSwapAttempts || 0;
const swapMiss = tally.chaosSwapTimeouts || 0;
if (swapTotal >= 10 && swapMiss / swapTotal > 0.20) {
  const firedPct = Math.round((1 - swapMiss / swapTotal) * 100);
  logBug('LOW', 'chaos-infra', `${persona.name}/chaos-sw-swap/coverage`,
    `SW-swap fired ${swapTotal - swapMiss}/${swapTotal} (${firedPct}%) — coverage gap, not app bug`);
}
```

**`scenarioId: 'chaos-infra'` is load-bearing.** It separates "chaos bot is broken" from "ward-helper is broken" in triage. Different on-call, different fix. Existing `logBug` callers use scenarioIds like the real scenario_id (per line 881 `scenario.scenario_id`); `chaos-infra` is a new scenarioId reserved for harness self-telemetry.

**Once-per-persona, not once-per-page:** `runPersona` creates a single `page` and never reassigns it (memo at `megaPersona.mjs:840`), so the teardown alarm fires exactly once per persona run. No need to gate with a `tally.chaosSwapAlarmed` boolean. If three personas run in parallel and all hit >20% miss, three alarms fire — correct signal (each persona's telemetry is independent).

**Threshold rationale:**
- N≥10 floor: don't false-alarm on a 3-tick smoke run.
- 20% miss rate: 1 in 5 swaps not firing means effective coverage drops 20%. Magic number; replace with rolling-baseline after 1-2 weeks of JSONL data.

## Why not counter-only (rejected option)

Counter-only telemetry has a silent-coverage-hole class: if `timeout-8s` fires 50% of the time, effective SW-swap coverage drops 50% — visible only as `chaosSwapTimeouts: 247` buried in JSONL. The chaos doesn't fire → the app isn't being stressed → CI passes green → silent test-coverage hole. Same epistemic shape as "code coverage of an `if` branch that's actually unreachable." The end-of-run threshold alarm closes that hole.

## Reasoning provenance

Brainstorming gate 1 (scope): chose "force SW update mid-session." Rejected unregister+reload (boring cold-start) and caches.delete tampering (subset of existing chaosClearStorage). Verified via `public/sw.js` read that auto-skipWaiting pattern is in place — no SKIP_WAITING handler needed, no production bug to chase.

Brainstorming gate 2 (timeout handling): chose threshold-alarm. Rejected counter-only (silent-coverage-hole class) and logBug-per-timeout (chaos non-determinism produces noise). Threshold 20% on N≥10 is a magic number; replace with rolling baseline after data accumulates.

## Deliberately NOT in scope (§F equivalent)

- **tabHopper + exifRotation** — separate v5 surfaces per `feedback_bot_v5_sequencing.md`. Each gets its own brainstorm → spec → plan → PR cycle.
- **Refactoring chaos dispatch signature** — if the SW-swap injector needs `ctx`/`log` and existing menu entries don't, the implementation plan handles it via closure wrap in the menu entry, NOT by changing every existing entry's signature. YAGNI.
- **Asserting on specific page behavior post-swap** — e.g., "in-flight upload retries against new SW." The chaos surface fires the lifecycle event; existing scenarios (admission, soap, etc.) running concurrently surface app-side bugs. No new assertions added; the existing logBug stream catches them.
- **Tuning the threshold dynamically** — 0.20 is a magic number for v5. Replace via rolling-baseline analysis after 1-2 weeks of run data; that work is its own ticket.
- **Sibling-app SW-swap chaos** — Geri / IM / FM / Toranot have their own SW patterns. Whether to port SW-swap chaos to those is a separate question; not implied by this work.
