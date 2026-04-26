import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FieldRow } from '@/ui/components/FieldRow';

afterEach(() => cleanup());

/**
 * onConfirmChange is the v1.21.3 wire-up between FieldRow's local confirmation
 * state and the parent (Review.tsx) that gates the Proceed button. These tests
 * pin the callback contract: when does it fire, with what value, and is it
 * stable across re-renders.
 *
 * The integration-level test — "Proceed button disabled when critical row is
 * unconfirmed" — lives in Review.test.tsx because it requires session setup.
 * These tests exercise the unit boundary.
 */

describe('FieldRow.onConfirmChange — v1.21.3 confirmation wire-up', () => {
  it('fires with true on mount when confidence is high (no manual confirm needed)', () => {
    const cb = vi.fn();
    render(
      <FieldRow
        label="גיל"
        value="82"
        confidence="high"
        critical
        onChange={() => undefined}
        onConfirmChange={cb}
      />,
    );
    // High confidence + critical → needsConfirm=false → confirmed=true → callback fires with true.
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('fires with true on mount when confidence is med (no manual confirm needed)', () => {
    const cb = vi.fn();
    render(
      <FieldRow
        label="גיל"
        value="82"
        confidence="med"
        critical
        onChange={() => undefined}
        onConfirmChange={cb}
      />,
    );
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('fires with FALSE on mount when confidence is low + critical (confirm required)', () => {
    const cb = vi.fn();
    render(
      <FieldRow
        label="שם"
        value="דוד"
        confidence="low"
        critical
        onChange={() => undefined}
        onConfirmChange={cb}
      />,
    );
    // Low + critical → needsConfirm=true → confirmed=false → callback fires with false.
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it('fires with FALSE on mount when confidence is missing + critical (confirm required)', () => {
    // The v1.21.0 production case: model didn't include confidence for this
    // critical field. The schema at extract instructions allows the model to
    // omit confidence keys, so this is a real path we have to handle.
    const cb = vi.fn();
    render(
      <FieldRow
        label="שם"
        value="פונארו"
        confidence={undefined}
        critical
        onChange={() => undefined}
        onConfirmChange={cb}
      />,
    );
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it('fires with true on mount when not critical, even with missing confidence', () => {
    // Non-critical fields (חדר, תלונה ראשית) don't gate the Proceed button.
    // Missing confidence on those is acceptable — the doctor visually verifies.
    const cb = vi.fn();
    render(
      <FieldRow
        label="חדר"
        value="3-12"
        confidence={undefined}
        onChange={() => undefined}
        onConfirmChange={cb}
      />,
    );
    expect(cb).toHaveBeenLastCalledWith(true);
  });

  it('fires with true after the doctor taps the confirm button', () => {
    const cb = vi.fn();
    render(
      <FieldRow
        label="שם"
        value="דוד"
        confidence="low"
        critical
        onChange={() => undefined}
        onConfirmChange={cb}
      />,
    );
    // Initial fire: false (low + critical, not yet confirmed)
    expect(cb).toHaveBeenLastCalledWith(false);
    // Doctor taps confirm
    fireEvent.click(screen.getByRole('button', { name: /אישור ידני נדרש/ }));
    // Now the callback should have fired with true
    expect(cb).toHaveBeenLastCalledWith(true);
  });

  it('does not require onConfirmChange — backwards compat with pre-v1.21.3 callers', () => {
    // The callback is optional. Existing callers (and, more importantly,
    // existing tests) that don't pass it shouldn't crash.
    expect(() =>
      render(
        <FieldRow
          label="גיל"
          value="82"
          confidence="high"
          critical
          onChange={() => undefined}
        />,
      ),
    ).not.toThrow();
  });
});
