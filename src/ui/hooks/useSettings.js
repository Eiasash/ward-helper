import { useState, useEffect, useCallback } from 'react';
import { hasApiKey, loadApiKey, saveApiKey, clearApiKey } from '@/crypto/keystore';
// Passphrase lives in memory only, auto-clears after idle timeout.
let passphraseMemory = null;
let passphraseSetAt = 0;
const IDLE_MS = 15 * 60 * 1000;
export function setPassphrase(p) {
    passphraseMemory = p;
    passphraseSetAt = Date.now();
}
export function getPassphrase() {
    if (!passphraseMemory)
        return null;
    if (Date.now() - passphraseSetAt > IDLE_MS) {
        passphraseMemory = null;
        return null;
    }
    return passphraseMemory;
}
export function clearPassphrase() {
    passphraseMemory = null;
    passphraseSetAt = 0;
}
export function useApiKey() {
    const [present, setPresent] = useState(null);
    useEffect(() => {
        hasApiKey().then(setPresent);
    }, []);
    const save = useCallback(async (k) => {
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
