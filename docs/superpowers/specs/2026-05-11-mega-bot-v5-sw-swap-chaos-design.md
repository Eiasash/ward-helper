# mega-bot v5 — SW-swap chaos injector (design)

**Date:** 2026-05-11
**Status:** approved (brainstorming gate); ready for implementation plan
**Predecessors:** v4.2 (PR #138 — runtime per-sub-bot `waitForSubject` ratchet), `feedback_bot_v5_sequencing.md` (v5 ordering: SW-swap → tabHopper → exifRotation; don't bundle).

## Goal

Add the first v5 chaos surface — **service-worker swap mid-session**. Models the production failure mode where a clinician has the ward-helper app open across a shift and a deploy pushes mid-shift, firing the SW lifecycle (install → activate → controllerchange) under their feet. Targets the version-trinity-desync class. Tests: does the page survive the activate event? Do in-flight requests get the new SW? Does IDB / localStorage state hold across the swap?

This is v5's centerpiece. tabHopper and exifRotation are subsequent design conversations per `feedback_bot_v5_sequencing.md`: don't bundle into a multi-feature monolith.

## Architecture

Three components in one PR. No new files, no new deps — all extends `scripts/lib/megaPersona.mjs`.

### Component A — `chaosSwapServiceWorker(page, log, ctx)`

Injector function, same shape class as the other 12 chaos injectors:

```js
async function chaosSwapServiceWorker(page, log, ctx) {
  // 1. Mutate the next sw.js fetch (no-op comment → byte diff that triggers swap).
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

  // 2. Force re-check + race against 8s timeout.
  const result = await page.evaluate(() => new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange',
      () => resolve('swapped'), { once: true });
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return resolve('no-registration');
      reg.update();
      // NOTE: No reg.waiting.postMessage({type:'SKIP_WAITING'}) —
      // ward-helper's sw.js calls self.skipWaiting() unconditionally
      // in the install handler, so postMessage is dead code here.
      // Don't re-add it without re-verifying sw.js.
    });
    setTimeout(() => resolve('timeout-8s'), 8000);
  }));

  await page.unroute('**/sw.js');

  // 3. Telemetry — attempts always, timeouts on non-'swapped'.
  ctx.chaosSwapAttempts = (ctx.chaosSwapAttempts || 0) + 1;
  if (result !== 'swapped') ctx.chaosSwapTimeouts = (ctx.chaosSwapTimeouts || 0) + 1;
  log(`chaos-sw-swap: ${result}`);
}
```

### Component B — `CHAOS_MENU` slot 13

```js
// In CHAOS_MENU array (megaPersona.mjs:712-730), append:
{ weight: 1, name: 'chaos-sw-swap', fn: (p, _b, _s, _persona, ctx, log) => chaosSwapServiceWorker(p, log, ctx) },
```

Weight 1 matches the slowest existing chaos types (`chaos-midnight` w:2 holds 4s, `chaos-idb-quota` w:2). SW-swap can hold up to 8s + is invasive (the swapped SW persists across subsequent ticks until the next swap or page reload). Weight 1 means it fires roughly once per ~50 ticks per persona — enough coverage without dominating the run.

**Signature note:** existing CHAOS_MENU entries take `(p, _b, _s, persona)` or similar; the SW-swap injector needs `ctx` (for counter telemetry) and `log` (for per-tick output). If the runPersona dispatcher doesn't already pass these, the implementation plan adds them — or wraps via closure in the menu entry. To-be-verified at plan-writing time against `runPersona` in `megaPersona.mjs:745+`.

### Component C — End-of-run `chaos-infra` alarm

At persona-run teardown (after the action loop exits), one place:

```js
const swapTotal = ctx.chaosSwapAttempts || 0;
const swapMiss = ctx.chaosSwapTimeouts || 0;
if (swapTotal >= 10 && swapMiss / swapTotal > 0.20) {
  logBug({
    kind: 'chaos-infra',
    msg: `SW-swap fired ${swapTotal - swapMiss}/${swapTotal} (${Math.round((1 - swapMiss/swapTotal) * 100)}%) — coverage gap, not app bug`,
  });
}
```

**`kind: 'chaos-infra'` is load-bearing.** It separates "chaos bot is broken" from "ward-helper is broken" in triage. Different on-call, different fix. Existing `logBug` callers use `kind: 'scenario-fail'` / `kind: 'unhandled-error'` / etc.; `chaos-infra` is a new kind.

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
