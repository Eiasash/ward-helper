/**
 * Canary blob: a known plaintext encrypted with the user's passphrase, used
 * by Settings.tsx and restoreFromCloud to fail fast on wrong passphrase
 * BEFORE attempting full pulls/decrypts of patient and note rows.
 *
 * Lives in a module separate from cloud.ts so tests can `vi.mock` the cloud
 * push/pull functions and have those mocks intercept the canary code paths.
 * Lexical intra-module references (which is what we'd get if these were
 * defined inside cloud.ts) bypass vi.mock — extracting here is the standard
 * vitest fix.
 */
import {
  encryptForCloud,
  decryptFromCloud,
  pushBlob,
  pullByUsername,
  pullAllBlobs,
  base64ToBytes,
  type CloudBlobRow,
} from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';

/** Pinned blob_id for the canary row — one per user. */
export const CANARY_BLOB_ID = '__canary__';

/**
 * The canary plaintext is a known string. Decryption with the user's
 * passphrase succeeds iff the passphrase matches the one used at push time.
 * Used by restoreFromCloud and Settings.tsx to fail fast on wrong passphrase.
 */
interface CanaryPayload {
  v: 1;
  marker: 'ward-helper-canary';
  createdAt: number;
}

const CANARY_PLAINTEXT: Omit<CanaryPayload, 'createdAt'> = {
  v: 1,
  marker: 'ward-helper-canary',
};

/**
 * Push (or refresh) the canary blob. Idempotent: same blob_id, fresh IV.
 * Caller passes the already-derived AES key so we avoid re-running PBKDF2
 * just for this small blob.
 */
export async function pushCanary(
  key: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  username: string | null,
): Promise<void> {
  const payload: CanaryPayload = { ...CANARY_PLAINTEXT, createdAt: Date.now() };
  const sealed = await encryptForCloud(payload, key, salt);
  await pushBlob('canary', CANARY_BLOB_ID, sealed, username);
}

/**
 * Verify the canary against an already-pulled rows array. Used by
 * restoreFromCloud to check passphrase WITHOUT re-pulling, since the
 * restore flow already has the rows in hand. Pre-v1.39.8 the flow was
 * (pull → verifyCanary which pulls again → decrypt loop on third use of
 * rows), producing two identical ward_helper_pull_by_username RPCs per
 * login. This split lets restoreFromCloud pull once.
 */
export async function verifyCanaryFromRows(
  passphrase: string,
  rows: CloudBlobRow[],
): Promise<'ok' | 'wrong-passphrase' | 'absent'> {
  const canary = rows.find(
    (r) => r.blob_type === 'canary' && r.blob_id === CANARY_BLOB_ID,
  );
  if (!canary) return 'absent';
  try {
    const salt = base64ToBytes(canary.salt);
    const iv = base64ToBytes(canary.iv);
    const ct = base64ToBytes(canary.ciphertext);
    const key = await deriveAesKey(passphrase, salt);
    const decoded = await decryptFromCloud<CanaryPayload>(ct, iv, key);
    if (decoded?.v === 1 && decoded.marker === 'ward-helper-canary') {
      return 'ok';
    }
    return 'wrong-passphrase';
  } catch {
    return 'wrong-passphrase';
  }
}

/**
 * Probe the cloud for a canary row and try to decrypt it with the given
 * passphrase. Result: 'ok' / 'wrong-passphrase' / 'absent'.
 *
 * Routes through pullByUsername when an app_users session is active, else
 * pullAllBlobs (legacy per-anon path). Either way the canary row carries
 * its own salt, so we re-derive the AES key per-call.
 *
 * Used by MobileDebugPanel for standalone passphrase probing. The restore
 * flow uses verifyCanaryFromRows directly to avoid a duplicate pull.
 */
export async function verifyCanary(
  passphrase: string,
  username: string | null,
): Promise<'ok' | 'wrong-passphrase' | 'absent'> {
  const rows: CloudBlobRow[] = username && username.trim()
    ? await pullByUsername(username)
    : await pullAllBlobs();
  return verifyCanaryFromRows(passphrase, rows);
}
