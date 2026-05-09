/**
 * Integration test for Task 3.6 — re-admit banner on TZ collision.
 *
 * The wiring lives in Review.tsx (NOT Capture.tsx — Capture only collects
 * blocks; the extract turn that surfaces the TZ runs on Review). This test
 * mocks runExtractTurn to return a known TZ that matches a seeded discharged
 * patient in IDB, then asserts:
 *   1. ReadmitBanner appears (with patient name + gap days)
 *   2. Clicking "כן, חזרה לאשפוז" flips the patient row back to discharged=false
 *
 * Mocking strategy mirrors uiSmoke.test.tsx — agent/loop + skills/loader are
 * stubbed so Review's mount effect resolves without network. The image block
 * is a tiny base64 PNG so Review's "אין קלט לעיבוד" guard doesn't fire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

vi.mock('@/agent/loop', () => ({
  runExtractTurn: vi.fn(async () => ({
    fields: { name: 'דוגמה כהן', teudatZehut: '000000018', age: 86 },
    confidence: { name: 'high', teudatZehut: 'high', age: 'high' },
  })),
  runEmitTurn: vi.fn(async () => ({ text: '' })),
}));
vi.mock('@/skills/loader', () => ({
  loadSkills: vi.fn(async () => ({})),
}));

import { Review } from '@/ui/screens/Review';
import { putPatient, getPatient, resetDbForTests, type Patient } from '@/storage/indexed';
import { dischargePatient } from '@/storage/rounds';
import { addImageBlock, clearBlocks } from '@/camera/session';

// 1×1 transparent PNG — addImageBlock decodes the base64; happy-dom has atob.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function newDischargedP(): Patient {
  // teudatZehut matches the mocked extract output above.
  return {
    id: 'p1',
    name: 'דוגמה כהן',
    teudatZehut: '000000018',
    dob: '1940-01-01',
    room: '5A',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    discharged: false,
    tomorrowNotes: [],
    handoverNote: 'baseline note',
    planLongTerm: '',
    planToday: '',
    clinicalMeta: {},
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
  // Seed one capture block so Review's mount effect doesn't bail with
  // "אין קלט לעיבוד".
  addImageBlock(TINY_PNG, 'gallery');
});

afterEach(async () => {
  await flush();
  cleanup();
  clearBlocks();
  vi.clearAllMocks();
});

describe('Review — re-admit banner on discharged-TZ collision', () => {
  it('surfaces ReadmitBanner when extracted TZ matches a discharged patient', async () => {
    // Seed a discharged patient with a recent dischargedAt so detectReadmit
    // returns isReadmit=true with a positive gapDays.
    await putPatient(newDischargedP());
    await dischargePatient('p1');

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>,
    );

    // Wait for the mocked runExtractTurn promise to resolve and FieldRow
    // to render the name — proves the TZ has reached `fields` state and
    // therefore the readmit-lookup effect has fired at least once.
    await waitFor(() => {
      expect(screen.getByDisplayValue('דוגמה כהן')).toBeTruthy();
    });
    await flush();

    // Now the readmit lookup must have completed and the banner rendered.
    await waitFor(() => {
      expect(screen.getByText('כן, חזרה לאשפוז')).toBeTruthy();
    });

    // Click accept — un-discharge runs.
    await act(async () => {
      fireEvent.click(screen.getByText('כן, חזרה לאשפוז'));
    });
    await flush();

    // Patient is now active again.
    const back = await getPatient('p1');
    expect(back?.discharged).toBe(false);
    expect(back?.dischargedAt).toBeUndefined();
    // unDischargePatient appends a re-admit line to the handover note.
    expect(back?.handoverNote).toContain('חזר לאשפוז');
    expect(back?.handoverNote).toContain('re-admission via capture');

    // Banner is dismissed after accept.
    await waitFor(() => {
      expect(screen.queryByText(/חזרה לאשפוז\?/)).toBeNull();
    });
  });

  it('does not show ReadmitBanner when TZ matches a still-active patient', async () => {
    // Same TZ, but discharged=false — banner must NOT render.
    await putPatient(newDischargedP());

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>,
    );

    // Wait for the extract to resolve; PriorNotesBanner-style selector
    // ensures the FieldRow has been rendered (which means the TZ effect
    // has had a chance to run on at least one TZ value).
    await waitFor(() => {
      expect(screen.getByDisplayValue('דוגמה כהן')).toBeTruthy();
    });
    await flush();

    // No re-admit banner.
    expect(screen.queryByText(/חזרה לאשפוז\?/)).toBeNull();
  });
});
