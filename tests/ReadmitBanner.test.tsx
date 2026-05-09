import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadmitBanner } from '@/ui/components/ReadmitBanner';

describe('ReadmitBanner', () => {
  it('shows the gap days + name', () => {
    render(<ReadmitBanner name="כהן שרה" gapDays={5} onAccept={() => {}} onDecline={() => {}} />);
    expect(screen.getByText(/כהן שרה/)).toBeTruthy();
    expect(screen.getByText(/5/)).toBeTruthy();
  });

  it('calls onAccept when accept button clicked', () => {
    const onAccept = vi.fn();
    render(<ReadmitBanner name="X" gapDays={1} onAccept={onAccept} onDecline={() => {}} />);
    fireEvent.click(screen.getByText('כן, חזרה לאשפוז'));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('calls onDecline when decline button clicked', () => {
    const onDecline = vi.fn();
    render(<ReadmitBanner name="X" gapDays={1} onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.click(screen.getByText('לא, חולה חדש'));
    expect(onDecline).toHaveBeenCalledOnce();
  });
});
