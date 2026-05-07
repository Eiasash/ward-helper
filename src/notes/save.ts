import {
  putPatient,
  putNote,
  upsertPatientByTz,
  type Patient,
  type Note,
  type NoteType,
} from '@/storage/indexed';
import { encryptForCloud, pushBlob, pushCanary } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import {
  pushApiKeyToCloud,
  applyApiKeyFromCloud,
  API_KEY_BLOB_ID,
} from '@/crypto/keystore';
import { finalizeSessionFor } from '@/agent/costs';
import { markSyncedNow, notifyNotesChanged } from '@/ui/hooks/glanceableEvents';
// ESM cycle with @/auth/auth — auth.ts imports resetCanaryArmed from this
// module. Both directions resolve to runtime function refs only, NEVER
// invoked at module-eval time, so live-binding semantics keep the cycle
// safe. If you add a top-level call to either side, the cycle becomes
// init-order sensitive and the binding may be in TDZ — relocate it.
import { getCurrentUser, getLastLoginPasswordOrNull } from '@/auth/auth';
import { pushBreadcrumb } from '@/ui/components/MobileDebugPanel';
import type { ParseFields } from '@/agent/tools';
import type { SafetyFlags } from '@/safety/types';

// Canary instrumentation (v1.36.0): push the known-plaintext canary blob
// opportunistically from saveBoth so all users — not just those who hit
// Settings → "Backup all to cloud" — get the fail-fast wrong-password UX
// in restoreFromCloud. Gated to once per JS session because pushBlob is
// upsert-safe but the round-trip cost on every save is wasteful. Failure
// in the canary push is non-fatal: the primary patient+note push has
// already succeeded by the time we get here, so the worst case is
// degraded wrong-password UX, not data loss.
let canaryArmedThisSession = false;
let lastCanaryPushOutcome: 'ok' | 'fail' | null = null;

/** Test-only: simulate a fresh JS session without process restart. */
export function _resetCanaryStateForTests(): void {
  canaryArmedThisSession = false;
  lastCanaryPushOutcome = null;
}

/** Test-only: force the armed flag without running saveBoth's full path. */
export function _setCanaryArmedForTests(armed: boolean): void {
  canaryArmedThisSession = armed;
}

/**
 * Production helper called by auth.ts::logout. The canary-armed flag is
 * a JS module global and survives logout/login on the same tab, so without
 * this reset, user B logging in after user A on the same device would skip
 * their first canary push — leaving B in the pre-Phase-B state where a
 * fresh-device wrong-password attempt falls through to silent bulk-skip.
 *
 * Distinct from `_resetCanaryStateForTests` (test affordance) by name and
 * intent: this is a contract used by production code and must not also
 * clear `lastCanaryPushOutcome` (which is per-process and helpful for
 * diagnostics that the user might inspect after their next save).
 */
export function resetCanaryArmed(): void {
  canaryArmedThisSession = false;
}

/** Read-only getter — useful for diagnostics and the cross-user logout test. */
export function isCanaryArmedThisSession(): boolean {
  return canaryArmedThisSession;
}

/** For MobileDebugPanel diagnostic — surfaces the last push outcome. */
export function getLastCanaryPushOutcome(): 'ok' | 'fail' | null {
  return lastCanaryPushOutcome;
}

