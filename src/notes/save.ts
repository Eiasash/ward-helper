import { putPatient, putNote, type Patient, type Note, type NoteType } from '@/storage/indexed';
import { encryptForCloud, pushBlob } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { getPassphrase } from '@/ui/hooks/useSettings';
import { finalizeSessionFor } from '@/agent/costs';
import type { ParseFields } from '@/agent/tools';

export interface SaveResult {
  patientId: string;
  noteId: string;
  cloudPushed: boolean;
  /**
   * When cloudPushed is false, this explains why:
   *   - 'no-passphrase' = user hasn't set a cloud passphrase (expected, silent)
   *   - a string       = real error message from the push attempt; UI should warn
   */
  cloudSkippedReason: 'no-passphrase' | string | null;
}

export async function saveBoth(
  patientFields: ParseFields,
  noteType: NoteType,
  bodyHebrew: string,
): Promise<SaveResult> {
  const now = Date.now();
  const patientId = crypto.randomUUID();
  const noteId = crypto.randomUUID();

  const patient: Patient = {
    id: patientId,
    name: patientFields.name ?? '',
    teudatZehut: patientFields.teudatZehut ?? '',
    dob: '',
    room: patientFields.room ?? null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };

  const note: Note = {
    id: noteId,
    patientId,
    type: noteType,
    bodyHebrew,
    structuredData: patientFields as Record<string, unknown>,
    createdAt: now,
    updatedAt: now,
  };

  await putPatient(patient);
  await putNote(note);

  // Attribute this session's extract + emit token spend to the patient now
  // that the ID is known. Safe no-op if no session was open.
  finalizeSessionFor(patientId);

  const pass = getPassphrase();
  if (!pass) {
    return {
      patientId,
      noteId,
      cloudPushed: false,
      cloudSkippedReason: 'no-passphrase',
    };
  }

  try {
    // Single PBKDF2 derivation reused for both blobs. Same salt is safe
    // because AES-GCM uses a fresh IV per `encryptForCloud` call, and that's
    // what actually needs to be unique. Sharing the derivation saves ~300ms
    // of CPU time on every save.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey(pass, salt);
    const sealedP = await encryptForCloud(patient, key, salt);
    const sealedN = await encryptForCloud(note, key, salt);
    await pushBlob('patient', patientId, sealedP);
    await pushBlob('note', noteId, sealedN);
    return { patientId, noteId, cloudPushed: true, cloudSkippedReason: null };
  } catch (e) {
    // Don't throw — local save already succeeded. But DO report the reason
    // to the caller so the UI can surface a "local only" warning. Silent
    // swallowing was how we spent weeks thinking backups worked when they
    // didn't.
    return {
      patientId,
      noteId,
      cloudPushed: false,
      cloudSkippedReason: (e as Error).message ?? 'unknown error',
    };
  }
}
