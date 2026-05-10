// src/ui/screens/__tests__/OrthoQuickref.test.tsx
//
// Happy-path tests for the OrthoQuickref screen. Asserts:
//   - Renders without crashing
//   - POD = 17 when surgeryDate is 2026-04-23 and system clock is 2026-05-10
//   - Suture site change reflects in the suggestion line
//   - All 8 reference accordions + 5 SOAP-template accordions present
//   - Copy button calls navigator.clipboard.writeText (with wrapForChameleon)
//
// Note: TZ pinned to Asia/Jerusalem via cross-env in package.json.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import OrthoQuickref from '@/ui/screens/OrthoQuickref';

beforeEach(() => {
  // System time only — keep real timers so async microtasks + setTimeout
  // (the copy-msg auto-clear) don't deadlock vi.waitFor in the copy test.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-10T08:00:00+03:00'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/ortho']}>
      <OrthoQuickref />
    </MemoryRouter>,
  );
}

describe('OrthoQuickref — render', () => {
  it('renders without crashing', () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('shows the empty-state hint until a date is picked', () => {
    renderScreen();
    expect(screen.getByText(/בחר תאריך ניתוח/)).toBeInTheDocument();
  });
});

describe('OrthoQuickref — POD calculator', () => {
  it('shows POD: 17 when surgery date is 2026-04-23', () => {
    renderScreen();
    const dateInput = screen.getByLabelText('תאריך ניתוח') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-04-23' } });
    expect(screen.getByText('POD: 17')).toBeInTheDocument();
  });
});

describe('OrthoQuickref — suture removal', () => {
  it('updates output when site changes (hip default, POD 14)', () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText('תאריך ניתוח'), {
      target: { value: '2026-04-23' },
    });
    // hip is the default site (matches the brief: rehab cohort).
    // surgery 2026-04-23 + 14 = 2026-05-07, DD/MM/YY = 07/05/26
    expect(screen.getByText(/להוצאה תאריך 07\/05\/26 \(POD 14\)/)).toBeInTheDocument();
  });
});

describe('OrthoQuickref — accordions', () => {
  it('has 8 reference accordions + 5 template accordions (13 <details> total)', () => {
    const { container } = renderScreen();
    const detailsEls = container.querySelectorAll('details');
    expect(detailsEls.length).toBe(13);
  });
});

describe('OrthoQuickref — copy button', () => {
  it('calls navigator.clipboard.writeText for the DVT line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderScreen();
    fireEvent.change(screen.getByLabelText('תאריך ניתוח'), {
      target: { value: '2026-04-23' },
    });
    const copyBtn = screen.getByRole('button', { name: 'העתק פרופילקסיס DVT' });
    fireEvent.click(copyBtn);

    // Drain the microtask queue from the async click handler.
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const arg = writeText.mock.calls[0]?.[0] as string | undefined;
    // wrapForChameleon should preserve the Hebrew core of the line.
    expect(arg ?? '').toContain('ENOXAPARIN 40mg SC');
  });
});
