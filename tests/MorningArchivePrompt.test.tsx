import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MorningArchivePrompt } from '@/ui/components/MorningArchivePrompt';
import { putDaySnapshot } from '@/storage/rounds';

const LAST_KEY = 'ward-helper.lastArchivedDate';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('MorningArchivePrompt', () => {
  it('does not render when lastArchivedDate is today', () => {
    const today = new Date().toLocaleDateString('en-CA');
    localStorage.setItem(LAST_KEY, today);
    render(<MorningArchivePrompt />);
    expect(screen.queryByText(/יום חדש/)).toBeNull();
  });

  it('renders when lastArchivedDate is yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    localStorage.setItem(LAST_KEY, yesterday);
    render(<MorningArchivePrompt />);
    expect(screen.getByText(/יום חדש/)).toBeTruthy();
  });

  it('does not re-render after dismissal in same session', () => {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    localStorage.setItem(LAST_KEY, yesterday);
    const { unmount } = render(<MorningArchivePrompt />);
    fireEvent.click(screen.getByText('דחה'));
    unmount();

    render(<MorningArchivePrompt />);
    expect(screen.queryByText(/יום חדש/)).toBeNull();
  });

  it('does not render on first launch (no lastArchivedDate)', () => {
    render(<MorningArchivePrompt />);
    expect(screen.queryByText(/יום חדש/)).toBeNull();
  });

  it('shows confirm-replace banner when today already archived', async () => {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    const today = new Date().toLocaleDateString('en-CA');
    localStorage.setItem(LAST_KEY, yesterday);
    await putDaySnapshot({
      id: today,
      date: today,
      archivedAt: Date.now() - 60000,
      patients: [],
    });
    render(<MorningArchivePrompt />);
    fireEvent.click(screen.getByText('ארכב'));
    // Wait for async listDaySnapshots + setState
    expect(await screen.findByText(/לארכב שוב/)).toBeTruthy();
  });
});
