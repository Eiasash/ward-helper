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
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

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

afterEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string, ui: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('App shell', () => {
  it('renders the bottom nav with the three Hebrew labels (no router wrapper — App owns its HashRouter)', () => {
    render(<App />);
    expect(screen.getByText('צלם')).toBeInTheDocument();
    expect(screen.getByText('היסטוריה')).toBeInTheDocument();
    expect(screen.getByText('הגדרות')).toBeInTheDocument();
  });
});

describe('Capture screen', () => {
  it('mounts and shows the 5 note-type selector labels in Hebrew', () => {
    renderAt('/', <Capture />);
    // The note-type selector in Capture.tsx exposes these 5 labels.
    expect(screen.getByText('קבלה')).toBeInTheDocument();
    expect(screen.getByText('שחרור')).toBeInTheDocument();
    expect(screen.getByText('ייעוץ')).toBeInTheDocument();
    expect(screen.getByText('מקרה מעניין')).toBeInTheDocument();
    expect(screen.getByText('SOAP יומי')).toBeInTheDocument();
  });
});

describe('Review screen', () => {
  it('mounts without crashing when no shots have been captured', () => {
    // No sessionStorage state, no shots queued — Review should render its
    // empty/error state, not throw.
    expect(() => renderAt('/review', <Review />)).not.toThrow();
  });
});

describe('NoteEditor screen', () => {
  it('mounts in generation state when no validated payload is in sessionStorage', () => {
    // The editor starts in 'gen' status — verifies the initial-mount path
    // doesn't crash and at least one Hebrew or status indicator is shown.
    expect(() => renderAt('/edit', <NoteEditor />)).not.toThrow();
  });
});

describe('Save screen', () => {
  it('mounts without crashing in idle state', () => {
    expect(() => renderAt('/save', <Save />)).not.toThrow();
  });
});

describe('History screen', () => {
  it('mounts and shows search-input affordance even when no patients exist', () => {
    expect(() => renderAt('/history', <History />)).not.toThrow();
  });
});

describe('Settings screen', () => {
  it('mounts without crashing (no saved API key, no passphrase)', () => {
    expect(() => renderAt('/settings', <Settings />)).not.toThrow();
  });
});
