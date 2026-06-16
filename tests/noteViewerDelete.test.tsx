/**
 * NoteViewer.performDelete — cloud-cleanup wiring.
 *
 * Asserts the orphaned-PHI fix at the UI seam:
 *   1. performDelete runs the local IndexedDB delete FIRST (authoritative),
 *      then the best-effort cloud-delete, then navigates to /history.
 *   2. A cloud-delete failure does NOT block the local delete or navigation
 *      (best-effort contract).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import 'fake-indexeddb/auto';

const h = vi.hoisted(() => ({
  navSpy: vi.fn(),
  cloudDeleteSpy: vi.fn(),
}));

// Spy on navigation without mocking the rest of react-router.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => h.navSpy };
});

// Spy on the cloud-delete; the routing itself is unit-tested separately.
vi.mock('@/notes/cloudDelete', () => ({
  deleteNoteFromCloud: (...args: unknown[]) => h.cloudDeleteSpy(...args),
}));

import { NoteViewer } from '@/ui/screens/NoteViewer';
import {
  putPatient,
  putNote,
  getNote,
  resetDbForTests,
} from '@/storage/indexed';

async function flushEffects() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

async function seed() {
  await putPatient({
    id: 'p-del',
    name: 'x',
    teudatZehut: '111111112',
    dob: '1950-01-01',
    room: null,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  });
  await putNote({
    id: 'n-del',
    patientId: 'p-del',
    type: 'soap',
    bodyHebrew: 'body',
    structuredData: {},
    createdAt: 2,
    updatedAt: 2,
  });
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/note/n-del']}>
      <Routes>
        <Route path="/note/:id" element={<NoteViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickDeleteAndConfirm() {
  // First button opens the inline confirm; the confirm's "מחק" runs performDelete.
  fireEvent.click(screen.getByText('🗑 מחק'));
  await flushEffects();
  fireEvent.click(screen.getByText('מחק'));
  await flushEffects();
}

describe('NoteViewer — performDelete cloud cleanup', () => {
  beforeEach(async () => {
    await resetDbForTests();
    sessionStorage.clear();
    localStorage.clear();
    h.navSpy.mockReset();
    h.cloudDeleteSpy.mockReset();
    h.cloudDeleteSpy.mockImplementation(async () => 'deleted');
  });
  afterEach(async () => {
    await flushEffects();
    cleanup();
    vi.clearAllMocks();
  });

  it('deletes locally, calls the cloud-delete with the note id, then navigates', async () => {
    await seed();
    mount();
    await flushEffects();

    await clickDeleteAndConfirm();

    // Local IndexedDB delete happened.
    expect(await getNote('n-del')).toBeUndefined();
    // Cloud-delete was invoked for the same note id.
    expect(h.cloudDeleteSpy).toHaveBeenCalledTimes(1);
    expect(h.cloudDeleteSpy).toHaveBeenCalledWith('n-del');
    // Navigation away.
    expect(h.navSpy).toHaveBeenCalledWith('/history');
  });

  it('still deletes locally and navigates when the cloud-delete REJECTS', async () => {
    await seed();
    h.cloudDeleteSpy.mockImplementationOnce(async () => {
      throw new Error('cloud blew up');
    });
    mount();
    await flushEffects();

    // Should not throw out of the handler.
    await clickDeleteAndConfirm();

    expect(await getNote('n-del')).toBeUndefined();
    expect(h.navSpy).toHaveBeenCalledWith('/history');
  });
});
