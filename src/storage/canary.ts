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
  getSupabase,
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
 * v1.39.17: dedupe stale canary rows that accumulated under prior anon-auth
 * user_ids for the SAME username. Call AFTER a successful pushCanary —
 * the server-side RPC's defensive check requires the caller to already
 * own a canary under the username.
 *
 * NOT called from pushCanary itself: importing pushBreadcrumb here would
 * create a circular dependency through MobileDebugPanel→save.ts→cloud.ts
 * →canary.ts that breaks vi.mock resolution in the auth test suite. The
 * caller (armCanaryOnce in save.ts) does the breadcrumb wrapping where
 * the import cycle is already established and harmless.
 *
 * Returns the number of rows deleted. Throws on RPC error so the caller
 * can decide whether to swallow.
 */
export async function dedupeStaleCanaries(username: string | null): Promise<number> {
  if (!username) return 0;
  const trimmed = username.trim();
  if (!trimmed) return 0;
  const sb = await getSupabase();
  const { data, error } = await sb.rpc(
    'ward_helper_dedupe_stale_canaries',
    { p_username: trimmed },
  );
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
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
  // The (user_id, blob_type, blob_id) UNIQUE constraint means a single
  // anon-auth identity should only ever have one canary row. In practice
  // we observed up to 9 canary rows for a single username — anon auth can
  // mint a fresh user_id when the device's auth token expires, IDB is
  // cleared, or a new browser is used, and each fresh user_id slips past
  // the unique constraint to insert a new canary. The user-facing identity
  // (username) is the same; the rows accumulate.
  //
  // Real bug — 2026-05-07 user diag: 9 canary rows existed for username
  // 'eiasashhab55555', and rows.find() (no ORDER BY in the pull RPC)
  // returned a non-deterministic one. When find() picked an old canary
  // encrypted under a no-longer-current password, verify returned
  // 'wrong-passphrase' even when the user's CURRENT password was correct,
  // triggering the orphan-canary guardrail and blocking cloud sync. On
  // page reload it might pick a different canary and return 'ok'.
  // Symptom was intermittent and impossible to reproduce in normal QA.
  //
  // Fix: pick the newest canary by updated_at. The most recent push under
  // the most recent passphrase is the only one that matters for verify.
  // Older canaries are encrypted under previous user_ids' keys and are
  // dead weight regardless.
  const canaries = rows.filter(
    (r) => r.blob_type === 'canary' && r.blob_id === CANARY_BLOB_ID,
  );
  if (canaries.length === 0) return 'absent';
  const canary =
    canaries.length === 1
      ? canaries[0]!
      : canaries.reduce((newest, r) =>
          r.updated_at > newest.updated_at ? r : newest,
        );
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
