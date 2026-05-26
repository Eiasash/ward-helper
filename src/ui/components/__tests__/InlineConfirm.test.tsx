/**
 * InlineConfirm — verifies the open/closed, confirm, cancel, and Esc
 * behaviors. Keeps the contract locked so future refactors don't
 * silently regress the Android-PWA-confirm replacement.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InlineConfirm } from '@/ui/components/InlineConfirm';

afterEach(cleanup);

describe('InlineConfirm', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <InlineConfirm
        open={false}
        message="hi"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with message when open=true', () => {
    render(
      <InlineConfirm
        open
        message="למחוק את the femur exemplarומה הזאת?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('למחוק את the femur exemplarומה הזאת?')).toBeTruthy();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <InlineConfirm
        open
        message="ok?"
        confirmLabel="כן"
        cancelLabel="לא"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('כן'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <InlineConfirm
        open
        message="ok?"
        confirmLabel="כן"
        cancelLabel="לא"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('לא'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn();
    render(
      <InlineConfirm
        open
        message="ok?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(
      <InlineConfirm
        open
        message="ok?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onCancel when card content is clicked (stopPropagation)', () => {
    const onCancel = vi.fn();
    render(
      <InlineConfirm
        open
        message="card content here"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    // The message <p> is inside the inner card; click should not bubble.
    fireEvent.click(screen.getByText('card content here'));
    expect(onCancel).toHaveBeenCalledTimes(0);
  });

  it('does not call onConfirm if user did not interact', () => {
    const onConfirm = vi.fn();
    render(
      <InlineConfirm
        open
        message="ok?"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(onConfirm).toHaveBeenCalledTimes(0);
  });

  it('danger variant renders without crashing (visual contract sanity)', () => {
    render(
      <InlineConfirm
        open
        message="delete?"
        variant="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
