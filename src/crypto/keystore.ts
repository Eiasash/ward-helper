import { getSettings, setSettings } from '@/storage/indexed';
import { xorEncrypt, xorDecrypt, generateDeviceSecret } from './xor';
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
 * API key at-rest protection.
 *
 * Threat model — what this protects against:
 *   - Casual IDB inspection showing a plaintext sk-ant-... key in devtools.
 *   - Backups that sweep IDB contents (the key appears as ciphertext bytes).
 *   - Accidental leak via a screenshot of Supabase Console or a bug report.
 *
 * What this does NOT protect against:
 *   - A determined attacker with open devtools on the same browser profile.
 *     The deviceSecret lives in the same IDB record as the ciphertext, so
 *     ten seconds of inspection is enough to recover the key.
 *   - Malicious apps that exploit Android accessibility to read the browser
 *     profile. Same reason — the secret is colocated.
 *   - Cross-device theft (the key is deterministic given both values).
 *
 * This is "obfuscation at rest" not "encryption". The XOR scheme is
 * deliberately simple to keep the bundle small; upgrading to real WebCrypto
 * AES-GCM would require the user to unlock the app with a passphrase on
 * every launch, which isn't the tradeoff this PWA wants.
 *
 * If you need real encryption here, see `deriveAesKey` in src/crypto/pbkdf2
 * and the passphrase-gated cloud backup path in src/notes/save.ts — that
 * path genuinely encrypts because the key never touches storage.
 */
export async function saveApiKey(apiKey: string): Promise<void> {
  const existing = await getSettings();
  const deviceSecret = existing?.deviceSecret ?? generateDeviceSecret();
  const apiKeyXor = xorEncrypt(apiKey, deviceSecret);
  await setSettings({
    apiKeyXor,
    deviceSecret,
    lastPassphraseAuthAt: existing?.lastPassphraseAuthAt ?? null,
    prefs: existing?.prefs ?? {},
  });
}

export async function loadApiKey(): Promise<string | null> {
  const s = await getSettings();
  if (!s || !s.apiKeyXor || s.apiKeyXor.length === 0) return null;
  return xorDecrypt(s.apiKeyXor, s.deviceSecret);
}

export async function hasApiKey(): Promise<boolean> {
  const s = await getSettings();
  return !!(s && s.apiKeyXor && s.apiKeyXor.length > 0);
}

export async function clearApiKey(): Promise<void> {
  const s = await getSettings();
  if (!s) return;
  await setSettings({
    ...s,
    apiKeyXor: new Uint8Array(0),
  });
}

/**
 * Cloud-sync the user's API key. Caller (saveBoth in src/notes/save.ts)
 * passes the already-derived AES key + salt so we don't re-derive PBKDF2
 * just for the api-key blob — same reason patient + note share derivation.
 *
 * No-op when the user hasn't set a local API key. Idempotent: rePush with
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
