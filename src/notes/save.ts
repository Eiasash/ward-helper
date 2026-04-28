import {
  putPatient,
  putNote,
  upsertPatientByTz,
  type Patient,
  type Note,
  type NoteType,
} from '@/storage/indexed';
import { encryptForCloud, pushBlob } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { getPassphrase } from '@/ui/hooks/useSettings';
import { finalizeSessionFor } from '@/agent/costs';
import { markSyncedNow, notifyNotesChanged } from '@/ui/hooks/useGlanceable';
import type { ParseFields } from '@/agent/tools';
import type { SafetyFlags } from '@/safety/types';

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
  safetyFlags?: SafetyFlags,
): Promise<SaveResult> {
  const now = Date.now();
  const noteId = crypto.randomUUID();

  // Dedupe by ת.ז. so a second admission for the same patient lands on
  // the existing patient row instead of forking a duplicate. With no tz
  // (rare — extract failed on identity), upsertPatientByTz mints a new id.
  const patient = await upsertPatientByTz({
    name: patientFields.name ?? '',
    teudatZehut: patientFields.teudatZehut ?? '',
    dob: patientFields.dob ?? '',
    room: patientFields.room ?? null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  const patientId = patient.id;

  const note: Note = {
    id: noteId,
    patientId,
    type: noteType,
    bodyHebrew,
    structuredData: patientFields as Record<string, unknown>,
    createdAt: now,
    updatedAt: now,
    ...(safetyFlags ? { safetyFlags } : {}),
  };

  await putNote(note);
  // Header-strip queue depth subscribes; nudge it after every save.
  notifyNotesChanged();

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
    // Header-strip "last sync" relies on this — marker for the glanceable
    // header so the rounding doctor knows the cloud backup is current.
    markSyncedNow();
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

import {
  pullAllBlobs,
  decryptFromCloud,
  base64ToBytes,
  type CloudBlobRow,
} from '@/storage/cloud';

export interface RestoreResult {
  scanned: number;
  restoredPatients: number;
  restoredNotes: number;
  skipped: Array<{ blob_type: string; blob_id: string; reason: string }>;
}

/**
 * Pull every encrypted blob from the cloud and re-persist it locally.
 *
 * Workflow:
 *   1. user sets passphrase in Settings (same one used for push)
 *   2. user taps "Restore from cloud" in Settings
 *   3. this function runs, returns a summary
 *
 * Each blob carries its own salt (chosen fresh at push time), so the AES key
 * is re-derived per-blob. That's ~300ms PBKDF2 per blob on a phone — slow,
 * but restore is a one-time operation when setting up a new device, so the
 * UX tradeoff is acceptable. An optimization would be to group-push all
 * blobs with a shared salt, but that complicates the pushBlob contract and
 * the gain is small (a restore of 100 blobs = 30s).
 *
 * Local writes go through the same putPatient/putNote path used by
 * saveBoth, so RLS-compliant cloud data and local data stay schema-aligned.
 * Existing local rows are overwritten if IDs match (upsert semantics from
 * IndexedDB's put()).
 *
 * Failure handling: a single corrupt blob (wrong passphrase, malformed
 * payload, schema mismatch) does NOT abort the whole restore. It lands in
 * `skipped` and the rest continues. This matters because of the
 * backward-compat case: blobs pushed by old versions with different schema
 * keys shouldn't brick a restore.
 */
export async function restoreFromCloud(passphrase: string): Promise<RestoreResult> {
  if (!passphrase) throw new Error('passphrase required for restore');

  const rows: CloudBlobRow[] = await pullAllBlobs();
  const result: RestoreResult = {
    scanned: rows.length,
    restoredPatients: 0,
    restoredNotes: 0,
    skipped: [],
  };

  for (const row of rows) {
    try {
      const salt = base64ToBytes(row.salt);
      const iv = base64ToBytes(row.iv);
      const ct = base64ToBytes(row.ciphertext);
      const key = await deriveAesKey(passphrase, salt);
      const decrypted = await decryptFromCloud<Patient | Note>(ct, iv, key);

      if (row.blob_type === 'patient') {
        await putPatient(decrypted as Patient);
        result.restoredPatients++;
      } else if (row.blob_type === 'note') {
        await putNote(decrypted as Note);
        result.restoredNotes++;
      } else {
        result.skipped.push({
          blob_type: row.blob_type,
          blob_id: row.blob_id,
          reason: 'unknown blob_type',
        });
      }
    } catch (e) {
      // Most likely: wrong passphrase (AES-GCM auth tag fails). Could also
      // be a schema mismatch. Don't abort — capture and continue.
      result.skipped.push({
        blob_type: row.blob_type,
        blob_id: row.blob_id,
        reason: (e as Error).message ?? 'decrypt failed',
      });
    }
  }

  return result;
}
