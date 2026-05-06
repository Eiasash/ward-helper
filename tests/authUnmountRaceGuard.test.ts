/**
 * Pins the unmount-race contract: no `await` may appear between
 * `setAuthSession(...)` and the end of the containing handler body.
 *
 * Background — feedback_react_setauthsession_unmount_race.md (memory):
 *   "Chaining `await` after `setAuthSession` unmounts the calling
 *   component mid-handler; setStatus on the stale closure silently
 *   fails. Always do dependent RPCs BEFORE setAuthSession."
 *
 * The bug was OBSERVED in this exact file (AccountSection.tsx) on
 * 2026-05-02 — account `eiasashhab55555` was created, the email step
 * never landed, user saw bare "שגיאה" with no indication that
 * registration had actually succeeded. Fixed by re-ordering: `await
 * authSetEmail(...)` was moved BEFORE `setAuthSession(...)` so that the
 * <GuestAccount> → <AuthedAccount> swap happens after every dependent
 * await has resolved.
 *
 * The fix is correct today, but it's policy without a guard. A future
 * refactor that adds another await between `setAuthSession` and the
 * end of `onLogin` / `onRegister` will silently regress and surface
 * the same bare-'שגיאה' UX dead-end.
 *
 * Sibling-paired with:
 *   - InternalMedicine/tests/authUnmountRaceGuard.test.js
 *   - FamilyMedicine/tests/authUnmountRaceGuard.test.js
 *   - Geriatrics/tests/authUnmountRaceGuard.test.js
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const src = readFileSync(
  resolve(ROOT, 'src/ui/components/AccountSection.tsx'),
  'utf-8',
);

/**
 * For every line containing `setAuthSession(`, extract the slice from
 * that line forward to the closing brace of the containing top-level
 * handler. Handler bodies in this file end with `}` at column 2 (the
 * GuestAccount component's top-level handler indent). The first such
 * line after `setAuthSession` is the function terminator.
 *
 * If no `}` at column 2 is found before EOF, slice to EOF — that's
 * still valid for the assertion (just no closer terminator).
 */
function tailsAfterSetAuthSession(): string[] {
  const lines = src.split('\n');
  const tails: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Narrow lines[i] for noUncheckedIndexedAccess — bare access types as
    // string|undefined under strict TS.
    const line = lines[i];
    if (!line || !line.includes('setAuthSession(')) continue;
    let endLine = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const inner = lines[j];
      if (inner && /^ {2}\}\s*$/.test(inner)) {
        endLine = j;
        break;
      }
    }
    tails.push(lines.slice(i, endLine).join('\n'));
  }
  return tails;
}

describe('AccountSection — no awaits after setAuthSession (unmount race guard)', () => {
  const tails = tailsAfterSetAuthSession();

  it('finds at least one setAuthSession call site (sanity)', () => {
    // onLogin (login flow) + onRegister (register flow) — at least 2.
    expect(tails.length).toBeGreaterThanOrEqual(2);
  });

  it('every setAuthSession call is followed only by sync ops', () => {
    // \bawait\b matches the word as a token. Comments containing the
    // bare word "await" would false-positive — write comments without
    // it, or this guard is meaningless.
    for (const tail of tails) {
      expect(tail).not.toMatch(/\bawait\b/);
    }
  });
});
