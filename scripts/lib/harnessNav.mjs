/**
 * harnessNav — the single navigation seam for the #176 NotFoundError
 * repro-harness. Implements kickoff rule 4 (the system invariant: prove
 * the error detector is armed *per navigation*, never assume).
 *
 * Rule 4 is written against the claude-in-chrome MCP (per-page-load
 * console buffer + catch-all `.` read). This is a Playwright harness;
 * Playwright `page.on(...)` listeners persist across navigation, so the
 * faithful realization of the SAME invariant is:
 *
 *   1. Attach console/pageerror/crash capture ONCE per page, BEFORE its
 *      first navigation (idempotent — a 2nd-context page created for the
 *      H1 probe gets its own capture before it ever navigates).
 *   2. After EVERY navigation, assert the capture pipe is live via a
 *      sentinel `console.debug` round-trip. If the sentinel is not
 *      observed within the timeout, THROW — fail closed. A harness that
 *      cannot prove its detector is live must not emit a clean verdict.
 *
 * No bare page.goto / page.reload anywhere in the harness — every
 * navigation goes through safeNavigate(). scripts/<harness>.mjs has a
 * self-test that greps to enforce this.
 *
 * Harness-only. Never imported by app code.
 */

const _attached = new WeakSet();

/**
 * Idempotently attach the capture pipe to a page. Returns the mutable
 * capture record. Unhandled promise rejections are routed THROUGH the
 * console pipe (see the harness addInitScript that emits
 * `[HARNESS_REJECTION] {json}`) so a single sentinel proves both the
 * console AND the rejection path are armed.
 */
export function attachCapture(page) {
  if (page.__harnessCapture) return page.__harnessCapture;
  const rec = {
    console: [],          // { type, text, ts }
    pageerrors: [],       // { name, message, stack, ts }
    rejections: [],       // { name, message, stack, ts }  (parsed from console)
    crashes: 0,
  };
  page.on('console', (msg) => {
    const text = msg.text();
    rec.console.push({ type: msg.type(), text, ts: Date.now() });
    if (text.startsWith('[HARNESS_REJECTION] ')) {
      try {
        rec.rejections.push({ ...JSON.parse(text.slice(20)), ts: Date.now() });
      } catch { /* keep the raw line in rec.console regardless */ }
    }
  });
  page.on('pageerror', (err) => {
    rec.pageerrors.push({
      name: err?.name ?? null,
      message: String(err?.message ?? err).slice(0, 400),
      stack: String(err?.stack ?? '').slice(0, 1200),
      ts: Date.now(),
    });
  });
  page.on('crash', () => { rec.crashes += 1; });
  page.__harnessCapture = rec;
  _attached.add(page);
  return rec;
}

/**
 * Prove the capture pipe is live for the CURRENT page-load. Sentinel
 * round-trip: emit a unique console.debug from the page, wait until the
 * attached listener observes it. Throws (fail-closed) on timeout —
 * "console clean" off an unproven pipe is the exact false all-clear
 * rule 4 exists to prevent.
 */
export async function assertCaptureLive(page, { timeoutMs = 4000 } = {}) {
  const rec = page.__harnessCapture;
  if (!rec) throw new Error('assertCaptureLive: capture not attached (call attachCapture/safeNavigate first)');
  const token = `__HARNESS_SENTINEL__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const before = rec.console.length;
  await page.evaluate((t) => console.debug(t), token);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (rec.console.slice(before).some((m) => m.text.includes(token))) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `assertCaptureLive: sentinel not observed within ${timeoutMs}ms — ` +
    `console capture pipe is NOT live post-navigation. Refusing to ` +
    `continue (a clean verdict from an unproven detector is invalid).`,
  );
}

/**
 * The ONLY navigation primitive the harness may use. goto →
 * waitForSelector(readySel) → assertCaptureLive. Returns the capture rec.
 */
export async function safeNavigate(page, url, { readySel, gotoTimeoutMs = 30_000, readyTimeoutMs = 30_000, sentinelTimeoutMs = 4000 } = {}) {
  const rec = attachCapture(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gotoTimeoutMs });
  if (readySel) {
    await page.waitForSelector(readySel, { timeout: readyTimeoutMs });
  }
  await assertCaptureLive(page, { timeoutMs: sentinelTimeoutMs });
  return rec;
}

/** Reload through the same seam (kickoff: no bare page.reload). */
export async function safeReload(page, { readySel, readyTimeoutMs = 30_000, sentinelTimeoutMs = 4000 } = {}) {
  const rec = page.__harnessCapture ?? attachCapture(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (readySel) {
    await page.waitForSelector(readySel, { timeout: readyTimeoutMs });
  }
  await assertCaptureLive(page, { timeoutMs: sentinelTimeoutMs });
  return rec;
}
