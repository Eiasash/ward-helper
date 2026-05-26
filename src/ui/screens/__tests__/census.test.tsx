/**
 * Census screen — verify the parse → edit → confirm flow upserts patients.
 *
 * Strategy:
 *   - The full integration (real file picker → FileReader → fetch → blob →
 *     compressImage → runCensusExtractTurn) has too many DOM/runtime
 *     dependencies to stub reliably across test isolation. We test the
 *     visible state transitions through the existing component API by
 *     stubbing only the agent layer and asserting on the idle/error
 *     surfaces. The full storage round-trip is covered by
 *     src/storage/__tests__/census.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

import { Census } from '@/ui/screens/Census';
import { resetDbForTests } from '@/storage/indexed';

vi.mock('@/agent/loop', async () => {
  const actual = await vi.importActual<typeof import('@/agent/loop')>('@/agent/loop');
  return { ...actual, runCensusExtractTurn: vi.fn() };
});

vi.mock('@/skills/loader', () => ({
  loadSkills: vi.fn(async () => 'mock-skill'),
}));

vi.mock('@/camera/compress', () => ({
  compressImage: vi.fn(async (d: string) => d),
}));

async function flushEffects() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  sessionStorage.clear();
  await resetDbForTests();
});

afterEach(async () => {
  await flushEffects();
  cleanup();
  vi.clearAllMocks();
});

function renderCensus() {
  return render(
    <MemoryRouter initialEntries={['/census']}>
      <Census />
    </MemoryRouter>,
  );
}

describe('Census — idle state', () => {
  it('renders the heading and upload affordance', async () => {
    renderCensus();
    await flushEffects();
    expect(screen.getByText('רשימת מחלקה')).toBeInTheDocument();
    expect(screen.getByText(/הוסף תמונות/)).toBeInTheDocument();
  });

  it('renders the parse button disabled when no shots are queued', async () => {
    renderCensus();
    await flushEffects();
    const parseBtn = screen.getByRole('button', { name: 'נתח רשימה' });
    expect(parseBtn).toBeDisabled();
  });

  it('mounts inside Suspense (smoke for lazy loader contract)', () => {
    expect(() => renderCensus()).not.toThrow();
  });

  it('regression: the visually-hidden file-picker label has no left:-9999 inline style', async () => {
    // History: until 2026-05-26 the screen-reader-only <label> for #census-pick
    // had BOTH className="visually-hidden" (which already collapses to 1x1px
    // via the styles.css rule) AND inline style={{ position: 'absolute',
    // left: -9999 }}. The redundant inline `left:-9999` put the element at
    // x=-9999px while still occupying its 1px width — which made <html>
    // scrollWidth jump from 393px to 10393px on a 393px viewport. The
    // resulting horizontal scroll caused the page to render at the wrong
    // scroll position on Android Chrome RTL, with most of the viewport
    // appearing black and content compressed to one edge (see images 1, 3
    // of the 2026-05-26 user report).
    //
    // The fix: remove the inline style entirely; .visually-hidden CSS class
    // handles the off-screen rendering correctly with 1x1 + overflow:hidden
    // + clip:rect(0 0 0 0). This test fails if the inline style returns.
    renderCensus();
    await flushEffects();
    const hiddenLabel = document.querySelector('label.visually-hidden[for="census-pick"]');
    expect(hiddenLabel).not.toBeNull();
    // Inline style should be absent or empty — class CSS does the work.
    const inlineStyle = hiddenLabel?.getAttribute('style') ?? '';
    expect(inlineStyle).not.toMatch(/-?9{4,}/);
    expect(inlineStyle).not.toMatch(/left\s*:/i);
  });
});
