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
  const result = await unsealRow<T>({ iv: row.enc.iv, ciphertext: row.enc.ciphertext });
  if (result === null) {
    // Decrypt failure: most likely cause is "user changed login password
    // since this row was sealed" or "row's ciphertext is corrupt." We
    // surface a session-scoped count so the banner can prompt the user
    // toward a cloud-restore. The row itself is dropped (caller treats
    // null as "not found" downstream).
    incrementDecryptFailureCount();
  }
  return result;
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
  // Cast through unknown because TS can't prove the type predicate when T
  // is generic (T might itself be nullable). Runtime correctness: we
  // explicitly exclude null and undefined; whatever survives is T.
  return decrypted.filter((r) => r !== null && r !== undefined) as unknown as T[];
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

/**
 * Flip the localStorage flag on. Called by the B2.2 backfill runner after
 * sealing existing rows AND writing the durable `Settings.phiEncryptedV7`
 * sentinel — never before, never independently. The sentinel is the
 * source of truth; the localStorage flag is the per-tab fast-path that
 * the write seams consult.
 */
export function setPhiEncryptV7Enabled(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PHI_ENCRYPT_V7_LS_KEY, '1');
    }
  } catch {
    /* localStorage unavailable — sentinel still holds; next session reads it */
  }
}

// ─── Decrypt-failure counter (PR-B2.2 UX surface) ─────────────────────

/**
 * Session-scoped count of rows that hit `unsealRow → null` during this
 * session. Reset on every page reload (not persisted). The banner reads
 * this via `getDecryptFailureCount()` and re-renders on the
 * `'ward-helper:phi-decrypt-fail'` event.
 *
 * Why a count and not just a boolean: a single decrypt failure could be
 * a corrupted row, but tens of failures usually point at a wrong-key
 * scenario (password changed mid-flight; password-rotation guard in
 * commit-5 prevents this for change-password specifically, but defensive
 * tracking for any other cause). The number helps the user judge
 * "is this a stray row, or is everything broken?"
 *
 * Reset paths: `clearDecryptFailureCount()` is called after a successful
 * cloud restore (when re-pulled rows replace the broken ones) and on
 * fresh logout.
 */
let _decryptFailureCount = 0;
const PHI_DECRYPT_FAIL_EVENT = 'ward-helper:phi-decrypt-fail';

function incrementDecryptFailureCount(): void {
  _decryptFailureCount++;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PHI_DECRYPT_FAIL_EVENT));
  }
}

export function getDecryptFailureCount(): number {
  return _decryptFailureCount;
}

export function clearDecryptFailureCount(): void {
  if (_decryptFailureCount === 0) return;
  _decryptFailureCount = 0;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PHI_DECRYPT_FAIL_EVENT));
  }
}

export function subscribeDecryptFailureChanges(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PHI_DECRYPT_FAIL_EVENT, handler);
  return () => window.removeEventListener(PHI_DECRYPT_FAIL_EVENT, handler);
}

// ─── Write-path wrap helpers (PR-B2.2) ────────────────────────────────

/**
 * Seal a Patient row for write. The caller decides via
 * `isPhiEncryptV7Enabled()` whether to pass the plaintext row through
 * `put` directly, OR through this wrapper. The wrapper unconditionally
 * seals — it does NOT consult the flag — so a caller that picks this
 * branch commits to writing the encrypted envelope shape.
 *
 * Shape produced: `{ id, enc }` where `id` is preserved at top level so
 * the IDB `patients` keyPath continues to resolve. Every other PHI
 * field (name, teudatZehut, dob, ...) lives inside `enc` as a sealed
 * JSON blob.
 *
 * Throws if no PHI key is set (delegated from `sealRow`) — same
 * contract as the read seam's `unsealRow` returning null. A caller
 * that reaches this without a key has a programming bug; the throw is
 * loud rather than silent.
 *
 * Imports `sealRow` dynamically to mirror the read seam's cycle break.
 * After first call the module is cached, so subsequent calls pay only
 * the function-call cost (not the dynamic-import overhead).
 */
export async function wrapPatientForWrite(
  p: { id: string } & object,
): Promise<SealedPatientRow> {
  const { sealRow } = await import('./phi');
  const enc = await sealRow(p);
  return { id: p.id, enc };
}

/**
 * Seal a Note row for write. patientId stays at row top level so the
 * `notes.by-patient` index continues to function after encryption — the
 * index keys on `patientId` (plaintext, non-PII UUID), and that index
 * is load-bearing for every per-patient note lookup in the app.
 */
export async function wrapNoteForWrite(
  n: { id: string; patientId: string } & object,
): Promise<SealedNoteRow> {
  const { sealRow } = await import('./phi');
  const enc = await sealRow(n);
  return { id: n.id, patientId: n.patientId, enc };
}

/**
 * Seal a Roster row for write. Same shape as patients — id at top,
 * everything else inside `enc`. No surviving index on the roster store
 * (bounded <50 rows, full scan).
 */
export async function wrapRosterForWrite(
  r: { id: string } & object,
): Promise<SealedRosterRow> {
  const { sealRow } = await import('./phi');
  const enc = await sealRow(r);
  return { id: r.id, enc };
}
