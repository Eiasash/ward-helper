import { encryptForCloud, decryptFromCloud, pushBlob } from '@/storage/cloud';

/**
 * Cloud-sync wire format for the API key blob. JSON-serialized + AES-GCM
 * encrypted by encryptForCloud, then base64-stored as ciphertext on the
 * Supabase row. Versioned so future shape changes (e.g. multi-key support)
 * don't break existing rows.
 */
interface ApiKeyCloudBlob {
  v: 1;
  apiKey: string;
  savedAt: number;
}

/** Pin a single blob_id for the API key. */
export const API_KEY_BLOB_ID = '__user_default__';

/**
 * localStorage is the on-device home for the personal Anthropic API key in
 * the 3-state design (matches shlav-a-mega's `samega_apikey`). The src/ai/
 * dispatch chokepoint reads from this same key, gated on a logged-in user.
 *
 * Why localStorage and not IndexedDB+XOR (the v1.x posture):
 *   - Single source of truth: dispatch, AccountSection, useApiKey hook, and
 *     manual cloud-push all read/write the same string. The XOR layer was
 *     defense-in-depth that turned out to be friction-in-depth — a devtools
 *     attacker recovers the key in either case (deviceSecret colocated).
 *   - Synchronous read: dispatch.callClaude doesn't have to await an IDB
 *     transaction on every API call. Cleaner abort + retry logic.
 *   - Matches the established samega pattern across the four PWAs.
 *
 * Threat model unchanged: same-origin storage, never leaves the device
 * (except encrypted as part of the cloud-backup blob below).
 */
export const LOCAL_API_KEY_LS = 'wardhelper_apikey';

export async function saveApiKey(apiKey: string): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const v = apiKey.trim();
  if (!v) {
    localStorage.removeItem(LOCAL_API_KEY_LS);
    return;
  }
  localStorage.setItem(LOCAL_API_KEY_LS, v);
}

export async function loadApiKey(): Promise<string | null> {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LOCAL_API_KEY_LS);
  return raw && raw.trim() ? raw.trim() : null;
}

export async function hasApiKey(): Promise<boolean> {
  return (await loadApiKey()) !== null;
}

export async function clearApiKey(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LOCAL_API_KEY_LS);
}

/**
 * Cloud-sync the user's API key. Caller (saveBoth in src/notes/save.ts)
 * passes the already-derived AES key + salt so we don't re-derive PBKDF2
 * just for the api-key blob — same reason patient + note share derivation.
 *
 * No-op when the user hasn't set a local API key. Idempotent: re-push with
 * same content produces a fresh IV but upserts the same row (blob_id is
 * pinned to API_KEY_BLOB_ID so onConflict deduplicates).
 *
 * Threat model: identical to note-blob sync. Ciphertext-only on Supabase,
 * passphrase is the actual lock. PBKDF2 ≥ 600k iterations.
 */
export async function pushApiKeyToCloud(
  key: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  username: string | null,
): Promise<{ pushed: boolean; reason?: string }> {
  const apiKey = await loadApiKey();
  if (!apiKey) return { pushed: false, reason: 'no-local-key' };
  const blob: ApiKeyCloudBlob = {
    v: 1,
    apiKey,
    savedAt: Date.now(),
  };
  const sealed = await encryptForCloud(blob, key, salt);
  await pushBlob('api-key', API_KEY_BLOB_ID, sealed, username);
  return { pushed: true };
}

/**
 * Decrypt an api-key blob pulled from the cloud and write it into the
 * local keystore. Used by restoreFromCloud — when a user logs in on a
 * new device, their API key syncs over alongside their notes.
 *
 * Cloud wins on conflict (matches user expectation of "set once, syncs
 * everywhere"). Returns false if the decoded blob fails the v:1 schema
 * check so the caller records a skipped entry rather than aborting the
 * whole restore.
 */
export async function applyApiKeyFromCloud(
  ct: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
): Promise<boolean> {
  const blob = await decryptFromCloud<ApiKeyCloudBlob>(ct, iv, key);
  if (!blob || blob.v !== 1 || typeof blob.apiKey !== 'string' || blob.apiKey.length === 0) {
    return false;
  }
  await saveApiKey(blob.apiKey);
  return true;
}
