/**
 * Regression guard for the 2026-05-17 /today document h-scroll fix (v1.46.2).
 *
 * Live + bot-FIXTURE audit on the SOAP-mode roster card (rendered when
 * localStorage.batch_features=1) found body scrollWidth 484px > 390px on an
 * iPhone-13 viewport. Root cause: the per-patient card in Today.tsx is an
 * inline CSS grid whose template was `auto 1fr`. A bare `1fr` track resolves
 * its automatic minimum to min-content; the dx column inside it has
 * `white-space: nowrap`, so its min-content is the FULL string width (~417px).
 * The track refused to shrink, blew past the 390px card, forced a
 * document-wide horizontal scroll, and stretched the fixed .header-strip /
 * .bottom-nav to 485px — the symptom three prior sessions chased at the
 * header (the @media(max-width:420px) block + PR #174's overflow:hidden)
 * instead of here.
 *
 * Fix: `auto minmax(0, 1fr)` — flooring the track minimum at 0 lets it
 * shrink to the card so the existing text-overflow:ellipsis on .today-meta
 * truncates the dx as designed.
 *
 * This is a SOURCE-invariant pin (mirrors a11yContrast2026-05-10.test.ts):
 * if you roll the grid template back, delete this guard too — never just
 * edit Today.tsx and watch the test fail. The pin is what makes the fix
 * durable across future restyles of the roster card.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const todaySrc = readFileSync(
  path.resolve(__dirname, '..', 'src', 'ui', 'screens', 'Today.tsx'),
  'utf8',
);

describe('/today SOAP-mode roster card grid — blowout guard (2026-05-17)', () => {
  it('the inline grid template floors the flexible track at 0 (minmax(0, 1fr))', () => {
    // The exact lever. minmax(0, 1fr) — NOT a bare 1fr, whose automatic
    // minimum is min-content and blows the track out under nowrap content.
    expect(todaySrc).toMatch(/gridTemplateColumns:\s*['"]auto\s+minmax\(\s*0\s*,\s*1fr\s*\)['"]/);
  });

  it('no inline grid template uses a bare `1fr` flexible track', () => {
    // Catches a regression on THIS card and any new roster-card grid that
    // copy-pastes the old pattern. A bare `1fr` (not inside minmax(0,...))
    // re-introduces the min-content blowout.
    const bareOneFr = /gridTemplateColumns:\s*['"][^'"]*(?<!minmax\(\s*0\s*,\s*)\b1fr\b[^'"]*['"]/;
    expect(todaySrc).not.toMatch(bareOneFr);
  });
});
