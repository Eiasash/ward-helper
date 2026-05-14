/**
 * PHI-at-rest encryption layer — helpers + key lifecycle.
 *
 * Wire model (locked in design lane 2026-05-14):
 *   - Cipher: reuse aes.ts (AES-GCM, 12-byte IV, 256-bit key).
 *   - Key:    PBKDF2(loginPassword, persistedSalt) → AES-GCM 256, extractable:false,
 *             held in memory only via setKey/clearKey, never persisted.
 *   - Salt:   16 random bytes generated on first install, persisted in
 *             Settings.phiSalt. Non-secret but STABLE — never regenerate.
 *
 * ─── Per-store scope (locked 2026-05-14 PR-B2.1 design — Adjustment 2C) ──
 *
 * IN-SCOPE (sealed at rest):
 *   - `patients` — full PHI (name, teudatZehut, dob, room, tomorrowNotes,
 *                  handoverNote, planLongTerm, planToday, clinicalMeta).
 *   - `notes`    — clinical body PHI (bodyHebrew, structuredData).
 *                  patientId stays plaintext at row top-level to keep the
 *                  surviving `by-patient` index working post-encryption.
 *   - `roster`   — direct PHI (tz, name, room, dxShort per RosterPatient).
 *                  Added to scope after the B2.1 fresh-eye Q2 found that
 *                  pre-B2.1 docs incorrectly claimed roster carries no PHI.
 *
 * CARVE-OUT (intentionally NOT sealed at rest):
 *   - `daySnapshots` — frozen `Patient[]` copies via structuredClone in
 *                  `rounds.ts::archiveDay`. The cloud-sync path
 *                  (`daySnapshotsCloud.ts`) ALREADY encrypts on push via
 *                  encryptForCloud and decrypts on pull via decryptFromCloud,
 *                  so the cloud surface is protected.
 *                  Local-at-rest is the documented exposed surface, and it's
 *                  inside the project threat model: CLAUDE.md states the
 *                  scope as "a lost LOCKED personal device on top of OS
 *                  full-disk encryption." A reader who recovers a local
 *                  daySnapshot row at rest has already defeated full-disk
 *                  encryption, at which point the IDB-layer ciphertext is
 *                  not the meaningful defense.
 *                  Pinned by the B2.1 fresh-eye round 2 Q3 verification:
 *                  no daySnapshot read path assumes encryption (every
 *                  consumer reads plain typed DaySnapshot rows); the
 *                  carve-out is consistent. Reviewing this in future:
 *                  before adding a new daySnapshot consumer that runs
 *                  rows through `unsealRow`/`decrypt`, REVISIT this
 *                  carve-out — that would mean some consumers think
 *                  daySnapshots are encrypted and others don't, which
 *                  is the silent-hole failure mode the carve-out was
 *                  audited against.
 *   - `settings`    — metadata only (apiKeyXor, deviceSecret, salts,
 *                  prefs, cachedUnlockBlob, loginPwdXor, phiSalt). No
 *                  PHI fields. Verified by the same B2.1 fresh-eye Q2.
 *
 * Threat model: a lost LOCKED personal device on top of OS full-disk
 * encryption + an iCloud/Google IDB backup leak. Because the key is
 * password-derived and memory-only, a backup contains ciphertext +
 * salt only — fully inert without the user's login password.
 *
 * Companion modules: aes.ts (primitives), pbkdf2.ts (the shared
 * unlock.ts derivation path), phiRow.ts (row-shape envelope + read seam).
 * The PHI derivation is forked here rather than parameterised on
 * pbkdf2.ts because the PHI flow needs `extractable: false` and the
 * shared derivation needs `extractable: true` for the cached-unlock
 * blob round-trip. Forking keeps each invariant local.
 *
 * Status: this module owns the crypto primitives + key lifecycle +
 * salt. The row-shape glue (`{id, enc}` for patients/roster, `{id,
 * patientId, enc}` for notes) lives in phiRow.ts. PR-A landed these
 * primitives as dead code; PR-B1 dropped the by-tz index; PR-B2.1
 * wires the read seam at every site (this commit); PR-B2.2 will land
 * the write side + backfill + cold-start gate.
 */

