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
 * SCOPE — read this before trusting the test name:
 *  - Tests 1-2 are a SOURCE-invariant pin on `Today.tsx` ONLY (mirrors
 *    a11yContrast2026-05-10.test.ts). They do NOT — and cannot, via a
 *    single readFileSync — guard RosterImportModal.tsx or Review.tsx.
 *  - The fresh-eye review (2026-05-17) flagged three OTHER bare-`fr`
 *    inline grids reachable from /today: RosterImportModal.tsx:479
 *    (`1fr auto`), :584 (8-col ManualRowEditor), Review.tsx:590. These
 *    were empirically tested with a real-pan oracle (iPhone-13,
 *    batch_features=1, scrollTo(9999,0)→scrollX across modal paste /
 *    manual / preview states): scrollX stayed 0 in EVERY state. They are
 *    contained by their `overflow:auto` parent (RosterImportModal.tsx:309
 *    input-tabs, :467 preview) — wide content scrolls inside the modal,
 *    the page never pans. So they are NOT blind-fixed (rule #2: no
 *    speculative change for a non-manifesting issue). Test 3 instead pins
 *    the real protective invariant: that `overflow:auto` containment.
 *
 * If you roll any pinned line back, delete the matching guard too — never
 * just edit source and watch the test fail. The pin is what makes the fix
 * durable across future restyles.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (...p: string[]) =>
  readFileSync(path.resolve(__dirname, '..', 'src', ...p), 'utf8');

const todaySrc = read('ui', 'screens', 'Today.tsx');
const modalSrc = read('ui', 'components', 'RosterImportModal.tsx');

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

  it('RosterImportModal.tsx: bare-`fr` grids stay contained by overflow:auto', () => {
    // The modal's manual (:584, 8-col) + preview (:479, 1fr auto) grids
    // ARE intentionally wide form layouts. They do not pan the page only
    // because their phase wrappers (input-tabs :309, preview :467) are
    // `overflow:auto` — verified by real-pan oracle 2026-05-17 (scrollX=0
    // across paste/manual/preview). Pin that containment so a refactor
    // that drops overflow:auto can't silently re-expose the h-scroll.
    const wrappers = [
      ...modalSrc.matchAll(/style=\{\{[^}]*overflow:\s*['"]auto['"][^}]*\}\}/g),
    ];
    expect(wrappers.length).toBeGreaterThanOrEqual(2);
  });
});
