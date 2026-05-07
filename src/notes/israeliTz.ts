/**
 * Israeli ת.ז. (teudat zehut) validation — length + Luhn check digit.
 *
 * Why this exists separately from `normalizeTz` in rosterImport.ts:
 * the original normalizer was length-only (`/^\d{9}$/`), which silently
 * accepts garbage like "666544000" — 9 digits but Luhn-invalid. A
 * malformed ת.ז. propagates through extract → emit → Chameleon paste,
 * and the EMR rejects it downstream (or worse, silently links the SOAP
 * to a wrong-patient row in the host system). Length-only fails closed
 * on 6-digit inputs but fails OPEN on a digit-padded 9-character string.
 *
 * The check-digit algorithm:
 *   For each digit at position i (0-indexed):
 *     multiplier = (i is even) ? 1 : 2
 *     product = digit × multiplier
 *     if product > 9, sum the digits (equivalent to product - 9)
 *   Sum all results.
 *   Valid iff sum % 10 === 0.
 *
 * Worked example — "123456782" (legit, balances at 40):
 *   1×1=1, 2×2=4, 3×1=3, 4×2=8, 5×1=5, 6×2=12→3, 7×1=7, 8×2=16→7, 2×1=2
 *   sum = 1+4+3+8+5+3+7+7+2 = 40, 40 % 10 = 0 → VALID
 *
 * Worked example — "666544000" (9 digits, length-pass, Luhn-fail):
 *   6×1=6, 6×2=12→3, 6×1=6, 5×2=10→1, 4×1=4, 4×2=8, 0×1=0, 0×2=0, 0×1=0
 *   sum = 6+3+6+1+4+8+0+0+0 = 28, 28 % 10 = 8 → INVALID
 */

const NINE_DIGITS_RE = /^\d{9}$/;

/**
 * Pure check — does this 9-digit string satisfy the Israeli check-digit
 * algorithm? Returns false for non-string, non-9-digit, or Luhn-failing
 * inputs. Caller must trim before calling.
 */
export function isValidIsraeliTzLuhn(s: string): boolean {
  if (typeof s !== 'string' || !NINE_DIGITS_RE.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let product = Number(s[i]) * (i % 2 === 0 ? 1 : 2);
    if (product > 9) product -= 9;
    sum += product;
  }
  return sum % 10 === 0;
}

/**
 * Sanitize an unknown input to a valid Israeli ת.ז. string or null.
 * Trims whitespace, requires exactly 9 digits, and runs Luhn. Replaces
 * the legacy length-only `normalizeTz` in rosterImport.ts — that one
 * accepted Luhn-invalid 9-digit garbage.
 */
export function normalizeIsraeliTz(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return isValidIsraeliTzLuhn(trimmed) ? trimmed : null;
}
