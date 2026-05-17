# Persona rebound — mega-bot workstream #3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two-layer persona rebound mechanism from `docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md` so mega-bot personas survive sibling-chaos navigation off ward-helper, enabling SW-swap to accumulate N≥60 attempts for v5 Gate 1 closure.

**Architecture:** Two helpers exported from `scripts/lib/megaPersona.mjs` — `reboundIfOffBase` (Layer 1, top-of-tick guard) and `tryRecoverFromPageDeath` (Layer 2, catch-block one-shot recovery). Wired into `runPersona`'s action loop. Three new tally counters surface in the JSONL timeline. Analyzer (`scripts/analyze-mega-run.mjs`) adds a "Rebound sanity bounds" section that flags per-persona breaches of the three §7 thresholds. Bot version bumps v5.0.0 → v5.1.0.

**Tech Stack:** Node 22+ ESM, Playwright (already in devDependencies), vitest (1026 tests existing), TypeScript strict mode. No new dependencies.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/lib/megaPersona.mjs` | Modify | Add 2 exported helpers; add 3 tally counter inits in `runPersona`; bump `BOT_VERSION`; wire Layer 1 into action loop top; wire Layer 2 into catch block. |
| `tests/megaPersonaRebound.test.ts` | Create | 4 unit tests for the 2 helpers + 2 unit tests for the analyzer sanity-bound function. Total 6 cases. |
| `scripts/analyze-mega-run.mjs` | Modify | Add `evaluateReboundSanityBounds(personaTallies)` helper. Print "Rebound sanity bounds" section in output markdown when any persona breaches. |

**Single integration point** between scripts and tests: the helper functions are exported from `.mjs` and re-imported into a `.test.ts` test file. Per the workspace memory `feedback_mjs_dmts_pairing.md`, if TypeScript strict mode complains about importing a `.mjs` module without a `.d.mts` declaration, add a `tests/megaPersona.d.mts` shim. Task 1 step 5 includes a check for this.

---

### Task 1: Helpers + tally fields + bot version bump

**Files:**
- Create: `tests/megaPersonaRebound.test.ts`
- Modify: `scripts/lib/megaPersona.mjs` (add exports near top, add 3 tally inits in `runPersona`, bump `BOT_VERSION`)
- Modify (if TS-strict requires): `tests/megaPersona.d.mts` shim

This is the scaffolding task: tests + helpers + version bump together. No wiring into runPersona's loop yet — that's task 2 and task 3.

- [ ] **Step 1: Write all four helper unit tests as one file**

Create `tests/megaPersonaRebound.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  reboundIfOffBase,
  tryRecoverFromPageDeath,
} from '../scripts/lib/megaPersona.mjs';

const BASE_URL = 'https://eiasash.github.io/ward-helper/';
const baseOrigin = new URL(BASE_URL).origin;
const basePathname = new URL(BASE_URL).pathname;

function newTally() {
  return {
    rebound_attempts: 0,
    rebound_successes: 0,
    recoveries: 0,
  };
}

function mockPage(opts: {
  url?: string | (() => string);
  goto?: () => Promise<unknown>;
}) {
  return {
    url: typeof opts.url === 'function' ? opts.url : () => opts.url ?? BASE_URL,
    goto: opts.goto ?? (() => Promise.resolve()),
  };
}

describe('reboundIfOffBase (Layer 1)', () => {
  it('happy path: off-base → goto called, attempts+successes both incremented', async () => {
    const tally = newTally();
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = mockPage({ url: 'about:blank', goto });
    await reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally);
    expect(goto).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    expect(tally.rebound_attempts).toBe(1);
    expect(tally.rebound_successes).toBe(1);
  });

  it('on-base: no goto, no counter changes', async () => {
    const tally = newTally();
    const goto = vi.fn();
    const page = mockPage({ url: BASE_URL + '#/today', goto });
    await reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally);
    expect(goto).not.toHaveBeenCalled();
    expect(tally.rebound_attempts).toBe(0);
    expect(tally.rebound_successes).toBe(0);
  });

  it('dead context: page.url throws → swallowed silently, no counter changes', async () => {
    const tally = newTally();
    const page = {
      url: () => { throw new Error('Target page, context or browser has been closed'); },
      goto: vi.fn(),
    };
    await expect(reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally)).resolves.toBeUndefined();
    expect(page.goto).not.toHaveBeenCalled();
    expect(tally.rebound_attempts).toBe(0);
    expect(tally.rebound_successes).toBe(0);
  });

  it('goto fails after off-base detected: attempts=1, successes=0', async () => {
    const tally = newTally();
    const goto = vi.fn().mockRejectedValue(new Error('Target page has been closed'));
    const page = mockPage({ url: 'about:blank', goto });
    await reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally);
    expect(goto).toHaveBeenCalled();
    expect(tally.rebound_attempts).toBe(1);
    expect(tally.rebound_successes).toBe(0);
  });
});

