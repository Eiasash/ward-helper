import { useState, useEffect, useCallback } from 'react';
import { hasApiKey, loadApiKey, saveApiKey, clearApiKey } from '@/crypto/keystore';

// Passphrase lives in memory only, auto-clears after idle timeout.
let passphraseMemory: string | null = null;
let passphraseSetAt = 0;
const IDLE_MS = 15 * 60 * 1000;

export function setPassphrase(p: string): void {
  passphraseMemory = p;
  passphraseSetAt = Date.now();
}

export function getPassphrase(): string | null {
  if (!passphraseMemory) return null;
  if (Date.now() - passphraseSetAt > IDLE_MS) {
    passphraseMemory = null;
    return null;
  }
  return passphraseMemory;
}

export function clearPassphrase(): void {
  passphraseMemory = null;
  passphraseSetAt = 0;
}

export function useApiKey() {
  const [present, setPresent] = useState<boolean | null>(null);

  useEffect(() => {
    hasApiKey().then(setPresent);
  }, []);

  const save = useCallback(async (k: string) => {
    await saveApiKey(k);
    setPresent(true);
  }, []);

  const peek = useCallback(() => loadApiKey(), []);

  const clear = useCallback(async () => {
    await clearApiKey();
    setPresent(false);
  }, []);

  return { present, save, peek, clear };
}
