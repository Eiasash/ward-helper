import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock runBatchSoap so the running phase doesn't actually fire any
// network calls — these are smoke tests for the collecting-phase UX,
// not the driver itself (driver has its own dedicated test file).
const { runBatchSoapSpy } = vi.hoisted(() => ({
  runBatchSoapSpy: vi.fn(),
}));
vi.mock('@/notes/batchSoap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, runBatchSoap: runBatchSoapSpy };
});

// Mock compressImage to be identity — we don't actually need
// JPEG compression to test the UI flow.
vi.mock('@/camera/compress', () => ({
  compressImage: vi.fn(async (s: string) => s),
}));

import { BatchFlow } from '@/ui/components/BatchFlow';
import type { RosterPatient } from '@/storage/roster';

function makeRoster(name: string, room = '12'): RosterPatient {
  return {
    id: crypto.randomUUID(),
    tz: '123456789',
    name,
    age: 80,
    sex: 'M',
    room,
    bed: 'A',
    losDays: 3,
    dxShort: 'CHF',
    sourceMode: 'manual',
    importedAt: Date.now(),
  };
}

describe('BatchFlow — collecting phase', () => {
  beforeEach(() => {
    runBatchSoapSpy.mockReset();
  });

  function renderFlow(patients: RosterPatient[]) {
    return render(
      <MemoryRouter>
        <BatchFlow patients={patients} onClose={vi.fn()} />
      </MemoryRouter>,
    );
  }

  it('shows "1 מתוך N" with the first patient name', () => {
    renderFlow([makeRoster('רוזנברג מרים'), makeRoster('לוי דוד')]);
    expect(screen.getByText(/איסוף תמונות — 1 מתוך 2/)).toBeInTheDocument();
    expect(screen.getByText('רוזנברג מרים')).toBeInTheDocument();
  });

  it('advances to next patient on "חולה הבא"', () => {
    renderFlow([makeRoster('רוזנברג מרים'), makeRoster('לוי דוד')]);
    fireEvent.click(screen.getByRole('button', { name: /חולה הבא/ }));
    expect(screen.getByText(/איסוף תמונות — 2 מתוך 2/)).toBeInTheDocument();
    expect(screen.getByText('לוי דוד')).toBeInTheDocument();
  });

  it('back button moves to the previous patient', () => {
    renderFlow([makeRoster('רוזנברג מרים'), makeRoster('לוי דוד')]);
    fireEvent.click(screen.getByRole('button', { name: /חולה הבא/ }));
    expect(screen.getByText('לוי דוד')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /חולה קודם/ }));
    expect(screen.getByText('רוזנברג מרים')).toBeInTheDocument();
  });

  it('on the last patient, advance button reads "צור SOAP לכולם (N)"', () => {
    renderFlow([makeRoster('A'), makeRoster('B'), makeRoster('C')]);
    // Advance through to the last patient.
    fireEvent.click(screen.getByRole('button', { name: /חולה הבא/ }));
    fireEvent.click(screen.getByRole('button', { name: /חולה הבא/ }));
    expect(
      screen.getByRole('button', { name: /צור SOAP לכולם \(3\)/ }),
    ).toBeInTheDocument();
  });

  it('back is disabled on the first patient', () => {
    renderFlow([makeRoster('A'), makeRoster('B')]);
    const back = screen.getByRole('button', { name: /חולה קודם/ });
    expect(back).toBeDisabled();
  });

  it('cancel button fires onClose without running the batch', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <BatchFlow patients={[makeRoster('A')]} onClose={onClose} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runBatchSoapSpy).not.toHaveBeenCalled();
  });

  it('renders patient demographics (room, bed, age, dxShort)', () => {
    renderFlow([
      {
        id: 'r1',
        tz: '123456789',
        name: 'רוזנברג מרים',
        age: 87,
        sex: 'F',
        room: '12',
        bed: 'A',
        losDays: 5,
        dxShort: 'Hip fracture',
        sourceMode: 'manual',
        importedAt: Date.now(),
      },
    ]);
    expect(screen.getByText(/חדר 12-A.*גיל 87.*Hip fracture/)).toBeInTheDocument();
  });

  it('shows the no-patient-card-needed reminder', () => {
    renderFlow([makeRoster('A')]);
    expect(screen.getByText(/אין צורך לצלם את כרטיס/)).toBeInTheDocument();
  });
});
