import { putPatient, putNote, type Patient, type Note } from '@/storage/indexed';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { aesDecrypt } from '@/crypto/aes';

export interface ImportOpts {
  /** Required if the file's `encrypted` flag is true. */
  loginPassword?: string;
}

export interface ImportResult {
  imported: { patients: number; notes: number };
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Restore from a file produced by exportLocalBackup. Each patient + note goes
 * through putPatient/putNote so IDB upsert semantics overwrite local rows
 * with the same IDs (matching restoreFromCloud's behavior).
 */
export async function importLocalBackup(
  file: File,
  opts: ImportOpts,
): Promise<ImportResult> {
  const text = await file.text();
  const body = JSON.parse(text) as
    | { v: 1; encrypted: false; patients: Patient[]; notes: Note[] }
    | { v: 1; encrypted: true; payload: string; iv: string; salt: string };
  if (body.v !== 1) {
    throw new Error('unsupported backup file version');
  }

  let patients: Patient[];
  let notes: Note[];

  if (body.encrypted) {
    if (!opts.loginPassword) {
      throw new Error('loginPassword required to decrypt this backup');
    }
    const salt = base64ToBytes(body.salt);
    const iv = base64ToBytes(body.iv);
    const ct = base64ToBytes(body.payload);
    const key = await deriveAesKey(opts.loginPassword, salt);
    let inner: string;
    try {
      inner = await aesDecrypt(ct, iv, key);
    } catch {
      throw new Error('decrypt failed — wrong login password?');
    }
    const parsed = JSON.parse(inner) as { patients: Patient[]; notes: Note[] };
    patients = parsed.patients;
    notes = parsed.notes;
  } else {
    patients = body.patients;
    notes = body.notes;
  }

  for (const p of patients) await putPatient(p);
  for (const n of notes) await putNote(n);

  return { imported: { patients: patients.length, notes: notes.length } };
}