describe('tryRecoverFromPageDeath (Layer 2)', () => {
  it('goto resolves: returns "recovered", recoveries=1, emits LOW page-closed-recovered', async () => {
    const tally = newTally();
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = mockPage({ goto });
    const logBug = vi.fn();
    const persona = { name: 'Dr. Test' };
    const picked = { name: 'admission' };
    const result = await tryRecoverFromPageDeath(page as any, BASE_URL, persona, picked, logBug, tally);
    expect(result).toBe('recovered');
    expect(tally.recoveries).toBe(1);
    expect(logBug).toHaveBeenCalledWith(
      'LOW',
      'chaos-infra',
      'Dr. Test/page-closed-recovered',
      expect.stringContaining('admission'),
    );
  });

  it('goto rejects: returns "unrecoverable", recoveries=0, emits HIGH page-closed-unrecoverable', async () => {
    const tally = newTally();
    const goto = vi.fn().mockRejectedValue(new Error('Target closed'));
    const page = mockPage({ goto });
    const logBug = vi.fn();
    const persona = { name: 'Dr. Test' };
    const picked = { name: 'consult' };
    const result = await tryRecoverFromPageDeath(page as any, BASE_URL, persona, picked, logBug, tally);
    expect(result).toBe('unrecoverable');
    expect(tally.recoveries).toBe(0);
    expect(logBug).toHaveBeenCalledWith(
      'HIGH',
      'chaos-infra',
      'Dr. Test/page-closed-unrecoverable',
      expect.stringContaining('consult'),
    );
  });
});
```

- [ ] **Step 2: Run tests, expect failure (helpers not exported yet)**

Run: `cd ~/repos/ward-helper && npm test -- tests/megaPersonaRebound.test.ts`

Expected: 6 failures with `Cannot find module` or `reboundIfOffBase is not a function`.

If you instead see `Cannot find module '../scripts/lib/megaPersona.mjs'` due to TypeScript-strict not resolving `.mjs` from `.ts` — that's the `feedback_mjs_dmts_pairing.md` failure mode. Add a shim file `tests/megaPersona.d.mts`:

```ts
declare module '../scripts/lib/megaPersona.mjs' {
  export function reboundIfOffBase(
    page: { url(): string; goto(url: string, opts?: object): Promise<unknown> },
    baseOrigin: string,
    basePathname: string,
    baseUrl: string,
    tally: { rebound_attempts: number; rebound_successes: number; recoveries: number },
  ): Promise<void>;
  export function tryRecoverFromPageDeath(
    page: { goto(url: string, opts?: object): Promise<unknown> },
    baseUrl: string,
    persona: { name: string },
    picked: { name: string },
    logBug: (sev: string, cat: string, name: string, msg: string) => void,
    tally: { recoveries: number },
  ): Promise<'recovered' | 'unrecoverable'>;
}
```

Then re-run the test command. Expected after shim: same `is not a function` failures (helpers still don't exist), but TS-strict no longer blocks on module resolution.

- [ ] **Step 3: Add the two helpers to `scripts/lib/megaPersona.mjs`**

In `scripts/lib/megaPersona.mjs`, immediately AFTER the `BOT_VERSION` constant declaration around line 65, add:

```js
// ============================================================================
// Persona rebound — workstream #3 (2026-05-12)
//
// Two-layer recovery for the sibling-chaos page-death class. See
// docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md.
//
// Layer 1 (reboundIfOffBase): top-of-tick URL guard. Fires before action
// picker every iteration. Catches the dominant case where chaos navigated
// off-base and a later non-chaos action would fall off the cliff.
//
// Layer 2 (tryRecoverFromPageDeath): catch-block one-shot rebound, fires
// from isPageDeadError branch. Returns 'recovered' or 'unrecoverable' so
// the loop knows to continue or break.
// ============================================================================

