import { getSettings, setSettings } from '@/storage/indexed';
import { xorEncrypt, xorDecrypt, generateDeviceSecret } from './xor';

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