import { aesEncrypt, aesDecrypt, type Sealed } from './aes';
import { getSettings, patchSettings } from '@/storage/indexed';

export type { Sealed };

/**
 * Default PBKDF2 iteration count. Matches the value used in pbkdf2.ts for
 * the unlock-blob derivation — both layers should pay the same cost so an
 * attacker can't pick the cheaper one. Tests override to a small value
 * (typically 4) to avoid PBKDF2 overhead × suite count.
 */
export const PHI_PBKDF2_ITERATIONS = 600_000;

/**
 * Derive the PHI-encryption AES-GCM key from the user's login password.
 *
 * Returns a `CryptoKey` with `extractable: false` — there is no legitimate
 * reason to export it, and the harder the key is to exfiltrate via a
 * compromised JS context the better. The shared `pbkdf2.ts::deriveAesKey`
 * intentionally uses `extractable: true` for the unlock-blob round-trip;
 * forking here keeps each module's invariant explicit.
 *
 * `iterations` is parameterised solely for test speed (a 600k iteration
 * derivation costs ~50-200ms on a phone; running it once per test inflates
 * the suite by tens of seconds). Production callers MUST use the default.
 */
export async function derivePhiKey(
  loginPassword: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number = PHI_PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(loginPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // extractable
    ['encrypt', 'decrypt'],
  );
}

// ─── In-memory key lifecycle ─────────────────────────────────────────────
//
// Module-scope `let` so a logout-clearPhiKey wipes the key for every caller
// in the process. No singleton wrapper, no React context — same shape as
// `dbPromise` in indexed.ts. The key never leaves this module's closure;
// callers go through seal/unseal which read it internally.

let currentPhiKey: CryptoKey | null = null;

export function setPhiKey(key: CryptoKey): void {
  currentPhiKey = key;
}

/**
 * Returns the active PHI key, or null when no derivation has happened yet
 * this session (cold-start before password gate, or post-logout). Exposed
 * mainly for code that needs to gate UI on key-presence; production
 * read/write paths should go through seal/unseal instead.
 */
export function getPhiKey(): CryptoKey | null {
  return currentPhiKey;
}

export function hasPhiKey(): boolean {
  return currentPhiKey !== null;
}

export function clearPhiKey(): void {
  currentPhiKey = null;
}

// ─── Sealed-row helpers ──────────────────────────────────────────────────

/**
 * Serialize + encrypt a row value. The JSON envelope is what aes.ts encrypts;
 * the (iv, ciphertext) pair returned is what the caller writes to disk.
 *
 * Throws if no key is set — encryption without a key is a programming bug,
 * never a user-recoverable runtime state.
 */
export async function sealRow(value: unknown): Promise<Sealed> {
  if (currentPhiKey === null) {
    throw new Error('sealRow: no PHI key set (call setPhiKey first)');
  }
  return aesEncrypt(JSON.stringify(value), currentPhiKey);
}

/**
 * Decrypt + parse a sealed row. Returns null on any failure (no key,
 * wrong key, corrupted ciphertext, JSON parse). Per design discipline
 * "decrypt failure must not crash" — callers handle null by skipping
 * the row and surfacing a quiet recovery affordance.
 *
 * The generic param `T` is informational; this function does NOT validate
 * the decrypted shape against T. Callers that need shape-checking should
 * apply it after a non-null return.
 */
export async function unsealRow<T>(sealed: Sealed): Promise<T | null> {
  if (currentPhiKey === null) return null;
  try {
    const plaintext = await aesDecrypt(sealed.ciphertext, sealed.iv, currentPhiKey);
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

// ─── Salt persistence ────────────────────────────────────────────────────

/**
 * Load the device-stable PHI salt from Settings, generating + persisting one
 * if missing. The salt is non-secret but STABLE: regenerating it would make
 * every existing ciphertext unrecoverable. This function is the one path
 * by which a salt should ever be created or read.
 *
 * Returns the salt bytes. Always 16 bytes wide.
 */
export async function loadOrCreatePhiSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const existing = await getSettings();
  if (existing?.phiSalt && existing.phiSalt.byteLength > 0) {
    return existing.phiSalt;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  await patchSettings({ phiSalt: salt });
  return salt;
}