/**
 * Layer 1 — top-of-tick guard. Compares page.url() against BASE_URL by
 * origin + pathname; if off-base, calls page.goto(baseUrl). Increments
 * tally.rebound_attempts BEFORE goto so a failure path is still recorded;
 * increments tally.rebound_successes AFTER goto resolves.
 *
 * Wraps everything in try/catch so a dead context (page.url() throws)
 * falls through silently — the next action's existing catch handles it
 * via Layer 2.
 *
 * @param page - Playwright Page (or shape-compatible mock for tests)
 * @param baseOrigin - origin of BASE_URL (from new URL(BASE_URL).origin)
 * @param basePathname - pathname of BASE_URL (from new URL(BASE_URL).pathname)
 * @param baseUrl - the full BASE_URL string
 * @param tally - the persona's tally object (mutated in place)
 */
export async function reboundIfOffBase(page, baseOrigin, basePathname, baseUrl, tally) {
  try {
    const cur = new URL(page.url());
    const offBase = cur.origin !== baseOrigin || !cur.pathname.startsWith(basePathname);
    if (offBase) {
      tally.rebound_attempts = (tally.rebound_attempts || 0) + 1;
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      tally.rebound_successes = (tally.rebound_successes || 0) + 1;
    }
  } catch (_) {
    // page.url() or page.goto threw. Fall through silently; the next
    // action's catch (Layer 2) handles a dead context. The attempt is
    // already recorded if we got past url() — successes is intentionally
    // not incremented on this path.
  }
}

/**
 * Layer 2 — catch-block one-shot rebound. Called from the action-loop
 * catch when isPageDeadError(err) is true. Tries page.goto(baseUrl) once.
 * Returns 'recovered' if goto resolves (caller does `continue`) or
 * 'unrecoverable' if goto throws (caller does `break`).
 *
 * Emits exactly one bug per call: LOW page-closed-recovered on success
 * or HIGH page-closed-unrecoverable on failure. The HIGH is the new
 * shape that replaces the old chaos-infra/page-closed HIGH (which now
 * only fires when Layer 2's goto itself throws).
 *
 * @returns {Promise<'recovered'|'unrecoverable'>}
 */
export async function tryRecoverFromPageDeath(page, baseUrl, persona, picked, logBug, tally) {
  const recovered = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (recovered) {
    tally.recoveries = (tally.recoveries || 0) + 1;
    logBug('LOW', 'chaos-infra', `${persona.name}/page-closed-recovered`,
      `recovered from page-death during ${picked.name}`);
    return 'recovered';
  }
  logBug('HIGH', 'chaos-infra', `${persona.name}/page-closed-unrecoverable`,
    `persona bailed: rebound failed after page-death during ${picked.name}`);
  return 'unrecoverable';
}
```

- [ ] **Step 4: Initialize the three new tally fields in `runPersona`**

In the same file, find the `tally` initialization at the top of `runPersona` (around line 985-1000). It currently has fields like `actions`, `chaos`, `byAction`, `byBotSubject`, `errors`, `usefulActions`, `pageClosedAt`, `chaosSwapAttempts`, `chaosSwapTimeouts`, `chaosSwapInfraMisses`, `bidiAuditFindings`. Add three new fields:

```js
  rebound_attempts: 0,
  rebound_successes: 0,
  recoveries: 0,
