import { deleteBlob, deleteByUsername, type CloudDeleteStatus } from '@/storage/cloud';
import { getCurrentUser } from '@/auth/auth';

/**
 * Best-effort cloud-delete for a note's encrypted backup row.
 *
 * Closes the orphaned-PHI gap: before this, deleting a note removed it from
 * IndexedDB only (see src/storage/indexed.ts deleteNote), leaving its
 * AES-GCM ciphertext in ward_helper_backup forever — so a "deleted" note
 * resurrected on a fresh-device restore. This removes the cloud row too.
 *
 * Routing MIRRORS the save/restore path exactly (src/notes/save.ts: push
 * routes by `getCurrentUser()?.username`; restoreFromCloud pulls via
 * `pullByUsername` when a username is present, else the per-anon path):
 *
 *   - app_users session present (username) -> deleteByUsername RPC. The row
 *     may have been pushed from another device under a different anon
 *     auth.uid, so an auth.uid-scoped delete could miss it. The SECURITY
 *     DEFINER RPC reaches it by username, the same routing key push uses.
 *   - guest / no username -> deleteBlob, scoped to the current anon
 *     auth.uid via RLS (the only rows a guest ever pushed).
 *
 * Best-effort by contract: never throws, returns a status. The caller has
 * already completed the authoritative local IndexedDB delete; a cloud-delete
 * failure (offline, RPC not yet deployed, RLS) must NOT block that or the
 * navigation away. Worst case the orphan persists until the next delete or a
 * future cleanup sweep — strictly better than today's guaranteed orphan.
 */
export async function deleteNoteFromCloud(noteId: string): Promise<CloudDeleteStatus> {
  const username = getCurrentUser()?.username ?? null;
  if (username && username.trim()) {
    return deleteByUsername('note', noteId, username);
  }
  return deleteBlob('note', noteId);
}
