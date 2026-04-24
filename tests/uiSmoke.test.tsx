/**
 * UI smoke tests — confirm every screen mounts without crashing in happy-dom
 * and surfaces a known Hebrew label so a render-blocking regression (broken
 * import, unhandled hook throw, white screen on initial mount) is caught.
 *
 * Why happy-dom + RTL is enough: these are mount tests, not interaction
 * tests. We're not asserting "user clicks button → state changes" — that
 * level of behavior is covered by the per-module unit tests
 * (notes.test.ts, agent.test.ts, save.test.ts, etc.). The UI gap they
 * close is "I refactored useSettings and now Settings.tsx throws on render".
 *
 * Mocks: storage/cloud and agent/loop are stubbed so the screens don't
 * issue real network calls during mount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

/** Drain microtasks + the next macro-task so any setState scheduled by mount
 * effects (e.g. Review's async extract, History's listPatients) lands BEFORE
 * we unmount. Otherwise a stray callback fires after happy-dom tears down
 * `window`, surfacing as an unhandled "window is not defined" rejection that
 * fails CI even though the assertions pass. */
async function flushEffects() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

vi.mock('@/storage/cloud', () => ({
  encryptForCloud: vi.fn(),
  pushBlob: vi.fn(),
  pullBlobs: vi.fn(async () => []),
}));
vi.mock('@/agent/loop', () => ({
  runExtractTurn: vi.fn(async () => ({ fields: {}, confidence: {} })),
  runEmitTurn: vi.fn(async () => ({ text: '' })),
}));
vi.mock('@/skills/loader', () => ({
  loadSkills: vi.fn(async () => ({})),
}));

// Passthrough mocks for the two modules driving the Settings path indicator.
// Default behavior is identical to the real implementation; individual tests
// override useApiKey / activePath to cover the 🟢/🟡 states.
vi.mock('@/ui/hooks/useSettings', async () => {
  const actual =
    await vi.importActual<typeof import('@/ui/hooks/useSettings')>(
      '@/ui/hooks/useSettings',
    );
  return { ...actual, useApiKey: vi.fn(actual.useApiKey) };
});
vi.mock('@/agent/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/agent/client')>('@/agent/client');
  return { ...actual, activePath: vi.fn(actual.activePath) };
});

import { useApiKey } from '@/ui/hooks/useSettings';
import { activePath } from '@/agent/client';

import { App } from '@/ui/App';
import { Capture } from '@/ui/screens/Capture';
import { Review } from '@/ui/screens/Review';
import { NoteEditor } from '@/ui/screens/NoteEditor';
import { Save } from '@/ui/screens/Save';
import { History } from '@/ui/screens/History';
import { Settings } from '@/ui/screens/Settings';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(async () => {
  await flushEffects();
  cleanup();
  vi.clearAllMocks();
});

function renderAt(path: string, ui: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('App shell', () => {
  it('renders the bottom nav with the three Hebrew labels (no router wrapper — App owns its HashRouter)', async () => {
    render(<App />);
    await flushEffects();
    expect(screen.getByText('צלם')).toBeInTheDocument();
    expect(screen.getByText('היסטוריה')).toBeInTheDocument();
    expect(screen.getByText('הגדרות')).toBeInTheDocument();
  });
});

describe('Capture screen', () => {
  it('mounts and shows the 5 note-type selector labels in Hebrew', async () => {
    renderAt('/', <Capture />);
    await flushEffects();
    expect(screen.getByText('קבלה')).toBeInTheDocument();
    expect(screen.getByText('שחרור')).toBeInTheDocument();
    expect(screen.getByText('ייעוץ')).toBeInTheDocument();
    expect(screen.getByText('מקרה מעניין')).toBeInTheDocument();
    expect(screen.getByText('SOAP יומי')).toBeInTheDocument();
  });
});

describe('Review screen', () => {
  it('mounts without crashing when no shots have been captured', async () => {
    expect(() => renderAt('/review', <Review />)).not.toThrow();
    await flushEffects();
  });
});

describe('NoteEditor screen', () => {
  it('mounts in generation state when no validated payload is in sessionStorage', async () => {
    expect(() => renderAt('/edit', <NoteEditor />)).not.toThrow();
    await flushEffects();
  });
});

describe('Save screen', () => {
  it('mounts without crashing in idle state', async () => {
    expect(() => renderAt('/save', <Save />)).not.toThrow();
    await flushEffects();
  });
});

describe('History screen', () => {
  it('mounts and shows search-input affordance even when no patients exist', async () => {
    expect(() => renderAt('/history', <History />)).not.toThrow();
    await flushEffects();
  });
});

describe('Settings screen', () => {
  it('mounts without crashing (no saved API key, no passphrase)', async () => {
    expect(() => renderAt('/settings', <Settings />)).not.toThrow();
    await flushEffects();
  });

  it('shows 🟢 direct-path status when API key is set', async () => {
    vi.mocked(useApiKey).mockReturnValue({
      present: true,
      save: vi.fn(async () => {}),
      peek: vi.fn(async () => null),
      clear: vi.fn(async () => {}),
    });
    vi.mocked(activePath).mockResolvedValue('direct');
    renderAt('/settings', <Settings />);
    await flushEffects();
    expect(
      screen.getByText('🟢 פנייה ישירה (api.anthropic.com)'),
    ).toBeInTheDocument();
  });

  it('shows 🟡 proxy-path status when no API key', async () => {
    vi.mocked(useApiKey).mockReturnValue({
      present: false,
      save: vi.fn(async () => {}),
      peek: vi.fn(async () => null),
      clear: vi.fn(async () => {}),
    });
    vi.mocked(activePath).mockResolvedValue('proxy');
    renderAt('/settings', <Settings />);
    await flushEffects();
    expect(
      screen.getByText('🟡 Toranot proxy — פסק זמן 10 שניות'),
    ).toBeInTheDocument();
  });
});
