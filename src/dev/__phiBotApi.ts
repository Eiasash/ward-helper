/**
 * Bot-only PHI seeding adapter — exposes the existing crypto + storage
 * primitives to `window` for Playwright `page.evaluate()` use. Strictly
 * gated on `localStorage['ward-helper.botApi'] === '1'`; the module
 * imports ship in the bundle but the attachment function is a strict
 * no-op without the flag set.
 *
 * Required by `scripts/lib/scenPhiColdUnlock.mjs` to satisfy the audit
 * spec (`docs/audit/2026-05-18-phi-unlock-scenario-kickoff.md`) §3 PROBE
 * TRAP — the wrong-password leg of that scenario MUST seed >=1 real
 * sealed row under a known key, not flip a sentinel. Browser-runtime
 * code cannot import compiled modules by name; the bot therefore needs
 * a window-attached surface to call them.
 *
 * Security profile — the localStorage gate is the only thing between
 * production users and a window-attached `derivePhiKey`. Threat model:
 * an XSS payload already has full window access and can call any
 * imported module via bundle archaeology; this surface makes that
 * uplift cheaper but does not introduce a new capability. Production
 * users never set the flag; the attachment IIFE returns immediately
 * if the flag is absent or invalid.
 *
 * Not a coverage badge for the PHI feature — see tests/phiUnlock.test.ts
 * + Unlock.test.tsx for unit coverage. This file's only purpose is
 * test-runtime seeding from Playwright.
 */
import {
  derivePhiKey,
  setPhiKey,
  clearPhiKey,
  hasPhiKey,
  loadOrCreatePhiSalt,
  sealRow,
} from '@/crypto/phi';
import { getDb, patchSettings } from '@/storage/indexed';

export interface PhiBotApi {
  derivePhiKey: typeof derivePhiKey;
  setPhiKey: typeof setPhiKey;
  clearPhiKey: typeof clearPhiKey;
  hasPhiKey: typeof hasPhiKey;
  loadOrCreatePhiSalt: typeof loadOrCreatePhiSalt;
  sealRow: typeof sealRow;
  /**
   * Convenience: seal one synthetic patient under a key derived from
   * `password`, write it to the `patients` store, set the v7 sentinel,
   * clear the key. Returns the patient ID for the bot to reference.
   *
   * Uses the same `setPhiKey` + `sealRow` path the production backfill
   * uses, so the probe at unlock time sees genuinely-sealed ciphertext
   * — not a sentinel flip.
   */
  seedOneSealedPatient(password: string): Promise<string>;
}

declare global {
  interface Window {
    __phiBotApi?: PhiBotApi;
  }
}

const BOT_API_FLAG = 'ward-helper.botApi';

export function attachPhiBotApiIfEnabled(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(BOT_API_FLAG) !== '1') return;
  } catch {
    return;
  }

  const seedOneSealedPatient: PhiBotApi['seedOneSealedPatient'] = async (
    password,
  ) => {
    const salt = await loadOrCreatePhiSalt();
    const key = await derivePhiKey(password, salt);
    setPhiKey(key);
    const now = Date.now();
    const patient = {
      id: `bot-phi-seed-${now}`,
      name: 'bot seed patient',
      teudatZehut: '000000000',
      dob: '',
      room: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    const enc = await sealRow(patient);
    const db = await getDb();
    await db.put('patients', { id: patient.id, enc } as never);
    await patchSettings({ phiEncryptedV7: true });
    clearPhiKey();
    return patient.id;
  };

  window.__phiBotApi = {
    derivePhiKey,
    setPhiKey,
    clearPhiKey,
    hasPhiKey,
    loadOrCreatePhiSalt,
    sealRow,
    seedOneSealedPatient,
  };
}
