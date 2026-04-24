/**
 * Regression: NoteViewer used to call setNote / setPatient after unmount if
 * the user navigated away mid-load. React 18 surfaces this as a console.error
 * "update on unmounted component" — we mount, unmount before the async load
 * resolves, then assert no unmounted-component errors were logged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import 'fake-indexeddb/auto';

vi.mock('@/storage/cloud', () => ({
  encryptForCloud: vi.fn(),
  pushBlob: vi.fn(),
  pullBlobs: vi.fn(async () => []),
}));

import { NoteViewer } from '@/ui/screens/NoteViewer';
import { putPatient, putNote, resetDbForTests } from '@/storage/indexed';

async function flushEffects() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

describe('NoteViewer — cancellation on unmount', () => {
  beforeEach(async () => {
    await resetDbForTests();
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(async () => {
    await flushEffects();
    cleanup();
    vi.clearAllMocks();
  });

  it('does not set state after the component unmounts', async () => {
    await putPatient({
      id: 'p-cancel',
      name: 'x',
      teudatZehut: '111111112',
      dob: '1950-01-01',
      room: null,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await putNote({
      id: 'n-cancel',
      patientId: 'p-cancel',
      type: 'soap',
      bodyHebrew: 'body',
      structuredData: {},
      createdAt: 2,
      updatedAt: 2,
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(
      <MemoryRouter initialEntries={['/note/n-cancel']}>
        <Routes>
          <Route path="/note/:id" element={<NoteViewer />} />
        </Routes>
      </MemoryRouter>,
    );

    unmount();
    await flushEffects();

    const actWarnings = errSpy.mock.calls.filter((args) =>
      String(args[0]).includes('unmounted'),
    );
    expect(actWarnings).toEqual([]);
    errSpy.mockRestore();
  });
});
