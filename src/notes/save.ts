import { putPatient, putNote, type Patient, type Note, type NoteType } from '@/storage/indexed';
import { encryptForCloud, pushBlob } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { getPassphrase } from '@/ui/hooks/useSettings';
import type { ParseFields } from '@/agent/tools';

export interface SaveResult {
  patientId: string;
  noteId: string;
  cloudPushed: boolean;
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

  const pass = getPassphrase();
  let cloudPushed = false;
  if (pass) {
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveAesKey(pass, salt);
      const sealedP = await encryptForCloud(patient, key, salt);
      const sealedN = await encryptForCloud(note, key, salt);
      await pushBlob('patient', patientId, sealedP);
      await pushBlob('note', noteId, sealedN);
      cloudPushed = true;
    } catch (e) {
      console.warn('cloud push failed:', e);
    }
  }

  return { patientId, noteId, cloudPushed };
}
