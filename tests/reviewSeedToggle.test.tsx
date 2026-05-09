/**
 * v1.41.0 — Review screen integration test for the runtime
 * "השתמש בהערת אתמול" toggle button.
 *
 * Asserts the user-visible contract:
 *   1. The button does NOT render when `decideSeed` returns `no-prefill`
 *      (no prior SOAP for the patient).
 *   2. The button DOES render when continuity has a mostRecentSoap AND the
 *      patient is active (decideSeed returns prefill).
 *   3. Clicking the button toggles its label between "השתמש בהערת אתמול"
 *      and "אל תשתמש בהערת אתמול".
 *   4. Proceeding with the toggle ON writes the `seedFromYesterday=1`
 *      sessionStorage flag that NoteEditor consumes to call `decideSeed`
 *      and pass the SeedDecision to `generateNote`.
 *   5. Proceeding with the toggle OFF leaves the flag absent (no-op).
 *
 * Mocking strategy mirrors captureReadmit.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  cleanup,
  act,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

vi.mock('@/agent/loop', () => ({
  runExtractTurn: vi.fn(async () => ({
    // chiefComplaint included so the SOAP-only "missing clinical content"
    // gate (Review.tsx hasClinicalContent) does NOT swap the bare Proceed
    // button for the retake/skip-with-reason gate. The toggle button this
    // test exercises lives alongside the bare Proceed button — exercising
    // the gate path is captureReadmit.test.tsx's territory.
    fields: {
      name: 'אסתר לוי',
      teudatZehut: '000000018',
      age: 78,
      room: '6B',
      chiefComplaint: 'מעקב יומי לאחר LCx PCI',
    },
    confidence: { name: 'high', teudatZehut: 'high', age: 'high' },
  })),
  runEmitTurn: vi.fn(async () => ({ text: '' })),
}));
vi.mock('@/skills/loader', () => ({
  loadSkills: vi.fn(async () => ({})),
}));

import { Review } from '@/ui/screens/Review';
import {
  putPatient,
  putNote,
  resetDbForTests,
  type Patient,
  type Note,
} from '@/storage/indexed';
import { addImageBlock, clearBlocks } from '@/camera/session';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function newPatient(): Patient {
  return {
    id: 'p1',
    name: 'אסתר לוי',
    teudatZehut: '000000018',
    dob: '1948-03-12',
    room: '6B',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    discharged: false,
    tomorrowNotes: [],
    handoverNote: 'מטופלת לאחר LCx PCI; מתחת השגחה תזונתית',
    planLongTerm: 'המשך אספירין + סטטין; לא להוסיף NSAID',
    planToday: '',
    clinicalMeta: { pmhSummary: 'CAD, HFpEF, CKD-3' },
  };
}

function yesterdaySoap(): Note {
  return {
    id: 's1',
    patientId: 'p1',
    type: 'soap',
    bodyHebrew: 'גוף ה-SOAP של אתמול',
    structuredData: { name: 'אסתר לוי', teudatZehut: '000000018' },
    createdAt: Date.now() - 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 24 * 60 * 60 * 1000,
  };
}

function admission(): Note {
  return {
    id: 'a1',
    patientId: 'p1',
    type: 'admission',
    bodyHebrew: 'גוף הקבלה',
    structuredData: { name: 'אסתר לוי', teudatZehut: '000000018' },
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
  };
}

async function flush() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  await resetDbForTests();
  sessionStorage.clear();
  clearBlocks();
  // Mark the session as a SOAP so the Review screen's SOAP-only branches
  // (continuity banner + seed toggle) render.
  sessionStorage.setItem('noteType', 'soap');
  addImageBlock(TINY_PNG, 'gallery');
});

afterEach(async () => {
  await flush();
  cleanup();
  clearBlocks();
  vi.clearAllMocks();
});

describe('Review — runtime "השתמש בהערת אתמול" toggle (v1.41.0)', () => {
  it('does not render the toggle when no prior SOAP exists for the patient', async () => {
    // Patient exists but no SOAP history → decideSeed returns no-prefill.
    await putPatient(newPatient());

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue('אסתר לוי')).toBeTruthy();
    });
    await flush();

    expect(screen.queryByText('השתמש בהערת אתמול')).toBeNull();
  });

  it('renders the toggle when continuity has a mostRecentSoap (prefill seed available)', async () => {
    await putPatient(newPatient());
    await putNote(admission());
    await putNote(yesterdaySoap());

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue('אסתר לוי')).toBeTruthy();
    });
    await flush();

    await waitFor(() => {
      expect(screen.getByText('השתמש בהערת אתמול')).toBeTruthy();
    });
  });

  it('toggles its label when clicked', async () => {
    await putPatient(newPatient());
    await putNote(admission());
    await putNote(yesterdaySoap());

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue('אסתר לוי')).toBeTruthy();
    });
    await flush();

    await waitFor(() => {
      expect(screen.getByText('השתמש בהערת אתמול')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('השתמש בהערת אתמול'));
    });
    expect(screen.getByText('אל תשתמש בהערת אתמול')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('אל תשתמש בהערת אתמול'));
    });
    expect(screen.getByText('השתמש בהערת אתמול')).toBeTruthy();
  });

  it('Proceed with toggle ON writes seedFromYesterday=1 to sessionStorage', async () => {
    await putPatient(newPatient());
    await putNote(admission());
    await putNote(yesterdaySoap());

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue('אסתר לוי')).toBeTruthy();
    });
    await flush();

    // Turn toggle on.
    await waitFor(() => {
      expect(screen.getByText('השתמש בהערת אתמול')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('השתמש בהערת אתמול'));
    });

    // Click the Proceed button (its Hebrew label is "צור טיוטת רשימה ←").
    await act(async () => {
      fireEvent.click(screen.getByText(/צור טיוטת רשימה/));
    });
    await flush();

    expect(sessionStorage.getItem('seedFromYesterday')).toBe('1');
    // Belt-and-braces: continuityTeudatZehut should also be set since the
    // seed flow requires continuity to be enabled to write the flag.
    expect(sessionStorage.getItem('continuityTeudatZehut')).toBe('000000018');
  });

  it('Proceed with toggle OFF (default) leaves seedFromYesterday absent', async () => {
    await putPatient(newPatient());
    await putNote(admission());
    await putNote(yesterdaySoap());

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue('אסתר לוי')).toBeTruthy();
    });
    await flush();

    // Toggle deliberately NOT clicked.
    await waitFor(() => {
      expect(screen.getByText('השתמש בהערת אתמול')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/צור טיוטת רשימה/));
    });
    await flush();

    expect(sessionStorage.getItem('seedFromYesterday')).toBeNull();
  });
});
