/**
 * PHI row-shape helpers — the transitional read seam between the storage
 * layer and the PHI-at-rest crypto primitives in phi.ts.
 *
 * Companion to phi.ts (key lifecycle + seal/unseal of arbitrary values).
 * This module owns the ROW shape: how an encrypted Patient/Note/Roster
 * row is structured on disk, and how a reader decides "is this row
 * encrypted?" without ever feeding a malformed row to unsealRow.
 *
 * On-disk shapes (post-encryption — B2.2 lands the write side):
 *
 *     SealedPatientRow  = { id, enc }
 *     SealedNoteRow     = { id, patientId, enc }
 *     SealedRosterRow   = { id, enc }
 *
 * `patientId` is intentionally kept at the Note row top-level: it's the
 * key column of the surviving `by-patient` index, and that index must
 * keep working after encryption. The other PHI fields (name, teudatZehut,
 * dob, body, etc.) live inside `enc`.
 *
 * Sniff rule (positive structural check on the Sealed envelope):
 *
 *     isEncryptedRow(row) = true ⇔
 *         row is a non-null object,
 *         row.id is a string,
 *         row.enc is a non-null object with `iv` and `ciphertext` both
 *         being Uint8Array instances.
 *
 * Anything that does not match cleanly is treated as PLAINTEXT and
 * returned to the caller as-is. A malformed half-migrated row that has
 * neither shape cleanly goes down the plaintext-passthrough path and
 * surfaces as a normal downstream error (the consumer hits an undefined
 * field). It is NOT fed to unsealRow (which returns null on any decrypt
 * failure and would silently disappear). This invariant is pinned by
 * `tests/phiRow.test.ts::malformed-row passthrough`.
 *
 * Flag gate (WRITE path):
 *
 *     isPhiEncryptV7Enabled() reads `localStorage.phi_encrypt_v7 === '1'`.
 *     Default is OFF — B2.1 ships with this off so flag-off bytes-equal-today.
 *     B2.2 lands the backfill runner that seals existing rows and flips
 *     the durable `Settings.phiEncryptedV7` sentinel.
 *
 * Read path is intentionally NOT flag-gated. A row that's already
 * encrypted in storage must decrypt regardless of flag state; the flag
 * controls only whether NEW writes are sealed. This protects against
 * the "user toggles the flag off after some rows are sealed" failure
 * mode — already-encrypted rows stay readable.
 *
 * Sync vs async: `isEncryptedRow` is synchronous on purpose. Read-seam
 * callers that wrap a single IDB read can use the sync guard to AVOID
 * the always-await microtask cost when no rows are encrypted (the case
 * for all of B2.1's flag-off world). `decryptRowIfEncrypted` is async
 * because actual decryption uses `crypto.subtle.decrypt`. Use the sync
 * guard inside transactions; use the async wrapper at pure-read sites
 * where the tx is already done when the wrapper runs.
 *
 * Scope (PR-B2.1):
 *   - Reads at PURE-READ sites in indexed.ts (listPatients / listAllNotes /
 *     getPatient / getNote / listNotes / listNotesByTeudatZehut) and
 *     roster.ts (getRoster) cross the seam.
 *   - Read-then-write-in-tx sites in indexed.ts (markNoteSent) and
 *     rounds.ts (5 point writes + archiveDay + backfill cursor) and
 *     roster.ts (ageOutRoster) are DEFERRED to B2.2, where they will be
 *     refactored with staged-tx patterns alongside write-side encryption.
 *     See `.audit_logs/2026-05-14-pr-b2-design-pins.md` for the rationale
 *     and the staged-tx pseudocode for the cursor site.
 */

import type { Sealed } from './aes';

// ─── Sealed-row envelope types ────────────────────────────────────────

export interface SealedPatientRow {
  id: string;
  enc: Sealed;
}

export interface SealedNoteRow {
  id: string;
  patientId: string;
  enc: Sealed;
}

export interface SealedRosterRow {
  id: string;
  enc: Sealed;
}

export type RowKind = 'patient' | 'note' | 'roster';

// ─── Synchronous shape sniff ──────────────────────────────────────────

/**
 * Is `enc` a structurally valid `Sealed` envelope?
 *
 * Both `iv` and `ciphertext` must be Uint8Array instances. The
 * `Uint8Array<ArrayBuffer>` generic in the Sealed type is a TypeScript
 * narrowing only — at runtime we check `instanceof Uint8Array`.
 */
