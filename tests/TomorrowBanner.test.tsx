import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { putPatient, getPatient, resetDbForTests, type Patient } from '@/storage/indexed';
import { TomorrowBanner } from '@/ui/components/TomorrowBanner';

beforeEach(async () => { await resetDbForTests(); });

function fixture(): Patient {
  return {
    id: 'p1', name: 'X', teudatZehut: '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: ['call ortho', 'AM labs drawn'],
    handoverNote: '', planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

describe('TomorrowBanner', () => {
  it('renders nothing when patient has no tomorrowNotes', async () => {
    await putPatient({ ...fixture(), tomorrowNotes: [] });
    render(<TomorrowBanner patientId="p1" />);
    // Wait for the async refresh to complete and confirm no rendering
    await waitFor(() => expect(screen.queryByText(/call ortho/)).toBeNull());
  });

  it('renders each tomorrowNote line with dismiss + promote buttons', async () => {
    await putPatient(fixture());
    render(<TomorrowBanner patientId="p1" />);
    await waitFor(() => expect(screen.getByText('call ortho')).toBeTruthy());
    expect(screen.getByText('AM labs drawn')).toBeTruthy();
    expect(screen.getAllByText('דחה')).toHaveLength(2);
    expect(screen.getAllByText('הפוך לקבועה')).toHaveLength(2);
  });

  it('dismiss splices a single line', async () => {
    await putPatient(fixture());
    render(<TomorrowBanner patientId="p1" />);
    await screen.findByText('call ortho');
    const dismissButtons = screen.getAllByText('דחה');
    fireEvent.click(dismissButtons[0]!);  // dismiss "call ortho"
    await waitFor(async () => {
      const back = await getPatient('p1');
      expect(back?.tomorrowNotes).toEqual(['AM labs drawn']);
    });
  });

  it('promote moves the line to handoverNote', async () => {
    await putPatient(fixture());
    render(<TomorrowBanner patientId="p1" />);
    await screen.findByText('call ortho');
    const promoteButtons = screen.getAllByText('הפוך לקבועה');
    fireEvent.click(promoteButtons[1]!);  // promote "AM labs drawn"
    await waitFor(async () => {
      const back = await getPatient('p1');
      expect(back?.tomorrowNotes).toEqual(['call ortho']);
      expect(back?.handoverNote).toContain('AM labs drawn');
    });
  });
});
