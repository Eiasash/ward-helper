# mega-bot v5 — SW-swap chaos injector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the SW-swap chaos injector (CHAOS_MENU slot 13) to `scripts/lib/megaPersona.mjs` per `docs/superpowers/specs/2026-05-11-mega-bot-v5-sw-swap-chaos-design.md`. First v5 surface; tabHopper and exifRotation are subsequent designs (don't bundle).

**Architecture:** Three coupled additions to one file (`scripts/lib/megaPersona.mjs`): (1) `chaosSwapServiceWorker(page, tally, logBug)` injector that mutates the next sw.js fetch via `page.route` to force a byte-diff swap; (2) CHAOS_MENU slot 13 marker + call-site wrap in `runPersona` matching the existing `chaos-random-click` pattern; (3) end-of-run threshold alarm reading from `tally.chaosSwap*` counters. No new files, no new deps.

**Tech Stack:** Node ESM, `playwright` (raw, already a transitive dep of `@playwright/test`), existing megaPersona.mjs conventions.

---

## File Structure

**Single file modified:** `scripts/lib/megaPersona.mjs` (~37 KB, ~900 lines).

Four edit sites, in file-order:
1. **~line 400** — insert `chaosSwapServiceWorker` function near the other `chaosX` injectors (`chaosClearStorage`, `chaosVisibilityCycle`, etc.).
2. **~line 729** — append CHAOS_MENU entry: `{ weight: 1, name: 'chaos-sw-swap', fn: '__needs_swap_telemetry__' }` (special marker like `chaos-random-click`).
3. **~line 846** — extend the call-site wrap in `runPersona`'s action dispatch to handle the new marker.
4. **~line 894 (post-loop, pre-return)** — add the end-of-run `chaos-infra` alarm reading `tally.chaosSwapAttempts` / `tally.chaosSwapTimeouts`.

## Why one task, not five

The change is ~30 lines total across 4 edit sites in one file. Decomposing into 5 commits would produce intermediate states that don't make sense in isolation (e.g., "added function but no menu entry yet" = unreachable code; "added menu entry but no wrap" = `picked.fn === '__needs_swap_telemetry__'` returns the literal string, which crashes the dispatcher). The 4 sub-changes are tightly coupled; one commit is the right granularity.

No new vitest tests added — there are no existing vitest tests for the chaos injectors (verified: `grep -l 'chaosClearStorage\|chaosVisibilityCycle' tests/` returns nothing). Chaos injectors are exercised at runtime by the bot itself, with the bot's aggregated bug report as the signal. The end-of-run threshold alarm (component C) is the closest thing to a chaos-on-chaos test — it asserts the SW-swap is firing more than 80% of the time.

---

### Task 1: chaosSwapServiceWorker — injector + menu + dispatch wrap + teardown alarm

**Files:**
- Modify: `scripts/lib/megaPersona.mjs` (4 edit sites; see File Structure above)

- [ ] **Step 1: Insert the `chaosSwapServiceWorker` function**

Find the existing `chaosRapidFireUploads` function (around line 402). Insert the new function immediately AFTER it, BEFORE the `scenAdmissionEmit` definition (which starts the scenarios section). Approximate target line: 420-422.