function isSealedEnvelope(enc: unknown): enc is Sealed {
  if (typeof enc !== 'object' || enc === null) return false;
  const candidate = enc as { iv?: unknown; ciphertext?: unknown };
  return (
    candidate.iv instanceof Uint8Array &&
    candidate.ciphertext instanceof Uint8Array
  );
}

/**
 * Type guard for the encrypted-row shape. Returns true ONLY when the row
 * has both a string `id` AND a structurally valid `Sealed` envelope at
 * `.enc`. Anything else (plaintext shape, malformed half-migrated row,
 * null, undefined, primitives) returns false.
 *
 * Synchronous by design — see module docblock for sync/async rationale.
 */
export function isEncryptedRow(
  row: unknown,
): row is { id: string; enc: Sealed } {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as { id?: unknown; enc?: unknown };
  if (typeof r.id !== 'string') return false;
  if (!('enc' in r)) return false;
  return isSealedEnvelope(r.enc);
}

// ─── Async decryption ─────────────────────────────────────────────────

/**
 * If `row` is structurally encrypted, decrypt it and return the
 * recovered plaintext object. Otherwise (plaintext shape OR malformed
 * row OR undefined/null), return `row` as-is.
 *
 * Returns `null` ONLY when decryption was attempted and failed (wrong
 * key, corrupt ciphertext). Returns `undefined` for an undefined input.
 *
 * The `kind` argument is informational (no behavior branching today —
 * decryption is symmetric across all three row types). It's part of the
 * signature so future variant logic (per-store key derivation, kind-
 * specific shape validation) can land without a signature change.
 *
 * Imports `unsealRow` dynamically to break the dependency cycle between
 * `phi.ts` and the storage layer — `phi.ts` already imports `getSettings`
 * and `patchSettings` from `storage/indexed.ts`, and `indexed.ts` will
 * import this module. The dynamic import only fires on the encrypted
 * branch, which is unreachable until B2.2 lands the write side; under
 * B2.1's world it's never called.
 */
export async function decryptRowIfEncrypted<T>(
  row: T | { id: string; enc: Sealed } | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  kind: RowKind,
): Promise<T | null | undefined> {
  if (row === null || row === undefined) return row;
  if (!isEncryptedRow(row)) return row as T;
  const { unsealRow } = await import('./phi');
  return unsealRow<T>({ iv: row.enc.iv, ciphertext: row.enc.ciphertext });
}

/**
 * Array variant. Maps each row through `decryptRowIfEncrypted`, filters
 * out decrypt-failure nulls. Used by `listPatients` / `listAllNotes` /
 * `listNotes` / `getRoster`.
 *
 * Fast path: if NO row in the input is structurally encrypted, return
 * the original array without spinning up Promise.all + .filter. Under
 * flag-off + no-encrypted-rows world (B2.1's world), this short-circuit
 * preserves byte-equivalence with today's behavior — the seam is in
 * place without paying any per-call microtask cost.
 *
 * Slow path (mixed plaintext + encrypted, or all encrypted): decrypt
 * the encrypted rows in parallel, leave plaintext rows alone, filter
 * out nulls.
 */
export async function decryptRowsIfEncrypted<T>(
  rows: Array<T | { id: string; enc: Sealed }>,
  kind: RowKind,
): Promise<T[]> {
  const anyEncrypted = rows.some((r) => isEncryptedRow(r));
  if (!anyEncrypted) return rows as T[];
  const decrypted = await Promise.all(
    rows.map((r) => decryptRowIfEncrypted<T>(r, kind)),
  );
  return decrypted.filter((r): r is T => r !== null && r !== undefined);
}

// ─── Write-path flag gate (used by B2.2; exposed in B2.1 for tests) ──

const PHI_ENCRYPT_V7_LS_KEY = 'phi_encrypt_v7';

/**
 * Read the localStorage flag that gates write-side encryption. Default
 * OFF (B2.1 ships with this off so flag-off behaves byte-equal to today).
 * B2.2 adds the backfill runner that flips this on after sealing
 * existing rows AND writing the durable `Settings.phiEncryptedV7`
 * sentinel.
 *
 * The READ path does NOT consult this flag — reads are shape-driven so
 * a flag flicker doesn't lose access to already-sealed rows.
 *
 * Returns `false` on any access failure (private-mode localStorage,
 * disabled storage). Safe default; B2.2's write side will refuse to
 * seal if it can't read the flag.
 */
export function isPhiEncryptV7Enabled(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(PHI_ENCRYPT_V7_LS_KEY) === '1';
  } catch {
    return false;
  }
}
