import { listPatients, listAllNotes } from '@/storage/indexed';
import { encryptForCloud, pushBlob, pushCanary } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { pushApiKeyToCloud, hasApiKey } from '@/crypto/keystore';

export interface PushAllResult {
  pushedPatients: number;
  pushedNotes: number;
  pushedApiKey: boolean;
  pushedCanary: boolean;
  failed: Array<{ blob_type: string; blob_id: string; reason: string }>;
}

/**
 * Re-push every local patient + note + api-key + canary to Supabase under
 * the given passphrase. Used by the "גיבוי לענן עכשיו" Settings button.
 *
 * Idempotent: each blob_id is upserted (onConflict on user_id+blob_type+blob_id).
 *
 * Per-row errors don't abort the whole push — they're collected in `failed`
 * so the UI can surface a partial-success report.
 */
export async function pushAllToCloud(
  passphrase: string,
  username: string | null,
): Promise<PushAllResult> {
  const result: PushAllResult = {
    pushedPatients: 0,
    pushedNotes: 0,
    pushedApiKey: false,
    pushedCanary: false,
    failed: [],
  };

  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveAesKey(passphrase, salt);

  try {
    await pushCanary(key, salt, username);
    result.pushedCanary = true;
  } catch (e) {
    result.failed.push({
      blob_type: 'canary',
      blob_id: '__canary__',
      reason: (e as Error).message ?? 'unknown',
    });
  }

  for (const patient of await listPatients()) {
    try {
      const sealed = await encryptForCloud(patient, key, salt);
      await pushBlob('patient', patient.id, sealed, username);
      result.pushedPatients++;
    } catch (e) {
      result.failed.push({
        blob_type: 'patient',
        blob_id: patient.id,
        reason: (e as Error).message ?? 'unknown',
      });
    }
  }

  for (const note of await listAllNotes()) {
    try {
      const sealed = await encryptForCloud(note, key, salt);
      await pushBlob('note', note.id, sealed, username);
      result.pushedNotes++;
    } catch (e) {
      result.failed.push({
        blob_type: 'note',
        blob_id: note.id,
        reason: (e as Error).message ?? 'unknown',
      });
    }
  }

  if (await hasApiKey()) {
    try {
      const out = await pushApiKeyToCloud(key, salt, username);
      result.pushedApiKey = out.pushed;
    } catch (e) {
      result.failed.push({
        blob_type: 'api-key',
        blob_id: '__user_default__',
        reason: (e as Error).message ?? 'unknown',
      });
    }
  }

  return result;
}
