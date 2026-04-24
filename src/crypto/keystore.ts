import { getSettings, setSettings } from '@/storage/indexed';
import { xorEncrypt, xorDecrypt, generateDeviceSecret } from './xor';

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