```js
export async function chaosSwapServiceWorker(page, tally, logBug) {
  // Mutate the next sw.js fetch with a chaos comment so the byte-diff
  // triggers a real SW lifecycle (install → activate → controllerchange).
  // page.route is correct HERE because mutation IS the chaos — not in
  // conflict with the encrypted-blob-smoke rule of 'use waitForResponse,
  // not route'. Different intent: observe vs mutate.
  await page.route('**/sw.js', async (route) => {
    const r = await route.fetch();
    const body = await r.text();
    await route.fulfill({
      response: r,
      body: body + `\n// chaos-${Date.now()}\n`,
      headers: { ...r.headers(), 'cache-control': 'no-cache' },
    });
  });

  // Force re-check + race against 8s timeout. NOTE: no
  // reg.waiting.postMessage({type:'SKIP_WAITING'}) — ward-helper's
  // sw.js calls self.skipWaiting() unconditionally in install handler,
  // so postMessage is dead code. Don't re-add it without re-verifying
  // sw.js (public/sw.js:6 as of v1.44.0).
  const result = await page.evaluate(() => new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange',
      () => resolve('swapped'), { once: true });
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return resolve('no-registration');
      reg.update();
    });
    setTimeout(() => resolve('timeout-8s'), 8000);
  }));

  await page.unroute('**/sw.js');

  // Telemetry. Counts go on the per-persona `tally` object (already
  // exposed to the dispatcher); the end-of-run alarm reads them.
  tally.chaosSwapAttempts = (tally.chaosSwapAttempts || 0) + 1;
  if (result !== 'swapped') {
    tally.chaosSwapTimeouts = (tally.chaosSwapTimeouts || 0) + 1;
  }
  // Surface the result on the live bug stream too — useful for triage
  // when a single tick wants to show what happened.
  // (Severity LOW because a single timeout is informational, not a bug.)
  if (result !== 'swapped' && result !== 'no-registration') {
    logBug('LOW', 'chaos-infra', 'chaos-sw-swap/result', `chaos-sw-swap: ${result}`);
  }
  return { ok: result === 'swapped', _botSubject: 'chaos-sw-swap', result };
}
```

- [ ] **Step 2: Append CHAOS_MENU slot 13**

Find the `CHAOS_MENU` array (around line 712). The last entry is currently `chaos-random-click` with `fn: '__needs_scenario_logBug__'`. Append a new entry after it:

```js
export const CHAOS_MENU = [
  // ... existing 12 entries ...
  { weight: 5, name: 'chaos-random-click',   fn: '__needs_scenario_logBug__', _meta: 'random-click' },
  // v5 — SW-swap. Weight 1 because it's slow (up to 8s) and invasive
  // (the swapped SW persists across subsequent ticks). Mirrors
  // chaos-midnight w:2 / chaos-network-ramped w:3 — low weight for
  // slow chaos. Wrapped at call site like chaos-random-click because
  // it needs `tally` + `logBug`, not the standard (p, browser, scenario,
  // persona, guard, reportDir, logBug) signature.
  { weight: 1, name: 'chaos-sw-swap',        fn: '__needs_swap_telemetry__', _meta: 'sw-swap' },
];
```

- [ ] **Step 3: Extend the call-site wrap in `runPersona`**

Find the dispatcher around line 846. Current shape:

```js
let result;
if (picked.fn === '__needs_scenario_logBug__') {
  result = await chaosRandomClick(page, persona, scenario.scenario_id, logBug);
} else {
  result = await picked.fn(page, browser, scenario, persona, guard, reportDir, logBug);
}
```

Extend with a second special-case branch:

```js
let result;
if (picked.fn === '__needs_scenario_logBug__') {
  result = await chaosRandomClick(page, persona, scenario.scenario_id, logBug);
} else if (picked.fn === '__needs_swap_telemetry__') {
  result = await chaosSwapServiceWorker(page, tally, logBug);
} else {
  result = await picked.fn(page, browser, scenario, persona, guard, reportDir, logBug);
}
```

- [ ] **Step 4: Add the end-of-run `chaos-infra` alarm**

Find `runPersona`'s teardown (around line 894 — just after `const wallMs = Date.now() - t0;`). Add the threshold alarm BEFORE `await ctx.close()`:

```js
const wallMs = Date.now() - t0;

// v5 — chaos-infra alarm. If SW-swap fired ≥10 times and missed more
// than 20%, that's a coverage gap, not an app bug. Surface as
// 'chaos-infra' so triage routes it to the bot, not ward-helper.
// Threshold rationale: N≥10 floor avoids false-alarms on smoke runs;
// 20% magic number replaces with rolling baseline after 1-2 weeks of
// JSONL data (separate ticket).
const swapTotal = tally.chaosSwapAttempts || 0;
const swapMiss = tally.chaosSwapTimeouts || 0;
if (swapTotal >= 10 && swapMiss / swapTotal > 0.20) {
  const firedPct = Math.round((1 - swapMiss / swapTotal) * 100);
  logBug('LOW', 'chaos-infra', `${persona.name}/chaos-sw-swap/coverage`,
    `SW-swap fired ${swapTotal - swapMiss}/${swapTotal} (${firedPct}%) — coverage gap, not app bug`);
}

