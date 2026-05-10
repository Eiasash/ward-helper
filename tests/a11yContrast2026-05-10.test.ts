/**
 * Regression tests for the 2026-05-10 a11y contrast port (v1.43.0).
 *
 * Live audit on https://eiasash.github.io/ward-helper/ before this fix
 * found 5 sub-AA contrast violations. These tests pin the css-level
 * mitigations so a future restyle can't silently regress them. Each
 * assertion targets the exact selector + property the live playwright
 * audit flagged.
 *
 * If you need to roll one of these back, also delete the matching guard
 * here — never just edit styles.css and watch the test fail. The pin
 * is what makes the fix durable across re-themes.
 *
 * Reference patterns: ports of Geri v10.64.82-87 (issue #125), FM
 * v1.21.20-21 (PRs #56/#57), IM v10.4.21 (PR #114).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const stylesCss = readFileSync(
  path.resolve(__dirname, '..', 'src', 'styles.css'),
  'utf8',
);

describe('a11y contrast — 2026-05-10 port', () => {
  it('skip-link uses var(--bg) background, not var(--accent), so white-on-bg passes AA', () => {
    // Original: `background: var(--accent);` → white on #1aa9b3 = 2.85:1 (sub-AA).
    // Fix: bg = var(--bg) (#1a2438), white-on-navy ≈ 15.5:1 AAA, with --accent border.
    const skipLinkBlock = stylesCss.match(/\.skip-link\s*\{[^}]*\}/);
    expect(skipLinkBlock).not.toBeNull();
    expect(skipLinkBlock![0]).toMatch(/background:\s*var\(--bg\)/);
    expect(skipLinkBlock![0]).not.toMatch(/background:\s*var\(--accent\)\s*;/);
    expect(skipLinkBlock![0]).toMatch(/border:\s*2px\s+solid\s+var\(--accent\)/);
  });

  it('header-strip-name.muted has light-mode color override (slate-600) for AA', () => {
    // --muted (#8a8678) on the light-mode header bg (~white) is 3.64:1 (sub-AA).
    // Fix: scoped @media (prefers-color-scheme: light) override #475569 (7.58:1 AAA).
    expect(stylesCss).toMatch(
      /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*\.header-strip-name\.muted\s*\{\s*color:\s*#475569/,
    );
  });

  it('default button gradient starts at --accent-strong (4.70:1 alone, 5.30:1 avg) not --accent', () => {
    // Original gradient: var(--accent) #1aa9b3 → var(--accent-strong) #128088
    // averaged 3.63:1 white-on-bg (sub-AA). Fix raises both stops:
    // var(--accent-strong) → #0d6e75. Avg ~5.30:1 AA+.
    const buttonBlock = stylesCss.match(/^button,\s*\.btn\s*\{[\s\S]*?\}/m);
    expect(buttonBlock).not.toBeNull();
    expect(buttonBlock![0]).toMatch(
      /background:\s*linear-gradient\(180deg,\s*var\(--accent-strong\),\s*#0d6e75\)/,
    );
    // Make sure the unfixed pattern is gone.
    expect(buttonBlock![0]).not.toMatch(
      /background:\s*linear-gradient\(180deg,\s*var\(--accent\),\s*var\(--accent-strong\)\)/,
    );
  });

  it('.btn-like (label-as-button) gradient matches button gradient', () => {
    // Same fix applied to .btn-like for the label-wrapped file inputs on
    // mobile (camera/gallery pickers).
    const btnLikeBlock = stylesCss.match(/\.btn-like\s*\{[\s\S]*?\}/);
    expect(btnLikeBlock).not.toBeNull();
    expect(btnLikeBlock![0]).toMatch(
      /background:\s*linear-gradient\(180deg,\s*var\(--accent-strong\),\s*#0d6e75\)/,
    );
  });

  it('.app-version footer color is var(--fg-2), not var(--muted)', () => {
    // --muted (#8a8678) on --bg (#1a2438) was 4.26:1 — narrowly sub-AA at
    // 11px after the warm-slate-navy palette migration. Bumped to --fg-2
    // (#c5c2b9) which gives 8.71:1 AAA while staying visually subordinate.
    const versionBlock = stylesCss.match(/\.app-version\s*\{[\s\S]*?\}/);
    expect(versionBlock).not.toBeNull();
    expect(versionBlock![0]).toMatch(/color:\s*var\(--fg-2\)/);
    expect(versionBlock![0]).not.toMatch(/color:\s*var\(--muted\)\s*;/);
  });
});

describe('a11y contrast — base palette invariants', () => {
  it('--accent-strong stays at #128088 (4.70:1 white solid, anchors button gradient top)', () => {
    // The bubble-user / account-avatar / borders rely on this remaining
    // ≥ 4.7:1. If you ever bump --accent-strong, re-verify those.
    expect(stylesCss).toMatch(/--accent-strong:\s*#128088/);
  });

  it('--fg-2 stays at #c5c2b9 (8.71:1 on --bg, used for .app-version)', () => {
    expect(stylesCss).toMatch(/--fg-2:\s*#c5c2b9/);
  });

  it('--bg stays at #1a2438 (warm slate-navy migration target)', () => {
    expect(stylesCss).toMatch(/--bg:\s*#1a2438/);
  });
});

describe('a11y contrast — version trinity sanity', () => {
  it('package.json + sw.js share the same version after the bump', () => {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    const sw = readFileSync(
      path.resolve(__dirname, '..', 'public', 'sw.js'),
      'utf8',
    );
    const swMatch = sw.match(/const VERSION = 'ward-v([^']+)'/);
    expect(swMatch).not.toBeNull();
    // Source sw.js is allowed to drift slightly because the vite plugin
    // rewrites it at build (see CLAUDE.md), but we keep them in sync at
    // commit time so the presence guard holds and verify-deploy.sh sees
    // the right marker on the live URL.
    expect(swMatch![1]).toBe(pkg.version);
  });
});
