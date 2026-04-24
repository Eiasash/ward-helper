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
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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
import { PriorNotesBanner } from '@/ui/components/PriorNotesBanner';
import { NoteViewer } from '@/ui/screens/NoteViewer';
import { putPatient, putNote, getNote, resetDbForTests } from '@/storage/indexed';

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

describe('PriorNotesBanner', () => {
  // Unlike the other smoke cases, these touch real IDB. Wipe between tests so
  // seeded patients don't leak into the no-match case (and vice versa).
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('renders when teudatZehut matches existing patient in IDB', async () => {
    const now = Date.now();
    await putPatient({
      id: 'p1',
      name: 'דוד לוי',
      teudatZehut: '111111111',
      dob: '1960-01-01',
      room: null,
      tags: [],
      createdAt: now - 2 * 86_400_000,
      updatedAt: now - 2 * 86_400_000,
    });
    await putNote({
      id: 'n1',
      patientId: 'p1',
      type: 'admission',
      bodyHebrew: '',
      structuredData: {},
      createdAt: now - 2 * 86_400_000,
      updatedAt: now - 2 * 86_400_000,
    });
    await putNote({
      id: 'n2',
      patientId: 'p1',
      type: 'soap',
      bodyHebrew: '',
      structuredData: {},
      createdAt: now - 3600_000,
      updatedAt: now - 3600_000,
    });
    render(
      <MemoryRouter>
        <PriorNotesBanner tz="111111111" />
      </MemoryRouter>,
    );
    await flushEffects();
    expect(screen.getByText('2 רישומים קודמים')).toBeInTheDocument();
  });

  it('renders nothing when tz not in IDB', async () => {
    render(
      <MemoryRouter>
        <PriorNotesBanner tz="999999999" />
      </MemoryRouter>,
    );
    await flushEffects();
    expect(screen.queryByText(/רישומים קודמים/)).not.toBeInTheDocument();
  });
});

describe('NoteViewer — mark-on-copy', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('copy button marks the note as sent (persists sentToEmrAt to IDB)', async () => {
    await putPatient({
      id: 'p-copy',
      name: 'שרה כהן',
      teudatZehut: '222222222',
      dob: '1950-05-05',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await putNote({
      id: 'n-copy',
      patientId: 'p-copy',
      type: 'soap',
      bodyHebrew: 'S: כאב ראש\nO: ...\nA: ...\nP: ...',
      structuredData: {},
      createdAt: 2,
      updatedAt: 2,
      sentToEmrAt: null,
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <MemoryRouter initialEntries={['/note/n-copy']}>
        <Routes>
          <Route path="/note/:id" element={<NoteViewer />} />
        </Routes>
      </MemoryRouter>,
    );
    await flushEffects();
    // Pre-copy: the unsent hint is visible.
    expect(screen.getByText(/עדיין לא נשלח/)).toBeInTheDocument();

    const copyBtn = screen.getByRole('button', { name: /העתק לצ׳מיליון/ });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    await flushEffects();

    expect(writeText).toHaveBeenCalledTimes(1);
    // Status line flipped to "✓ הועתק לצ׳מיליון · ..."
    expect(screen.getByText(/✓ הועתק לצ׳מיליון · /)).toBeInTheDocument();
    // And persisted to IDB.
    const after = await getNote('n-copy');
    expect(typeof after?.sentToEmrAt).toBe('number');
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