async function armCanaryOnce(
  key: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  username: string | null,
  trigger: 'save' | 'login-restore',
): Promise<void> {
  if (canaryArmedThisSession) return;
  const t0 = Date.now();
  pushBreadcrumb('canary.push.start', { username, trigger });
  try {
    await pushCanary(key, salt, username);
    canaryArmedThisSession = true;
    lastCanaryPushOutcome = 'ok';
    pushBreadcrumb('canary.push.ok', { ms: Date.now() - t0 });
    if (trigger === 'login-restore') {
      pushBreadcrumb('canary.backfill', { trigger: 'login-restore' });
    }
  } catch (err) {
    lastCanaryPushOutcome = 'fail';
    pushBreadcrumb('canary.push.fail', { error: String(err) });
    // Swallow — caller's primary work already succeeded.
  }
}

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

  // 3-state design: guests get IndexedDB only — no pushBlob, no canary
  // arming, no Supabase round-trip at all. Logged-in users with the
  // login password in memory follow the encrypted-backup path. Logged-in
  // users WITHOUT the password (post-reload pre-relogin) skip cloud and
  // the next login will rehydrate the stash.
  const user = getCurrentUser();
  if (!user) {
    return {
      patientId,
      noteId,
      cloudPushed: false,
      cloudSkippedReason: 'guest',
    };
  }
  const pass = getLastLoginPasswordOrNull();
  if (!pass) {
    return {
      patientId,
      noteId,
      cloudPushed: false,
      cloudSkippedReason: 'no-login',
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
    // When app_users-authed, attach `username` to each push so the row
    // becomes reachable on the user's other devices via the
    // ward_helper_pull_by_username RPC. Guests pass null and stay
    // per-anon-user-id (existing posture, unchanged).
    const username = getCurrentUser()?.username ?? null;
    await pushBlob('patient', patientId, sealedP, username);
    await pushBlob('note', noteId, sealedN, username);
    // Cross-device API key sync (Option A): if the user has a local
    // Anthropic API key set, push it as an 'api-key' blob using the same
    // AES key + salt derived above. No-op if no local key is set. Failure
    // here is non-fatal — the patient + note already pushed.
    try {
      await pushApiKeyToCloud(key, salt, username);
    } catch {
      // Don't fail the save just because the api-key sync hiccuped.
      // The api-key push is a convenience; the note push is the contract.
    }
    // Canary push — once per JS session, reuses key+salt from the save
    // derivation above. Pre-v1.36.0 the canary was Settings-only, so
    // organic-flow users saw bulk-skip rather than the helpful
    // wrong-password warning on a fresh-device restore. armCanaryOnce
    // never throws; failure is recorded in the breadcrumb stream only.
    await armCanaryOnce(key, salt, username, 'save');
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
  pullByUsername,
  decryptFromCloud,
  base64ToBytes,
  verifyCanary,
  type CloudBlobRow,
} from '@/storage/cloud';

export interface RestoreResult {
  scanned: number;
  restoredPatients: number;
  restoredNotes: number;
  /**
   * 1 if the user's api-key blob was found and applied to the local
   * keystore, 0 if no api-key blob was present. (Decode failure or
   * schema mismatch lands in `skipped`.)
   */
  restoredApiKey: 0 | 1;
  /**
   * True when the canary check failed before iterating any rows. The UI uses
   * this to show "wrong passphrase" specifically (instead of generic "N
   * skipped"). Mutually exclusive with restoredPatients/Notes/ApiKey > 0.
   */
  wrongPassphrase: boolean;
  skipped: Array<{ blob_type: string; blob_id: string; reason: string }>;
  /**
   * Which path the rows came from. 'username' = cross-device pull via
   * the migration-0003 RPC (works on a fresh device after app_users
   * login). 'anon' = the legacy per-Supabase-anon-user fallback (works
   * for guests AND for backward compat with pre-bridge data).
   */
  source: 'username' | 'anon';
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

  // 3-state design: guests have no cloud presence — restore is a logged-in
  // operation. Returning a synthetic empty result (no network) so callers
  // (Settings.tsx, post-login banner) can render a clear "log in to restore"
  // affordance instead of attempting a doomed Supabase round-trip.
  const user = getCurrentUser();
  if (!user) {
    return {
      scanned: 0,
      restoredPatients: 0,
      restoredNotes: 0,
      restoredApiKey: 0,
      wrongPassphrase: false,
      skipped: [],
      source: 'anon',
    };
  }

  // Canary fail-fast: probe a single tiny blob with the passphrase before
  // pulling N rows. Wrong passphrase exits in one decrypt rather than N.
  const verifyT0 = Date.now();
  const canaryStatus = await verifyCanary(passphrase, user?.username ?? null);
  pushBreadcrumb('canary.verify', {
    result: canaryStatus,
    ms: Date.now() - verifyT0,
  });
  if (canaryStatus === 'wrong-passphrase') {
    return {
      scanned: 0,
      restoredPatients: 0,
      restoredNotes: 0,
      restoredApiKey: 0,
      wrongPassphrase: true,
      skipped: [],
      source: user ? 'username' : 'anon',
    };
  }
  const rows: CloudBlobRow[] = user
    ? await pullByUsername(user.username)
    : await pullAllBlobs();
  const result: RestoreResult = {
    scanned: rows.length,
    restoredPatients: 0,
    restoredNotes: 0,
    restoredApiKey: 0,
    wrongPassphrase: false,
    skipped: [],
    source: user ? 'username' : 'anon',
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
      } else if (row.blob_type === 'canary') {
        // Already verified at top of function; ignore at row level.
        continue;
      } else if (row.blob_type === 'api-key' && row.blob_id === API_KEY_BLOB_ID) {
        // API-key blobs go through their own apply path (writes the
        // keystore via saveApiKey internally). The decrypted payload was
        // already consumed above by decryptFromCloud<Patient | Note>;
        // we re-decrypt with the api-key blob shape here. Cheap because
        // PBKDF2 was the expensive part — already done.
        const applied = await applyApiKeyFromCloud(ct, iv, key);
        if (applied) {
          result.restoredApiKey = 1;
        } else {
          result.skipped.push({
            blob_type: row.blob_type,
            blob_id: row.blob_id,
            reason: 'api-key blob failed v:1 schema check',
          });
        }
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

  // Eager canary backfill: when the cloud has data but no canary blob
  // (pre-v1.36.0 accounts) AND we successfully decrypted ≥1 row, push a
  // canary now. The ≥1 decrypt is the proof that `passphrase` is the
  // correct one — without it we'd risk writing a canary that disagrees
  // with the user's existing data. Future fresh-device restores will
  // then get the fast-fail wrong-password UX.
  if (
    canaryStatus === 'absent' &&
    result.restoredPatients + result.restoredNotes > 0
  ) {
    const backfillSalt = crypto.getRandomValues(
      new Uint8Array(16),
    ) as Uint8Array<ArrayBuffer>;
    const backfillKey = await deriveAesKey(passphrase, backfillSalt);
    await armCanaryOnce(
      backfillKey,
      backfillSalt,
      user?.username ?? null,
      'login-restore',
    );
  }

  return result;
}
