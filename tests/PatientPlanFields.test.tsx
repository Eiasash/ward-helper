import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { putPatient, getPatient, resetDbForTests, type Patient } from '@/storage/indexed';
import { PatientPlanFields } from '@/ui/components/PatientPlanFields';

beforeEach(async () => { await resetDbForTests(); });

function p(): Patient {
  return {
    id: 'p1', name: 'X', teudatZehut: '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: '',
    planLongTerm: 'continue ASA', planToday: '', clinicalMeta: {},
  };
}

describe('PatientPlanFields', () => {
  it('shows existing planLongTerm + planToday', async () => {
    await putPatient(p());
    render(<PatientPlanFields patientId="p1" />);
    await waitFor(() => expect(screen.getByDisplayValue('continue ASA')).toBeTruthy());
  });

  it('saves edits to the patient record on blur', async () => {
    await putPatient(p());
    render(<PatientPlanFields patientId="p1" />);
    const longInput = await screen.findByLabelText(/תכנית ארוכת-טווח/);
    fireEvent.change(longInput, { target: { value: 'updated long-term' } });
    fireEvent.blur(longInput);
    await waitFor(async () => {
      const back = await getPatient('p1');
      expect(back?.planLongTerm).toBe('updated long-term');
    });
  });
});