// V4: pull longtask count from the diag closure if exposed via window.
const memSummary = memory.summary();
```

- [ ] **Step 5: Bump BOT_VERSION**

Find the `BOT_VERSION` constant at line 57:

```js
export const BOT_VERSION = 'v4.2.0';
```

Bump to v5.0.0 (per v5 sequencing memory — SW-swap is the first v5 surface):

```js
export const BOT_VERSION = 'v5.0.0';
```

- [ ] **Step 6: Syntax-check the file**

Run: `cd ~/repos/ward-helper && node --check scripts/lib/megaPersona.mjs`
Expected: silent success.

- [ ] **Step 7: Run the existing vitest suite to confirm no regressions**

Run: `cd ~/repos/ward-helper && npm test 2>&1 | tail -5`
Expected: same test count as pre-change (1061 passed + 1 skipped). No new tests added; no existing tests should fail.

- [ ] **Step 8: Smoke-validate via fixture-mode bot run** (deferred to user)

The bot has a `WARD_BOT_FIXTURE=1` mode that skips Opus and uses hardcoded scenarios. Live validation is the user's runtime step:

```bash
WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed \
WARD_BOT_FIXTURE=1 \
WARD_BOT_PERSONAS=2 \
WARD_BOT_DURATION_MS=120000 \
CHAOS_EXECUTABLE_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \
node scripts/ward-helper-mega-bot.mjs
```

Expected outcomes:
- Bot runs 2 personas for 2 min
- At least one `chaos-sw-swap` entry in the per-tick log (weight 1 → roughly 1-3 SW-swaps per persona in 2 min)
- Per-tick log lines: `chaos-sw-swap: swapped` (or `timeout-8s` on slow runs)
- End-of-run summary may include the threshold alarm if miss rate >20%

If `chaos-sw-swap` never fires, the menu weighting is off (verify weight 1 entry is present in CHAOS_MENU). If every swap times out, `controllerchange` may be racing with `page.unroute` — increase the 8000ms ceiling to investigate.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/megaPersona.mjs
git commit -m "feat(bot v5): SW-swap chaos injector + chaos-infra alarm

First v5 chaos surface per feedback_bot_v5_sequencing.md (SW-swap →
tabHopper → exifRotation). Models the production failure mode: deploy
pushes mid-shift, SW lifecycle (install → activate → controllerchange)
fires under the clinician's feet.

3 components in megaPersona.mjs:
  1. chaosSwapServiceWorker injector — page.route mutates next sw.js
     fetch with a chaos comment (byte diff forces real swap), reg.update(),
     await controllerchange with 8s timeout
  2. CHAOS_MENU slot 13 — weight 1 (matches slowest chaos: chaos-midnight,
     chaos-network-ramped); wrapped at call site like chaos-random-click
     because needs tally+logBug not standard signature
  3. End-of-run chaos-infra alarm — fires when N≥10 attempts AND >20%
     missed, kind='chaos-infra' separates 'bot broken' from 'app broken'
     in triage

Verified against public/sw.js (auto-skipWaiting in install handler) —
no postMessage(SKIP_WAITING) needed. BOT_VERSION bump v4.2.0 → v5.0.0.

Spec: docs/superpowers/specs/2026-05-11-mega-bot-v5-sw-swap-chaos-design.md
Plan: docs/superpowers/plans/2026-05-11-mega-bot-v5-sw-swap-chaos.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checks

1. **Spec coverage:**
   - Spec §Component A (chaosSwapServiceWorker) → Task 1 Step 1 ✓
   - Spec §Component B (CHAOS_MENU slot 13) → Task 1 Step 2 + Step 3 (call-site wrap) ✓
   - Spec §Component C (end-of-run alarm) → Task 1 Step 4 ✓
   - Spec §Reasoning provenance — captured in commit message and code comments ✓
   - Spec §Deliberately not in scope (tabHopper, exifRotation, threshold tuning, sibling-app port) → enforced by NOT being in the plan ✓

2. **Placeholder scan:** No TBD / TODO / "handle edge cases" / "similar to" patterns. Every step has actual code or actual command.

3. **Type consistency:**
   - `chaosSwapServiceWorker(page, tally, logBug)` — Step 1 defines, Step 3 calls — match ✓
   - `tally.chaosSwapAttempts` / `tally.chaosSwapTimeouts` — Step 1 writes, Step 4 reads — match ✓
   - CHAOS_MENU marker `'__needs_swap_telemetry__'` — Step 2 declares, Step 3 dispatches — match ✓
   - `logBug(severity, scenarioId, locator, message)` — Step 1 + Step 4 both use this 4-arg shape, matching existing line 881 ✓

4. **Scope:** Single file modified. Single task with 9 steps (each 2-5 min). No need to decompose further.
