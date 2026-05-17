/**
 * Structural containment guard for RosterImportModal's intentionally-wide
 * bare-`fr` grids (fresh-eye-review follow-up to #177/#179, 2026-05-17).
 *
 * THE INVARIANT: the modal's manual editor (`2fr 1fr 1fr 1fr 1fr 1fr 2fr
 * auto`, 8 cols) and preview rows (`1fr auto`) ARE deliberately wider than
 * a 390px viewport. They do not pan the page because each lives inside a
 * box whose `overflow` is not `visible` — concretely TWO of them: the
 * modal panel (RosterImportModal.tsx:254, `overflow:hidden`, the actual
 * page-pan boundary — content beyond it is clipped) and the inner phase
 * wrapper (:309/:467, `overflow:auto`, which additionally makes the wide
 * form *scrollable* rather than just clipped). A real-pan oracle
 * (scrollTo(9999,0)→scrollX) confirmed scrollX=0 across paste/manual/
 * preview on 2026-05-17. The page-pan-prevention invariant is therefore
 * "inside SOME overflow≠visible ancestor", NOT "has an overflow:auto
 * ancestor" — naming the specific mechanism would be the same overclaim
 * the deleted token-count test made.
 *
 * The previous guard (todayCardGridBlowout test 3) counted `overflow:auto`
 * TOKENS in the file — it could not see whether either token actually
 * enclosed a grid. The real failure mode is containment *decoupling*: lift
 * the grid out from under its wrapper and the token count is unchanged
 * while the h-scroll returns. This test asserts the DOM-ancestry
 * relationship instead: every bare-`fr` grid the modal renders must have a
 * scroll-contained ancestor.
 *
 * WHAT THIS DOES NOT CATCH (documented so the verdict doesn't outrun the
 * artifact — the mistake #179's docstring made):
 *  - Real horizontal pan in a browser. happy-dom does not lay out, so this
 *    cannot verify the contained ancestor is actually width-constrained or
 *    that the page truly doesn't scroll. The empirical oracle
 *    (Playwright scrollTo→scrollX, run manually 2026-05-17) remains the
 *    only ground truth for that; it is intentionally NOT wired into the
 *    vitest CI gate (would add browser download + e2e flake to a fast
 *    deterministic suite for one assertion). If it ever needs to recur,
 *    the right shape is a callable script alongside scripts/ward-helper-
 *    bot-*.mjs, not a CI job.
 *  - An `overflow:auto` ancestor whose layout still fails to clip.
 *  - Containment moved off inline style. `overflowOf` reads `el.style`
 *    only. If the modal is refactored so the contained ancestor sets
 *    overflow via a CSS *class* (not inline), or the modal moves to
 *    `createPortal` (rendering outside `container`), this test FALSE-FAILS
 *    — but in the SAFE direction: a loud RED, never a silent miss. A
 *    future refactorer who sees this go red after such a change should
 *    re-point the ancestor walk (computed style / portal root), not
 *    assume a real regression. Inline-only is deliberate: happy-dom can't
 *    resolve class-based overflow without layout anyway, so widening the
 *    read would add false-greens, not coverage.
 * This guard catches exactly the decoupling failure mode the fresh-eye
 * review named, deterministically, in the existing gate. No more, no less.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterImportModal } from '@/ui/components/RosterImportModal';

const BARE_FR = /(?<!minmax\(\s*0\s*,\s*)\b\d*\.?\d+fr\b/;
const SCROLL_CONTAINED = /^(auto|hidden|scroll|clip)$/;

/** Inline-style overflow on an element (shorthand or x-axis). */
function overflowOf(el: HTMLElement): string {
  const s = el.style;
  return s.overflowX || s.overflow || '';
}

/**
 * For every element under `root` whose inline gridTemplateColumns contains a
 * bare `<n>fr` track (not minmax(0,…)), assert some ancestor (up to and
 * including `root`) is scroll-contained. Returns offenders for a precise
 * failure message.
 */
function uncontainedBareFrGrids(root: HTMLElement) {
  const offenders: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const gtc = el.style.gridTemplateColumns;
    if (!gtc || !BARE_FR.test(gtc)) continue;
    let node: HTMLElement | null = el.parentElement;
    let deepest = el.tagName;
    let contained = false;
    while (node) {
      deepest = `${node.tagName}.${String(node.className || '')}`.slice(0, 40);
      if (SCROLL_CONTAINED.test(overflowOf(node))) {
        contained = true;
        break;
      }
      if (node === root) break;
      node = node.parentElement;
    }
    if (!contained) {
      offenders.push(
        `grid "${gtc}" has NO scroll-contained ancestor (walked up to <${deepest}>)`,
      );
    }
  }
  return offenders;
}

describe('RosterImportModal — bare-`fr` grids stay scroll-contained', () => {
  it('manual tab: the 8-col ManualRowEditor grid stays inside an overflow≠visible ancestor', () => {
    const { container } = render(
      <RosterImportModal isOpen onClose={vi.fn()} onCommit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'ידני' }));
    // sanity: a bare-`fr` grid actually rendered (guards against the test
    // silently passing because the editor changed and no grid exists)
    const grids = Array.from(
      container.querySelectorAll<HTMLElement>('*'),
    ).filter((e) => e.style.gridTemplateColumns && BARE_FR.test(e.style.gridTemplateColumns));
    expect(grids.length).toBeGreaterThan(0);
    expect(uncontainedBareFrGrids(container)).toEqual([]);
  });

  it('preview phase: the per-row `1fr auto` grid stays inside an overflow≠visible ancestor', () => {
    const { container } = render(
      <RosterImportModal isOpen onClose={vi.fn()} onCommit={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('טקסט להדבקה'), {
      target: { value: '123456782 | רוזנברג מרים | 87 | 12 | A | 5 | Hip' },
    });
    fireEvent.click(screen.getByText('תצוגה מקדימה ←'));
    const grids = Array.from(
      container.querySelectorAll<HTMLElement>('*'),
    ).filter((e) => e.style.gridTemplateColumns && BARE_FR.test(e.style.gridTemplateColumns));
    expect(grids.length).toBeGreaterThan(0);
    expect(uncontainedBareFrGrids(container)).toEqual([]);
  });
});
