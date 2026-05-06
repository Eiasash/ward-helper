import { useState, useEffect, useCallback } from 'react';
import { hasApiKey, loadApiKey, saveApiKey, clearApiKey } from '@/crypto/keystore';

// Passphrase lives in memory only. Cleared on explicit `clearPassphrase()`
// (logout, "נקה סיסמה" button) or on page reload — never time-based.
//
// History: until v1.34.2 there was a 15-minute idle-expiry that auto-cleared
// the passphrase mid-session. That was protective when the passphrase was
// the only secret. v1.34.0 added the cachedUnlockBlob (encrypted with the
// login password), which makes the login itself the security gate — the
// 15-min expiry just added a friction tax with no remaining defensive value
// (a thief with the unlocked device can already exfiltrate everything from
// IndexedDB plaintext, so re-prompting for the passphrase doesn't help).
//
// On page reload the in-memory copy is lost regardless — the next login
// triggers tryAutoUnlock which silently re-fills it from the cached blob.
let passphraseMemory: string | null = null;

export function setPassphrase(p: string): void {
  passphraseMemory = p;
}

export function getPassphrase(): string | null {
  return passphraseMemory;
}

export function clearPassphrase(): void {
  passphraseMemory = null;
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

/**
 * Opt-in "debug" panel on the Settings screen. Shows the last extract/emit
 * response bodies + IDB stats to help diagnose issues in the wild. Off by
 * default — clinical users should never see it. Key: `ward-helper.debugPanel`.
 */
const DEBUG_PANEL_KEY = 'ward-helper.debugPanel';

export function getDebugPanelEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugPanelEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEBUG_PANEL_KEY, '1');
    else localStorage.removeItem(DEBUG_PANEL_KEY);
  } catch {
    /* ignore */
  }
}

export function useDebugPanel(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => getDebugPanelEnabled());
  const set = useCallback((v: boolean) => {
    setDebugPanelEnabled(v);
    setOn(v);
  }, []);
  return [on, set];
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
