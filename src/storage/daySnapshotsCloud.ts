/**
 * Cloud sync for daySnapshots — opt-in via Settings toggle.
 *
 * Local source of truth: IDB store `daySnapshots`, capped at
 * SNAPSHOT_HISTORY_CAP = 20. Cloud mirror: ward_helper_backup rows with
 * blob_type='day-snapshot' and blob_id = snapshot.id (YYYY-MM-DD), keyed
 * per user via the same anon-auth + username bridge as patient/note blobs.
 *
 * Encryption posture matches saveBoth: AES-GCM 256 ciphertext only,
 * key derived via PBKDF2(600,000) from the user's login password. Each
 * push uses a fresh salt + IV.
 *
 * Cap mirroring: after each successful push, the local IDB list of
 * snapshot IDs is sent to ward_helper_evict_day_snapshots(p_username,
 * p_keep_ids), which deletes cloud day-snapshot rows whose blob_id is no
 * longer in the local set. RLS blocks raw client DELETE on this table
 * (see migration 0002), so the SECURITY DEFINER RPC is the only path.
 *
 * Trigger: src/ui/App.tsx subscribes to the `ward-helper:day-archived`
 * event and calls `pushLatestDaySnapshotIfEnabled` once per archive. The
 * helper is responsible for the full 3-state guard (toggle off / guest /
 * no-password = silent skip) so the App-level subscriber stays trivial.
 */
import {
  encryptForCloud,
  pushBlob,
  getSupabase,
} from '@/storage/cloud';
import { listDaySnapshots, type DaySnapshot } from '@/storage/rounds';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { getCurrentUser, getLastLoginPasswordOrNull } from '@/auth/auth';
import { putDaySnapshot } from '@/storage/rounds';
import { decryptFromCloud, base64ToBytes, type CloudBlobRow } from '@/storage/cloud';
import { pushBreadcrumb } from '@/ui/components/MobileDebugPanel';

/** localStorage key for the opt-in toggle. */
export const DAY_SNAPSHOT_CLOUD_SYNC_KEY = 'ward-helper.cloudSyncDaySnapshots';

export function getDaySnapshotCloudSyncEnabled(): boolean {
  try {
    return localStorage.getItem(DAY_SNAPSHOT_CLOUD_SYNC_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDaySnapshotCloudSyncEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(DAY_SNAPSHOT_CLOUD_SYNC_KEY, '1');
    else localStorage.removeItem(DAY_SNAPSHOT_CLOUD_SYNC_KEY);
  } catch {
    /* localStorage may be disabled in private mode — non-fatal */
  }
}

export type PushOutcome =
  | { kind: 'skipped'; reason: 'toggle-off' | 'guest' | 'no-login' | 'no-snapshots' }
  | { kind: 'pushed'; pushedId: string; evictedCount: number }
  | { kind: 'error'; message: string };

/**
 * Push the most recent local snapshot to the cloud, then mirror the local
 * cap by evicting cloud rows no longer in the local set.
 *
 * Idempotent on re-archive of the same date: the snapshot's blob_id IS the
 * date, so a re-archive upserts the same row instead of forking a duplicate.
 *
 * Returns a structured outcome the caller (App.tsx subscriber + tests) can
 * branch on. Never throws on the happy path; transport errors land in
 * `{ kind: 'error' }` so the breadcrumb stream captures them without
 * crashing the archive flow.
 */
export async function pushLatestDaySnapshotIfEnabled(): Promise<PushOutcome> {
  if (!getDaySnapshotCloudSyncEnabled()) {
    return { kind: 'skipped', reason: 'toggle-off' };
  }
  const user = getCurrentUser();
  if (!user) {
    return { kind: 'skipped', reason: 'guest' };
  }
  const pass = getLastLoginPasswordOrNull();
  if (!pass) {
    return { kind: 'skipped', reason: 'no-login' };
  }

  const snaps = await listDaySnapshots();
  if (snaps.length === 0) {
    return { kind: 'skipped', reason: 'no-snapshots' };
  }
  // listDaySnapshots returns newest-first (sorted by archivedAt desc).
  const latest = snaps[0]!;
  const username = user.username;

  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey(pass, salt);
    const sealed = await encryptForCloud(latest, key, salt);
    await pushBlob('day-snapshot', latest.id, sealed, username);

    pushBreadcrumb('daySnapshot.push.ok', {
      id: latest.id,
      patientCount: latest.patients.length,
    });

    const keepIds = snaps.map((s) => s.id);
    const evictedCount = await evictStaleCloudSnapshots(username, keepIds);

    if (evictedCount > 0) {
      pushBreadcrumb('daySnapshot.evict', { evicted: evictedCount, kept: keepIds.length });
    }

    return { kind: 'pushed', pushedId: latest.id, evictedCount };
  } catch (e) {
    const msg = (e as Error).message ?? 'unknown error';
    pushBreadcrumb('daySnapshot.push.fail', { error: msg });
    return { kind: 'error', message: msg };
  }
}

/**
 * Mirror the local cap to the cloud by deleting day-snapshot rows whose
 * blob_id is not in `keepIds`. Routed through the
 * `ward_helper_evict_day_snapshots` SECURITY DEFINER RPC (migration 0008)
 * because RLS blocks raw client DELETE on ward_helper_backup.
 *
 * Returns the count of rows deleted (0 if the RPC's defensive checks
 * prevented the call from running). RPC errors propagate so the caller
 * can breadcrumb them.
 */
export async function evictStaleCloudSnapshots(
  username: string,
  keepIds: string[],
): Promise<number> {
  if (!username || !username.trim()) return 0;
  if (keepIds.length === 0) return 0;
  const sb = await getSupabase();
  const { data, error } = await sb.rpc('ward_helper_evict_day_snapshots', {
    p_username: username.trim(),
    p_keep_ids: keepIds,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/**
 * Decrypt a cloud day-snapshot row and write it to local IDB. Used by
 * restoreFromCloud's per-row loop. Caller has already filtered for
 * blob_type='day-snapshot'.
 *
 * Returns true on successful apply. Throws on decrypt failure so the
 * outer restore loop's try/catch lands the row in `skipped` with the
 * decryption error reason.
 */
export async function applyDaySnapshotFromCloudRow(
  row: CloudBlobRow,
  passphrase: string,
): Promise<boolean> {
  const salt = base64ToBytes(row.salt);
  const iv = base64ToBytes(row.iv);
  const ct = base64ToBytes(row.ciphertext);
  const key = await deriveAesKey(passphrase, salt);
  const decoded = await decryptFromCloud<DaySnapshot>(ct, iv, key);
  // Defensive: a corrupted-but-decryptable payload (wrong shape) lands
  // here. Reject fast rather than putting a garbage row that crashes the
  // morning-rounds renderer.
  if (
    !decoded ||
    typeof decoded.id !== 'string' ||
    typeof decoded.archivedAt !== 'number' ||
    !Array.isArray(decoded.patients)
  ) {
    throw new Error('day-snapshot blob failed shape check');
  }
  await putDaySnapshot(decoded);
  return true;
}
