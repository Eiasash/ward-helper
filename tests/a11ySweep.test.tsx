/**
 * Regression tests for the 2026-04-28 a11y sweep.
 *
 * These pin the labels added during the sweep so a future refactor can't
 * silently drop them. A clinical-data input that loses its label is a
 * real safety regression — the doctor's screen reader stops reading the
 * field before they type a teudat-zehut, dose, or allergy.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FieldRow } from '@/ui/components/FieldRow';

afterEach(() => cleanup());

describe('a11y sweep — FieldRow label association', () => {
  it('teudat-zehut row is reachable via getByLabelText', () => {
    render(
      <FieldRow
        label="ת.ז."
        value="123456789"
        confidence="high"
        critical
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText('ת.ז.')).toBeInTheDocument();
  });

  it('name row is reachable via getByLabelText', () => {
    render(
      <FieldRow
        label="שם"
        value="כהן יוסף"
        confidence="high"
        critical
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText('שם')).toBeInTheDocument();
  });

  it('low-confidence critical rows mark the input aria-invalid + aria-required', () => {
    render(
      <FieldRow
        label="גיל"
        value=""
        confidence="low"
        critical
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('גיל');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('non-critical rows do not have aria-invalid or aria-required', () => {
    render(
      <FieldRow
        label="חדר"
        value="A12"
        confidence={undefined}
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('חדר');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-required')).toBeNull();
  });
});
