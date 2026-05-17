/**
 * Regression guard for the 2026-05-17 bot-run finding
 * `resetPassword/silent-on-fake-token` (HIGH) — which the code review
 * proved was a BOT false-positive, not an app defect.
 *
 * Root cause: `scenResetPasswordLanding` in subBotsV4.mjs clicked submit,
 * then `await sleep(2500)` and read the banner ONCE. PasswordReset.tsx
 * awaits `authResetPasswordWithToken` → `_rpc` → `getSupabase()` + a
 * Supabase RPC round-trip. A cold Supabase init + RPC routinely exceeds
 * 2.5s, so the bot read while `busy=true` (button "מאפס…", status still
 * null) and logged a false HIGH. `_rpc` cannot throw and
 * PasswordReset.tsx:52 unconditionally sets the error banner on any
 * `!res.ok` — the app is correct (see passwordResetPendingState.test.tsx).
 *
 * The megaBotV41 schema invariant only checks waitForSubject appears
 * SOMEWHERE in the sub-bot (it does — the mount wait). This pins the
 * finer invariant the bug needed: the POST-SUBMIT banner read must be
 * gated by waitForSubject, not a bare fixed sleep. Source-level (same
 * convention as megaBotV41 Test 2) — caught at PR review, not after a
 * 30-min Opus run.
 *
 * If you roll the poll back to a fixed sleep, delete this guard too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '..', 'scripts', 'lib', 'subBotsV4.mjs'),
  'utf8',
);

/** Extract one exported async function body via brace matching. */
function bodyOf(name: string): string {
  const re = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return '';
  let i = m.index + m[0].length;
  while (i < src.length && src[i] !== '{') i++;
  let depth = 1;
  const start = ++i;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return src.slice(start, i - 1);
}

describe('mega-bot — resetPassword post-submit banner read must poll, not fixed-sleep', () => {
  const body = bodyOf('scenResetPasswordLanding');

  it('scenResetPasswordLanding is found in subBotsV4.mjs', () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it('the region between reset-submit and the silent-on-fake-token check waits via waitForSubject (not a bare sleep)', () => {
    const afterSubmit = body.indexOf("'reset-submit'");
    // End-marker = the logBug KEY (slash-prefixed), not the bare phrase —
    // the bare phrase legitimately appears in the fix's explanatory
    // comment, which would falsely truncate the region before the poll.
    const silentCheck = body.indexOf('resetPassword/silent-on-fake-token');
    expect(afterSubmit, "expected a 'reset-submit' safeClick marker").toBeGreaterThan(-1);
    expect(silentCheck, "expected a 'resetPassword/silent-on-fake-token' logBug key").toBeGreaterThan(-1);
    expect(silentCheck).toBeGreaterThan(afterSubmit);

    const region = body.slice(afterSubmit, silentCheck);
    // The banner can arrive after the old 2.5s window (cold Supabase RPC),
    // so the read must be gated by a poll that resolves on the banner.
    expect(
      /waitForSubject\s*\(/.test(region),
      'post-submit banner read is not gated by waitForSubject — a fixed ' +
        'sleep here races the auth RPC round-trip and produces a false ' +
        'HIGH silent-on-fake-token (the 2026-05-17 finding).',
    ).toBe(true);
  });
});