```

Place them alphabetically-adjacent to `recoveries` already present? Re-read the file to confirm `recoveries` isn't already a tally field (it's NOT — the recovery layer mentioned in the file header refers to `guard.recoveryCount` from the diagnostics module, line 1173, which is separate). Add the three new fields cleanly together.

- [ ] **Step 5: Bump `BOT_VERSION` from v5.0.0 → v5.1.0**

Find the constant near line 65:
```js
export const BOT_VERSION = 'v5.0.0';
```

Replace with:
```js
export const BOT_VERSION = 'v5.1.0';
```

Update the comment block above the constant to mention the rebound mechanism — match the existing convention (each version bump has a sentence explaining the bug-stream-shape change):

```js
// V5.1 adds the persona rebound mechanism (Layer 1 + Layer 2) and three
// new per-persona tally fields: rebound_attempts, rebound_successes,
// recoveries. Analyzer queries against pre-v5.1 timelines won't see these
// fields; treat missing as 0. NOT tied to the app version trinity.
```

- [ ] **Step 6: Run the helper tests, expect pass**

Run: `cd ~/repos/ward-helper && npm test -- tests/megaPersonaRebound.test.ts`

Expected: 6 passed.

If a test fails, re-read the helper code against the test setup. The most likely failure: argument order mismatch (the spec says `reboundIfOffBase(page, baseOrigin, basePathname, baseUrl, tally)` — verify the helper signature matches the test call). Fix the helper, not the test (the test reflects the spec contract).

- [ ] **Step 7: Run the full test suite to confirm no regression**

Run: `cd ~/repos/ward-helper && npm run check && npm test`

Expected: `npm run check` (tsc --noEmit) green; vitest reports `1032 passed | 1 skipped` (1026 prior + 6 new).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/megaPersona.mjs tests/megaPersonaRebound.test.ts
# If the .d.mts shim was needed:
git add tests/megaPersona.d.mts
git commit -m "$(cat <<'EOF'
feat(bot v5.1): persona rebound helpers + tally fields (task 1 of 4)

Adds reboundIfOffBase (Layer 1) and tryRecoverFromPageDeath (Layer 2)
helpers to scripts/lib/megaPersona.mjs, three new per-persona tally
fields (rebound_attempts before goto, rebound_successes after goto
resolves, recoveries for Layer 2). Bumps BOT_VERSION to v5.1.0 since
the JSONL telemetry shape changes.

6 unit tests cover both helpers' happy path + dead-context fallthrough
+ unrecoverable goto. The helpers are extracted as pure async functions
so they can be unit-tested without spinning up Playwright; runPersona
will call them inline in task 2 (Layer 1 wiring) and task 3 (Layer 2
wiring).

Spec: docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md
Task 1 of 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire Layer 1 (top-of-tick guard) into `runPersona`

**Files:**
- Modify: `scripts/lib/megaPersona.mjs` (insert Layer 1 call inside the action-loop `while` block)

The helper exists; this task wires it into the action loop. Per spec §3, Layer 1 fires at the TOP of each `while` iteration, BEFORE the action picker.

- [ ] **Step 1: Locate the action loop and identify the insertion point**

Open `scripts/lib/megaPersona.mjs` and find `runPersona`. The action loop is a `while` block. Its body picks an action then runs it inside a `try { ... } catch (err) { ... }` block. The catch block was modified in PR #150 to short-circuit on `isPageDeadError` (currently around line 1084-1101).

Find the line that opens the while loop. The action picker block starts shortly after. Layer 1 must run BEFORE the action picker but inside the loop body — so insert immediately after the `while (...) {` opening brace, before any existing code in the loop body.

- [ ] **Step 2: Declare `baseOrigin` and `basePathname` near the top of `runPersona`**

Near the existing `await page.goto(url, ...)` line (currently around line 997 — the initial navigation), add immediately after:

```js
  const baseOrigin = new URL(url).origin;
  const basePathname = new URL(url).pathname;
```

The `url` parameter is already in scope (passed by `runPersona`'s caller in `ward-helper-mega-bot.mjs`). These constants are used by Layer 1 every tick — computing them once at the top is cheap and avoids re-parsing per-iteration.

- [ ] **Step 3: Insert the Layer 1 call at the top of the while-loop body**

Find the line that opens the while loop in `runPersona`'s action loop. Insert immediately after, BEFORE any other loop-body code:

```js
    // Layer 1 — top-of-tick guard. Per workstream #3 spec, see
    // docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md §3.
    // Cheap pre-check; if off-base, rebounds to baseUrl before the action picker.
    await reboundIfOffBase(page, baseOrigin, basePathname, url, tally);
```

`reboundIfOffBase` is already declared above (defined in task 1), so no import needed — same file.

- [ ] **Step 4: Run full test suite, expect pass**

Run: `cd ~/repos/ward-helper && npm run check && npm test`

Expected: `npm run check` green; vitest `1032 passed | 1 skipped`. The task-1 unit tests still pass (helpers unchanged). No new tests added in this task.

- [ ] **Step 5: Fixture-mode smoke (2 min run, no API cost)**

Sanity-check that the bot launches and Layer 1 fires by running a short fixture-mode run:

```bash
cd ~/repos/ward-helper
export WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed
export WARD_BOT_FIXTURE=1
export WARD_BOT_DURATION_MS=120000
export WARD_BOT_PERSONAS=2
export CHAOS_EXECUTABLE_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
node scripts/ward-helper-mega-bot.mjs
```

Expected: bot runs for 2 min, exits cleanly. The report markdown in `chaos-reports/ward-bot-mega/wm-*.md` should include a per-persona tally with the three new fields (`rebound_attempts`, `rebound_successes`, `recoveries`). Values may be 0 if chaos-back-mash didn't fire in the short window — that's fine, the schema being present is what's being checked.

If the bot fails to launch with `reboundIfOffBase is not defined`, re-check task 1 step 3 (was the helper exported from the same module that `runPersona` is in?).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/megaPersona.mjs
git commit -m "$(cat <<'EOF'
feat(bot v5.1): wire Layer 1 top-of-tick rebound (task 2 of 4)

reboundIfOffBase fires at the top of every action-loop iteration in
runPersona, before the action picker. This catches the dominant
sibling-chaos failure mode — chaos navigates the persona off-base
during tick N; without intervention, a non-chaos scenario at tick
N+K (where K ranges 1-1000 per Stage 3 evidence) falls off the cliff
and the page-closed cascade fires. With Layer 1, the next-tick check
rebounds before the cliff.

baseOrigin + basePathname computed once at top of runPersona (the
url param is already in scope, passed by ward-helper-mega-bot.mjs).
Per-iteration overhead is one page.url() call plus a URL parse +
two string compares — negligible relative to the action work.

Fixture-mode 2-min smoke verified the new tally fields appear in
the JSONL timeline.

Spec: docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md
Task 2 of 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire Layer 2 (catch-block one-shot rebound) + retire old `page-closed` HIGH

**Files:**
- Modify: `scripts/lib/megaPersona.mjs` (lines ~1084-1101 — the catch block in runPersona's action loop)

The helper exists; this task replaces the existing PR #150 bail logic with a `tryRecoverFromPageDeath` call that either continues the loop or breaks with the new unrecoverable bug name.

- [ ] **Step 1: Locate the current isPageDeadError branch**

Open `scripts/lib/megaPersona.mjs` and find the action-loop's catch block. As of the current main (commit 2bfe466), the relevant code starts around line 1084 and looks like:

```js
    } catch (err) {
      tally.errors++;
      // 2026-05-12 — Stage 3 cascade post-mortem. On first page/context/frame-
      // death, bail the persona loop instead of retrying on a dead target.
      // Prior behavior: log LOW + softRecover() (which itself throws on dead
      // page, swallowed by .catch) → next tick → another TargetClosedError →
      // hundreds of retry-LOWs until the 300s idle watchdog finally fires.
      if (isPageDeadError(err)) {
        tally.pageClosedAt = actionsThisCycle;
        logBug('HIGH', 'chaos-infra', `${persona.name}/page-closed`,
          `persona bailed: page closed at tick ${actionsThisCycle} during ${picked.name} (${(err.message || String(err)).slice(0, 80)})`);
        break;
      }
      logBug('LOW', scenario.scenario_id, `${persona.name}/${picked.name}/exception`,
        `harness exception: ${err.message?.slice(0, 100)}`);
      // Soft-recover after exception so next iteration starts clean.
      await guard.softRecover().catch(() => {});
    }
