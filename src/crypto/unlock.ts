import { getSettings, setSettings, patchSettings, type CachedUnlockBlob } from '@/storage/indexed';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';

/**
 * Encrypt the user's backup passphrase with their login password and persist
 * it on-device. After this call, tryAutoUnlock(loginPassword) returns the
 * passphrase without prompting.
 *
 * Threat model: a thief with the device + the login password gets the
 * passphrase. Same posture as iOS Keychain "available when unlocked" — the
 * device login is the gate, not a separate secret.
 *
 * Note: prior to 2026-05-14 this function used a hand-listed setSettings
 * call that omitted `loginPwdXor` (latent bug: every password-change
 * wiped the persisted login password). Migrating to patchSettings made
 * the bug structurally impossible — fields not named in the partial are
 * preserved.
 */
export async function cacheUnlockBlob(
  passphrase: string,
  loginPassword: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveAesKey(loginPassword, salt);
  const { iv, ciphertext } = await aesEncrypt(passphrase, key);
  await patchSettings({ cachedUnlockBlob: { v: 1, ciphertext, iv, salt } });
}

/**
 * Try to recover the passphrase using the login password the user just typed.
 * Returns null on any failure (no cache, wrong password, corrupt blob,
 * schema mismatch). Never throws — caller falls back to the prompt UI.
 */
export async function tryAutoUnlock(loginPassword: string): Promise<string | null> {
  const s = await getSettings();
  const blob: CachedUnlockBlob | null | undefined = s?.cachedUnlockBlob;
  if (!blob || blob.v !== 1) return null;
  try {
    const key = await deriveAesKey(loginPassword, blob.salt);
    const passphrase = await aesDecrypt(blob.ciphertext, blob.iv, key);
    return passphrase;
  } catch {
    return null;
  }
}

/** Drop the cache so next session prompts again (used on logout). */
export async function clearUnlockCache(): Promise<void> {
  const s = await getSettings();
  if (!s) return;
  await setSettings({ ...s, cachedUnlockBlob: null });
}

/**
 * Re-encrypt the cached unlock blob with a new login password. Called by the
 * password-change flow after the server bcrypt update succeeds, so the user's
 * cached passphrase is still recoverable on next login. No-op if no cache.
 *
 * Returns true if a cache existed and was re-encrypted, false otherwise.
 */
export async function reencryptUnlockCache(
  oldLoginPassword: string,
  newLoginPassword: string,
): Promise<boolean> {
  const passphrase = await tryAutoUnlock(oldLoginPassword);
  if (passphrase === null) return false;
  await cacheUnlockBlob(passphrase, newLoginPassword);
  return true;
}
