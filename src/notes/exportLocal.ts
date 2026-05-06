import { listPatients, listAllNotes, getSettings } from '@/storage/indexed';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { aesEncrypt } from '@/crypto/aes';

export interface ExportOpts {
  /** When true, the file is encrypted with the user's login password. */
  encryptWithLoginPassword: boolean;
  /** Required when encryptWithLoginPassword=true. */
  loginPassword?: string;
}

interface PlainBackup {
  v: 1;
  exportedAt: number;
  encrypted: false;
  patients: unknown[];
  notes: unknown[];
  settings: { apiKeyXor: number[]; deviceSecret: number[] };
}

interface EncryptedBackup {
  v: 1;
  exportedAt: number;
  encrypted: true;
  payload: string;
  iv: string;
  salt: string;
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/**
 * Build a Blob containing the user's full local state. Default flow is
 * encrypted-with-login-password (per spec §7.2 option d). Caller wires it to
 * <a download>; this function does not touch the DOM.
 */
export async function exportLocalBackup(opts: ExportOpts): Promise<Blob> {
  const patients = await listPatients();
  const notes = await listAllNotes();
  const settingsRow = await getSettings();
  const settings = {
    apiKeyXor: Array.from(settingsRow?.apiKeyXor ?? new Uint8Array(0)),
    deviceSecret: Array.from(settingsRow?.deviceSecret ?? new Uint8Array(0)),
  };

  if (!opts.encryptWithLoginPassword) {
    const body: PlainBackup = {
      v: 1,
      exportedAt: Date.now(),
      encrypted: false,
      patients,
      notes,
      settings,
    };
    return new Blob([JSON.stringify(body)], { type: 'application/json' });
  }

  if (!opts.loginPassword) {
    throw new Error('loginPassword required when encryptWithLoginPassword=true');
  }

  const inner = JSON.stringify({ patients, notes, settings });
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveAesKey(opts.loginPassword, salt);
  const { iv, ciphertext } = await aesEncrypt(inner, key);
  const body: EncryptedBackup = {
    v: 1,
    exportedAt: Date.now(),
    encrypted: true,
    payload: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
  return new Blob([JSON.stringify(body)], { type: 'application/json' });
}