```

The `if (isPageDeadError(err)) { ... break; }` block is what task 3 replaces. The non-page-dead path (the `logBug('LOW', ...)` + `softRecover` lines) stays unchanged.

- [ ] **Step 2: Replace the isPageDeadError branch with `tryRecoverFromPageDeath`**

Replace the entire `if (isPageDeadError(err)) { ... break; }` block (everything from `if (isPageDeadError(err)) {` to the `}` matching the `break;`) with:

```js
      if (isPageDeadError(err)) {
        tally.pageClosedAt = actionsThisCycle;
        // Layer 2 — catch-block one-shot rebound. Per workstream #3 spec.
        const result = await tryRecoverFromPageDeath(page, url, persona, picked, logBug, tally);
        if (result === 'recovered') {
          continue;
        }
        // result === 'unrecoverable' — already logged a HIGH page-closed-unrecoverable.
        break;
      }
```

Note three things:
1. The old `logBug('HIGH', 'chaos-infra', .../page-closed', ...)` call is gone. `tryRecoverFromPageDeath` now owns bug emission for this branch (it emits `page-closed-recovered` LOW on success or `page-closed-unrecoverable` HIGH on failure).
2. `tally.pageClosedAt` assignment stays — it records the tick at which death was first observed (useful telemetry independent of recovery outcome).
3. `continue` resumes the action loop; `break` exits and triggers the post-loop tally summary.

- [ ] **Step 3: Run the full test suite, expect pass**

Run: `cd ~/repos/ward-helper && npm run check && npm test`

Expected: `npm run check` green; vitest `1032 passed | 1 skipped`. The task-1 unit tests for `tryRecoverFromPageDeath` already exercise both success and failure paths.

- [ ] **Step 4: Fixture-mode smoke targeting catch-block path**

The fixture mode won't naturally trigger Layer 2 in 2 minutes. For deterministic test coverage, the unit tests in `tests/megaPersonaRebound.test.ts` (task 1) already mock the catch-block scenarios. Skip live-fire here.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/megaPersona.mjs
git commit -m "$(cat <<'EOF'
feat(bot v5.1): wire Layer 2 catch-block rebound + retire old page-closed HIGH (task 3 of 4)

The runPersona action-loop catch block's isPageDeadError branch now
calls tryRecoverFromPageDeath instead of immediately bailing. On
recovery, the loop continues with a LOW page-closed-recovered
informational bug. On unrecoverable goto, the loop breaks with the
new HIGH page-closed-unrecoverable bug — distinct from the old HIGH
page-closed name, so analyzer queries can tell the new failure
class apart from the old.

The old PR #150 bail semantics are preserved: when rebound itself
fails, the persona still exits cleanly with a single HIGH (no
retry-loop noise). What changed is that recovery is now attempted
once before bail.

Spec: docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md
Task 3 of 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Analyzer sanity-bound section in `analyze-mega-run.mjs`

**Files:**
- Modify: `scripts/analyze-mega-run.mjs` (add `evaluateReboundSanityBounds` function + emit section in output markdown)
- Modify: `tests/megaPersonaRebound.test.ts` (add 2 unit tests for the bounds function)

Per spec §7, the analyzer flags per-persona breaches of three thresholds. This task adds the function + 2 unit tests + wires it into the analyzer's report generation.

- [ ] **Step 1: Write the two analyzer unit tests at the end of `tests/megaPersonaRebound.test.ts`**

Append to `tests/megaPersonaRebound.test.ts`:

```ts
import { evaluateReboundSanityBounds } from '../scripts/analyze-mega-run.mjs';

describe('evaluateReboundSanityBounds', () => {
  it('healthy persona: no breaches', () => {
    const tally = {
      actions: 1000,
      rebound_attempts: 30,
      rebound_successes: 28,
      recoveries: 1,
    };
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches).toEqual([]);
  });

  it('high rebound rate: emits one breach', () => {
    const tally = {
      actions: 100,
      rebound_attempts: 60,
      rebound_successes: 55,
      recoveries: 2,
    };
    // (60 + 2) / 100 = 0.62 > 0.5 threshold
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]).toMatchObject({
      kind: 'rebound-rate-high',
      severity: 'MEDIUM',
    });
  });

  it('degraded success ratio with N≥10: emits one breach', () => {
    const tally = {
      actions: 500,
      rebound_attempts: 20,
      rebound_successes: 5,    // 5/20 = 25% success
      recoveries: 1,
    };
    // attempts >=10 and ratio < 0.5
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches.some((b: any) => b.kind === 'rebound-success-degraded')).toBe(true);
  });

  it('layer 2 fired too much: emits one breach', () => {
    const tally = {
      actions: 1000,
      rebound_attempts: 20,
      rebound_successes: 20,
      recoveries: 7,
    };
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches.some((b: any) => b.kind === 'recoveries-high')).toBe(true);
  });

  it('multiple breaches: all reported', () => {
    const tally = {
      actions: 100,
      rebound_attempts: 70,
      rebound_successes: 10,   // 10/70 = 14% — degraded
      recoveries: 6,           // > 5
      // (70 + 6) / 100 = 0.76 > 0.5
    };
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches.length).toBeGreaterThanOrEqual(3);
  });
});
```

If TS-strict complains about importing from `.mjs`, extend the existing `tests/megaPersona.d.mts` shim (or create `tests/analyzeMegaRun.d.mts`):

```ts
declare module '../scripts/analyze-mega-run.mjs' {
  export function evaluateReboundSanityBounds(
    personaName: string,
    tally: {
      actions?: number;
      rebound_attempts?: number;
      rebound_successes?: number;
      recoveries?: number;
    },
  ): {
    persona: string;
    breaches: Array<{
      kind: 'rebound-rate-high' | 'rebound-success-degraded' | 'recoveries-high';
      severity: 'MEDIUM';
      detail: string;
    }>;
  };
}
```

- [ ] **Step 2: Run the analyzer tests, expect failure (function doesn't exist)**

Run: `cd ~/repos/ward-helper && npm test -- tests/megaPersonaRebound.test.ts`

Expected: 5 new failures with `evaluateReboundSanityBounds is not a function`. The original 6 tests from task 1 should still pass.

- [ ] **Step 3: Add `evaluateReboundSanityBounds` to `scripts/analyze-mega-run.mjs`**

In `scripts/analyze-mega-run.mjs`, after the imports (around line 30, before the `parseArgs` function), add:

```js
// ============================================================================
// Rebound sanity bounds — workstream #3 (2026-05-12)
//
// Three thresholds asserted against per-persona tally counters from
// scripts/lib/megaPersona.mjs's runPersona output. See spec §7:
// docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md.
//
// Each bound emits a MEDIUM breach in the analyzer report — these are NOT
// runtime bot bugs (the bot already exited by analyze-time); they're
// post-run diagnostic signals worth eyeballing during triage.
// ============================================================================

/**
 * @param {string} personaName
 * @param {{actions?:number, rebound_attempts?:number, rebound_successes?:number, recoveries?:number}} tally
 */
export function evaluateReboundSanityBounds(personaName, tally) {
  const breaches = [];
  const actions = tally.actions || 0;
  const attempts = tally.rebound_attempts || 0;
  const successes = tally.rebound_successes || 0;
  const recoveries = tally.recoveries || 0;

  // Bound 1 — rebound rate (uses attempts, not successes, so high-failure
  // path can't game the gate). Per §9 G-D.
  if (actions > 0 && (attempts + recoveries) / actions > 0.5) {
    const pct = Math.round(((attempts + recoveries) / actions) * 100);
    breaches.push({
      kind: 'rebound-rate-high',
      severity: 'MEDIUM',
      detail: `${pct}% of ticks invoked rebound (${attempts}+${recoveries} / ${actions}) — chaos weights may need rebalancing`,
    });
  }

  // Bound 2 — success ratio degraded (only meaningful with N≥10 attempts;
  // small N is too noisy). Per §7 second bound.
  if (attempts >= 10 && successes / attempts < 0.5) {
    const pct = Math.round((successes / Math.max(1, attempts)) * 100);
    breaches.push({
      kind: 'rebound-success-degraded',
      severity: 'MEDIUM',
      detail: `rebound success ratio ${pct}% (${successes}/${attempts}) — page.goto failing often; context death may be more severe than expected`,
    });
  }

  // Bound 3 — Layer 2 fired more than expected. Per §7 third bound.
  if (recoveries > 5) {
    breaches.push({
      kind: 'recoveries-high',
      severity: 'MEDIUM',
      detail: `Layer 2 fired ${recoveries} times — racing-death class more frequent than estimated; Layer 1 may need tightening`,
    });
  }

  return { persona: personaName, breaches };
}
```

- [ ] **Step 4: Wire `evaluateReboundSanityBounds` into the analyzer's output**

In `scripts/analyze-mega-run.mjs`, find the section where per-persona reports are built (around lines 280-285 — the "personaYield" table emission). Add a new section emission AFTER the persona-yield table.

Look for a pattern like:
```js
  out.push(`| ${p.persona} | ${p.actions} | ${p.personaBugs} | ${p.yieldPerAction} | ${p.usefulPerMin ?? '?'} |`);
```

This is inside a per-persona iteration. After the loop ends and the persona-yield table is closed (probably an `out.push('');` or section-break push), add:

```js
  // Rebound sanity bounds section (workstream #3). Per-persona breaches only.
  out.push('');
  out.push('## Rebound sanity bounds');
  out.push('');
  const reboundBreaches = personaData.map((p) =>
    evaluateReboundSanityBounds(p.persona, p.tally || {}),
  ).filter((r) => r.breaches.length > 0);
  if (reboundBreaches.length === 0) {
    out.push('No persona breached the three §7 thresholds. Rebound mechanism operating in the expected envelope.');
  } else {
    out.push('| Persona | Breach kind | Detail |');
    out.push('|---|---|---|');
    for (const r of reboundBreaches) {
      for (const b of r.breaches) {
        out.push(`| ${r.persona} | ${b.kind} | ${b.detail} |`);
      }
    }
    out.push('');
    out.push('See `docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md` §7 for threshold rationale.');
  }
  out.push('');
```

The `personaData` variable name may differ in the actual file — read the surrounding code and use the name that holds the per-persona array. The `.tally` field on each persona record is what's read; if the analyzer doesn't currently surface tally onto personaData, this requires a small addition to extract it from the JSONL timeline (look for where `timeline` is iterated and aggregated by persona). The spec assumes the tally is already accessible per-persona — if not, this step expands by ~10 LoC to thread it through.

- [ ] **Step 5: Run the full test suite, expect pass**

Run: `cd ~/repos/ward-helper && npm run check && npm test`

Expected: `npm run check` green; vitest `1037 passed | 1 skipped` (1032 prior + 5 analyzer tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/analyze-mega-run.mjs tests/megaPersonaRebound.test.ts
# If a .d.mts shim was added or extended:
git add tests/megaPersona.d.mts
git commit -m "$(cat <<'EOF'
feat(bot v5.1): analyzer rebound sanity bounds (task 4 of 4)

evaluateReboundSanityBounds in scripts/analyze-mega-run.mjs flags
per-persona breaches of the three §7 thresholds: rebound-rate-high
(>50% of ticks invoke rebound), rebound-success-degraded (success
ratio <50% with N≥10 attempts), recoveries-high (Layer 2 fired >5
times). Each breach emits a MEDIUM diagnostic row in the analyzer
report — these are post-run signals for triage, not runtime bot
bugs.

5 unit tests cover the three breach kinds individually + a healthy
no-breach case + a multi-breach case.

The analyzer's output now has a "## Rebound sanity bounds" section
that lists breaching personas (or reports clean envelope). Run with:
node scripts/analyze-mega-run.mjs <new-run-id>

Spec: docs/superpowers/specs/2026-05-12-persona-rebound-workstream-3-design.md
Task 4 of 4 — closes workstream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checks

After all four tasks land, verify against spec sections:

1. **Spec coverage:**
   - §3 architecture (two-layer rebound diagram) → tasks 1 (helpers) + 2 (Layer 1 wire) + 3 (Layer 2 wire). ✓
   - §4 components table → all three file changes (megaPersona.mjs / megaPersonaRebound.test.ts / analyze-mega-run.mjs) covered. ✓
   - §5 state machine → matches task 3's branching (recovered → continue; unrecoverable → break). ✓
   - §6 error handling table → task 1 helpers handle all rows; task 3 wires them. ✓
   - §7 telemetry — three new tally fields → task 1 step 4. Three sanity bounds → task 4. ✓
   - §8 testing — 4 helper cases + analyzer cases → tasks 1 + 4. Plus the spec's manual fixture-mode 10-min verification is described in task 2 step 5 (abbreviated to 2-min smoke). ✓
   - §9 pre-committed gates — the gates evaluate the POST-implementation Stage 3 run, not the implementation itself. NOT in plan scope; runs after this PR lands. ✓
   - §10 caveats — first-post-rebound bidi-audit coverage is intact per `ctx.addInitScript`; no implementation needed. ✓
   - §11 out of scope — no tasks for the non-goals; correct. ✓
   - §13 release checklist — task 1 step 5 covers BOT_VERSION bump. Post-merge Stage 3 re-run is a separate operational step. ✓

2. **Placeholder scan:** no TBD/TODO/«fill in» in any task step. All test code blocks are concrete vitest. All file paths are absolute relative to repo root. Commit messages are heredoc-wrapped per CLAUDE.md convention.

3. **Type consistency:**
   - `reboundIfOffBase(page, baseOrigin, basePathname, baseUrl, tally)` — used in task 1 helper definition, task 2 wire, task 1 tests. All five args consistent. ✓
   - `tryRecoverFromPageDeath(page, baseUrl, persona, picked, logBug, tally)` — used in task 1 helper, task 3 wire, task 1 tests. All six args consistent. ✓
   - Tally field names: `rebound_attempts`, `rebound_successes`, `recoveries` — same names in helpers, tests, tally init, and analyzer. ✓
   - Return type of `tryRecoverFromPageDeath`: literal `'recovered' | 'unrecoverable'` — task 1 helper returns these strings; task 3 wire compares with `===`. ✓

4. **No spec gaps found**, but one note: spec §4 says "Modify: `scripts/lib/megaPersona.mjs`" without naming the analyzer file. The plan adds the analyzer modification (task 4) because §7 declares analyzer-side assertions. This is the kind of "add a task for an under-specified requirement" the writing-plans skill prescribes. Flagging it here so spec-vs-plan reconciliation is auditable in the next review.
