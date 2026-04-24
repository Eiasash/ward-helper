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

/**
 * Opt-in Chameleon-rules audit banner on the NoteEditor screen.
 *
 * The sanitizer at the clipboard boundary is the real safety net — but when
 * tuning prompts or the sanitizer itself, it's useful to see violations the
 * model produced BEFORE they get washed out. This toggle surfaces that
 * signal for developers; in normal clinical use the banner is silent and
 * the note appears pre-cleaned.
 */
const BIDI_AUDIT_KEY = 'ward-helper.bidiAudit';

export function getBidiAuditEnabled(): boolean {
  try {
    return localStorage.getItem(BIDI_AUDIT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setBidiAuditEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(BIDI_AUDIT_KEY, '1');
    else localStorage.removeItem(BIDI_AUDIT_KEY);
  } catch {
    /* ignore */
  }
}

export function useBidiAudit(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => getBidiAuditEnabled());
  const set = useCallback((v: boolean) => {
    setBidiAuditEnabled(v);
    setOn(v);
  }, []);
  return [on, set];
}

/**
 * Email target for the "Send by email" button on the Save screen. Persists
 * to localStorage under `ward-helper.emailTo`. When unset, the Save-screen
 * button is hidden — user has to configure a recipient in Settings first.
 *
 * Single recipient by design — doctor→self workflow (send the note to your
 * own archive inbox). Multi-recipient would need a proper compose UI.
 */
const EMAIL_TARGET_KEY = 'ward-helper.emailTo';

export function getEmailTarget(): string {
  try {
    return localStorage.getItem(EMAIL_TARGET_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setEmailTarget(s: string): void {
  try {
    const v = s.trim();
    if (v) localStorage.setItem(EMAIL_TARGET_KEY, v);
    else localStorage.removeItem(EMAIL_TARGET_KEY);
  } catch {
    /* ignore */
  }
}

export function useEmailTarget(): [string, (v: string) => void] {
  const [v, setV] = useState<string>(() => getEmailTarget());
  const set = useCallback((s: string) => {
    setEmailTarget(s);
    setV(s.trim());
  }, []);
  return [v, set];
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
