/**
 * Today screen — verify the three lanes populate correctly from IDB +
 * sessionStorage state. Covers:
 *   - empty state ("אין משימות פתוחות")
 *   - drafts lane (sessionStorage.body + sessionStorage.noteType)
 *   - notes-today lane (createdAt within 24h, grouped per patient, unsent badge)
 *   - SOAPs-owed lane (admission within 30d, no SOAP/admission within 18h)
 *   - mark-as-sent flow flips IDB sentToEmrAt and re-renders without the badge
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

import { Today } from '@/ui/screens/Today';
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

beforeEach(async () => {
  sessionStorage.clear();
  await resetDbForTests();
});

afterEach(async () => {
  await flushEffects();
  cleanup();
});

function renderToday() {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <Today />
    </MemoryRouter>,
  );
}

describe('Today — empty state', () => {
  it('shows "אין משימות פתוחות" when nothing in IDB or sessionStorage', async () => {
    renderToday();
    await flushEffects();
    expect(screen.getByText('אין משימות פתוחות')).toBeInTheDocument();
  });
});

describe('Today — drafts lane', () => {
  it('renders draft entry when sessionStorage holds body + noteType', async () => {
    sessionStorage.setItem('body', 'הערה בעבודה');
    sessionStorage.setItem('noteType', 'admission');
    renderToday();
    await flushEffects();
    expect(screen.getByText('טיוטה פתוחה')).toBeInTheDocument();
    expect(screen.getByText(/טיוטה ב-קבלה/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'המשך' })).toBeInTheDocument();
  });
});

describe('Today — notes generated today lane', () => {
  it('groups by patient and shows unsent badge for not-yet-sent notes', async () => {
    const now = Date.now();
    await putPatient({
      id: 'p-today',
      name: 'דוד לוי',
      teudatZehut: '111111111',
      dob: '1960-01-01',
      room: '12',
      tags: [],
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });
    await putNote({
      id: 'n-unsent',
      patientId: 'p-today',
      type: 'soap',
      bodyHebrew: 'S: ...',
      structuredData: {},
      createdAt: now - 30 * 60 * 1000,
      updatedAt: now - 30 * 60 * 1000,
      sentToEmrAt: null,
    });
    await putNote({
      id: 'n-sent',
      patientId: 'p-today',
      type: 'soap',
      bodyHebrew: 'O: ...',
      structuredData: {},
      createdAt: now - 60 * 60 * 1000,
      updatedAt: now - 60 * 60 * 1000,
      sentToEmrAt: now - 60 * 60 * 1000,
    });

    renderToday();
    await flushEffects();

    expect(screen.getByText('הערות שנוצרו היום')).toBeInTheDocument();
    expect(screen.getByText('דוד לוי')).toBeInTheDocument();
    expect(screen.getByText(/לא נשלח לצ׳מיליון \(1\)/)).toBeInTheDocument();
  });

  it('omits notes older than 24h', async () => {
    const now = Date.now();
    await putPatient({
      id: 'p-old',
      name: 'יוסי כהן',
      teudatZehut: '222222222',
      dob: '1955-05-05',
      room: null,
      tags: [],
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });
    await putNote({
      id: 'n-old',
      patientId: 'p-old',
      type: 'soap',
      bodyHebrew: 'old',
      structuredData: {},
      createdAt: now - 48 * 60 * 60 * 1000,
      updatedAt: now - 48 * 60 * 60 * 1000,
    });

    renderToday();
    await flushEffects();

    expect(screen.getByText('אין משימות פתוחות')).toBeInTheDocument();
    expect(screen.queryByText('יוסי כהן')).not.toBeInTheDocument();
  });

  it('mark-as-sent button flips sentToEmrAt in IDB and re-renders without the badge', async () => {
    const now = Date.now();
    await putPatient({
      id: 'p-mark',
      name: 'שרה לוי',
      teudatZehut: '333333333',
      dob: '1950-01-01',
      room: null,
      tags: [],
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });
    await putNote({
      id: 'n-mark',
      patientId: 'p-mark',
      type: 'soap',
      bodyHebrew: 'b',
      structuredData: {},
      createdAt: now - 60 * 60 * 1000,
      updatedAt: now - 60 * 60 * 1000,
      sentToEmrAt: null,
    });

    renderToday();
    await flushEffects();

    expect(screen.getByText(/לא נשלח/)).toBeInTheDocument();
    const markBtn = screen.getByRole('button', { name: 'סומן כנשלח' });
    await act(async () => {
      fireEvent.click(markBtn);
    });
    // markNoteSent + setTick + tick-triggered useEffect IDB re-fetch is a
    // multi-step async chain. Fixed flushEffects() pairs flaked under slower
    // CI runners — waitFor polls until the badge actually clears.
    await waitFor(() => {
      expect(screen.queryByText(/לא נשלח/)).not.toBeInTheDocument();
    });
    const after = await getNote('n-mark');
    expect(typeof after?.sentToEmrAt).toBe('number');
  });
});

describe('Today — SOAPs-owed lane', () => {
  it('lists patients with admission within 30d and no SOAP/admission in last 18h', async () => {
    const now = Date.now();
    await putPatient({
      id: 'p-owed',
      name: 'מרים גולן',
      teudatZehut: '444444444',
      dob: '1940-01-01',
      room: '8',
      tags: [],
      createdAt: now - 5 * 24 * 60 * 60 * 1000,
      updatedAt: now - 5 * 24 * 60 * 60 * 1000,
    });
    await putNote({
      id: 'n-adm',
      patientId: 'p-owed',
      type: 'admission',
      bodyHebrew: 'admission body',
      structuredData: {},
      createdAt: now - 5 * 24 * 60 * 60 * 1000,
      updatedAt: now - 5 * 24 * 60 * 60 * 1000,
    });

    renderToday();
    await flushEffects();

    expect(screen.getByText('חייב SOAP היום')).toBeInTheDocument();
    expect(screen.getByText('מרים גולן')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ SOAP' })).toBeInTheDocument();
  });

  it('does NOT list a patient who already has a SOAP in the last 18h', async () => {
    const now = Date.now();
    await putPatient({
      id: 'p-fresh',
      name: 'אבי ישראלי',
      teudatZehut: '555555555',
      dob: '1945-05-05',
      room: null,
      tags: [],
      createdAt: now - 5 * 24 * 60 * 60 * 1000,
      updatedAt: now - 5 * 24 * 60 * 60 * 1000,
    });
    await putNote({
      id: 'n-adm-fresh',
      patientId: 'p-fresh',
      type: 'admission',
      bodyHebrew: 'a',
      structuredData: {},
      createdAt: now - 5 * 24 * 60 * 60 * 1000,
      updatedAt: now - 5 * 24 * 60 * 60 * 1000,
    });
    await putNote({
      id: 'n-soap-fresh',
      patientId: 'p-fresh',
      type: 'soap',
      bodyHebrew: 's',
      structuredData: {},
      createdAt: now - 60 * 60 * 1000,
      updatedAt: now - 60 * 60 * 1000,
    });

    renderToday();
    await flushEffects();

    expect(screen.queryByText('חייב SOAP היום')).not.toBeInTheDocument();
  });

  it('does NOT list a patient whose admission is older than 30d', async () => {
    const now = Date.now();
    await putPatient({
      id: 'p-stale',
      name: 'רחל בן',
      teudatZehut: '666666666',
      dob: '1948-08-08',
      room: null,
      tags: [],
      createdAt: now - 60 * 24 * 60 * 60 * 1000,
      updatedAt: now - 60 * 24 * 60 * 60 * 1000,
    });
    await putNote({
      id: 'n-stale-adm',
      patientId: 'p-stale',
      type: 'admission',
      bodyHebrew: 'a',
      structuredData: {},
      createdAt: now - 60 * 24 * 60 * 60 * 1000,
      updatedAt: now - 60 * 24 * 60 * 60 * 1000,
    });

    renderToday();
    await flushEffects();

    expect(screen.queryByText('חייב SOAP היום')).not.toBeInTheDocument();
    expect(screen.getByText('אין משימות פתוחות')).toBeInTheDocument();
  });
});
