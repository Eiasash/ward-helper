/**
 * Tests for PostLoginRestorePrompt:
 *   1. shouldPromptRestore is the gating heuristic — pin it.
 *   2. The component does NOT render when there's no auth event.
 *   3. The component renders on a 'login' action when state qualifies, and
 *      suppresses on subsequent logins after dismissal.
 *   4. The component IGNORES 'register' (no cloud data exists yet).
 *
 * Mocks restoreFromCloud to keep the test pure (no Supabase).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@/notes/save', () => ({
  restoreFromCloud: vi.fn(async () => ({
    scanned: 0,
    restoredPatients: 0,
    restoredNotes: 0,
    skipped: [],
    source: 'username' as const,
  })),
}));

import {
  PostLoginRestorePrompt,
  shouldPromptRestore,
  _suppressKey,
} from '@/ui/components/PostLoginRestorePrompt';
import { setAuthSession, logout } from '@/auth/auth';
import { putPatient, putNote, resetDbForTests } from '@/storage/indexed';

beforeEach(async () => {
  localStorage.clear();
  await resetDbForTests();
});
afterEach(() => cleanup());

describe('shouldPromptRestore — gating heuristic', () => {
  it('returns true on zero-state IDB + no prior marker', async () => {
    expect(await shouldPromptRestore('eias')).toBe(true);
  });

  it('returns false when a suppress marker exists for this user', async () => {
    localStorage.setItem(_suppressKey('eias'), String(Date.now()));
    expect(await shouldPromptRestore('eias')).toBe(false);
    // Other users still eligible.
    expect(await shouldPromptRestore('other')).toBe(true);
  });

  it('returns false when IDB has any patient', async () => {
    await putPatient({
      id: 'p1',
      name: 'Test',
      teudatZehut: '111111118',
      dob: '1950-01-01',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await shouldPromptRestore('eias')).toBe(false);
  });

  it('returns false when IDB has any note', async () => {
    await putPatient({
      id: 'p1',
      name: 'Test',
      teudatZehut: '111111118',
      dob: '1950-01-01',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await putNote({
      id: 'n1',
      patientId: 'p1',
      type: 'admission',
      bodyHebrew: 'x',
      structuredData: {},
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await shouldPromptRestore('eias')).toBe(false);
  });

  it('returns false on empty username', async () => {
    expect(await shouldPromptRestore('')).toBe(false);
  });
});

describe('PostLoginRestorePrompt — render gating', () => {
  it('renders nothing on initial mount (no auth event yet)', () => {
    render(<PostLoginRestorePrompt />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog on login action when state qualifies', async () => {
    render(<PostLoginRestorePrompt />);
    await act(async () => {
      setAuthSession('eias', null, 'login');
      // give the async handler chain (subscribe → getDbStats) time to settle
      await new Promise((r) => setTimeout(r, 0));
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/eias/)).toBeInTheDocument();
  });

  it('does NOT render on register action (no cloud data exists yet)', async () => {
    render(<PostLoginRestorePrompt />);
    await act(async () => {
      setAuthSession('eias', null, 'register');
      await new Promise((r) => setTimeout(r, 0));
    });
    // Allow the handler to drain
    await new Promise((r) => setTimeout(r, 5));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('suppresses re-prompt after the marker is set', async () => {
    localStorage.setItem(_suppressKey('eias'), String(Date.now()));
    render(<PostLoginRestorePrompt />);
    await act(async () => {
      setAuthSession('eias', null, 'login');
      await new Promise((r) => setTimeout(r, 0));
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT render on logout action', async () => {
    render(<PostLoginRestorePrompt />);
    await act(async () => {
      logout();
      await new Promise((r) => setTimeout(r, 0));
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
