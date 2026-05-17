/**
 * Regression guard for the 2026-05-17 /today document h-scroll fix (v1.46.2)
 * + its fresh-eye-review follow-up.
 *
 * THE BUG (fixed in PR #177): the SOAP-mode roster card in Today.tsx
 * (rendered when localStorage.batch_features=1) was an inline CSS grid
 * `gridTemplateColumns: 'auto 1fr'`. A bare `1fr` track = `minmax(auto,1fr)`;
 * a grid item spanning an auto-min track takes its content-based min-content
 * automatic minimum. The dx column's wrapper inherits the nowrap
 * `.today-meta` string's min-content (~417px), so the track refused to
 * shrink past the 390px card, forced a document-wide h-scroll, and stretched
 * the fixed .header-strip/.bottom-nav to 485px (the symptom three prior
 * sessions chased at the header). Fix: `auto minmax(0, 1fr)` floors the
 * track minimum at 0 so it shrinks and the existing
 * text-overflow:ellipsis on .today-meta truncates as designed.
 *
 * SCOPE — read this before trusting the test name. Both tests below are a
 * SOURCE-invariant pin on `Today.tsx` ONLY (mirrors
 * a11yContrast2026-05-10.test.ts). A single readFileSync CANNOT guard
 * RosterImportModal.tsx or Review.tsx, and CANNOT see DOM structure — so it
 * is not the place to guard the modal grids.
 *
 * The fresh-eye review (2026-05-17) flagged three OTHER bare-`fr` inline
 * grids reachable from /today: RosterImportModal.tsx:479 (`1fr auto`), :584
 * (8-col ManualRowEditor), Review.tsx:590. A real-pan oracle (iPhone-13,
 * batch_features=1, scrollTo(9999,0)→scrollX across modal paste / manual /
 * preview) showed scrollX=0 in every state — they are contained, page never
 * pans — so they were NOT blind-fixed (rule #2). Their containment is now
 * guarded STRUCTURALLY (DOM-ancestry, the real failure mode) by a separate
 * render test: `tests/rosterModalGridContainment.test.tsx`. An earlier
 * version of THIS file had a third test that counted `overflow:auto` tokens
 * in the modal source; it was deleted — a token count cannot tell whether a
 * token encloses a grid, so it read strong while being weak (a weak guard
 * is worse than none). See the sibling file's docstring for what the
 * structural guard does and does NOT catch.
 *
 * If you roll any pinned line back, delete the matching guard too — never
 * just edit source and watch the test fail. The pin is what makes the fix
 * durable across future restyles.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const todaySrc = readFileSync(
  path.resolve(__dirname, '..', 'src', 'ui', 'screens', 'Today.tsx'),
  'utf8',
);

describe('/today roster card grid — blowout guard (2026-05-17)', () => {
  it('Today.tsx: the roster-card grid floors the flexible track (minmax(0, 1fr))', () => {
    // The exact #177 lever. minmax(0, 1fr) — NOT a bare 1fr, whose
    // automatic minimum is min-content and blows the track out under
    // nowrap content.
    expect(todaySrc).toMatch(
      /gridTemplateColumns:\s*['"]auto\s+minmax\(\s*0\s*,\s*1fr\s*\)['"]/,
    );
  });

  it('Today.tsx: no inline grid uses a bare `<n>fr` track (any unit, not just 1fr)', () => {
    // Honest scope: this pins TODAY.TSX ONLY. Broadened from the original
    // `1fr`-literal regex (which let `2fr`/`1.5fr` regress silently) to any
    // bare fractional track NOT wrapped in minmax(0,...). A bare `<n>fr`
    // re-introduces the min-content blowout regardless of the coefficient.
    const inlineGrids = [
      ...todaySrc.matchAll(/gridTemplateColumns:\s*(['"])([^'"]*)\1/g),
    ].map((m) => m[2] ?? '');
    const bareFr = /(?<!minmax\(\s*0\s*,\s*)\b\d*\.?\d+fr\b/;
    const offenders = inlineGrids.filter((g) => bareFr.test(g));
    expect(offenders).toEqual([]);
  });
});
