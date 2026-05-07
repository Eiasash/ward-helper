import { describe, it, expect } from 'vitest';
import { isValidIsraeliTzLuhn, normalizeIsraeliTz } from '@/notes/israeliTz';

/**
 * Compute the check digit for an 8-digit prefix using the Israeli ת.ז.
 * algorithm. Mirrors the logic under test so we can synthesize valid
 * 9-digit IDs without hard-coding real ones.
 */
function withValidCheckDigit(prefix8: string): string {
  if (!/^\d{8}$/.test(prefix8)) throw new Error('prefix must be 8 digits');
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let p = Number(prefix8[i]) * (i % 2 === 0 ? 1 : 2);
    if (p > 9) p -= 9;
    sum += p;
  }
  const check = (10 - (sum % 10)) % 10;
  return prefix8 + String(check);
}

describe('isValidIsraeliTzLuhn', () => {
  it('accepts the worked-example "123456782"', () => {
    expect(isValidIsraeliTzLuhn('123456782')).toBe(true);
  });

  it('accepts a synthesized valid ID', () => {
    expect(isValidIsraeliTzLuhn(withValidCheckDigit('00000000'))).toBe(true);
    expect(isValidIsraeliTzLuhn(withValidCheckDigit('98765432'))).toBe(true);
  });

  it('rejects "666544000" — 9 digits but Luhn-invalid (the live bug case)', () => {
    expect(isValidIsraeliTzLuhn('666544000')).toBe(false);
  });

  it('rejects non-9-digit inputs', () => {
    expect(isValidIsraeliTzLuhn('')).toBe(false);
    expect(isValidIsraeliTzLuhn('12345678')).toBe(false);
    expect(isValidIsraeliTzLuhn('1234567890')).toBe(false);
    expect(isValidIsraeliTzLuhn('666544')).toBe(false);
  });

  it('rejects strings with non-digit characters', () => {
    expect(isValidIsraeliTzLuhn('12345678a')).toBe(false);
    expect(isValidIsraeliTzLuhn('1234-5678')).toBe(false);
    expect(isValidIsraeliTzLuhn(' 12345678')).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(isValidIsraeliTzLuhn(null as unknown as string)).toBe(false);
    expect(isValidIsraeliTzLuhn(undefined as unknown as string)).toBe(false);
    expect(isValidIsraeliTzLuhn(123456782 as unknown as string)).toBe(false);
  });

  it('flips off when the check digit is wrong by one', () => {
    const valid = withValidCheckDigit('12345678');
    const lastDigit = Number(valid[8]);
    const wrong = valid.slice(0, 8) + String((lastDigit + 1) % 10);
    expect(isValidIsraeliTzLuhn(valid)).toBe(true);
    expect(isValidIsraeliTzLuhn(wrong)).toBe(false);
  });
});

describe('normalizeIsraeliTz', () => {
  it('trims whitespace then validates', () => {
    expect(normalizeIsraeliTz('  123456782  ')).toBe('123456782');
  });

  it('returns null for Luhn-invalid input even when length is 9', () => {
    expect(normalizeIsraeliTz('666544000')).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    expect(normalizeIsraeliTz(null)).toBeNull();
    expect(normalizeIsraeliTz(undefined)).toBeNull();
    expect(normalizeIsraeliTz(123456782)).toBeNull();
    expect(normalizeIsraeliTz({})).toBeNull();
  });

  it('returns null for empty / whitespace-only', () => {
    expect(normalizeIsraeliTz('')).toBeNull();
    expect(normalizeIsraeliTz('   ')).toBeNull();
  });

  it('returns null for short strings (fails closed)', () => {
    expect(normalizeIsraeliTz('666544')).toBeNull();
  });

  it('preserves leading zeros on a valid 9-digit input', () => {
    const v = withValidCheckDigit('00000000');
    expect(normalizeIsraeliTz(v)).toBe(v);
    expect(v.startsWith('0')).toBe(true);
  });
});
