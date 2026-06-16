-- 0009: cloud-delete path for ward_helper_backup — closes the orphaned-PHI gap.
--
-- ⚠️ NOT YET APPLIED. This file ships in PR for Eias to review and apply
--    manually (supabase db push / SQL editor). The client cloud-delete added
--    alongside it (src/storage/cloud.ts deleteBlob/deleteByUsername,
--    src/notes/cloudDelete.ts) degrades gracefully — best-effort, never
--    blocks the local delete — if this migration is not yet deployed.
--
-- The gap
-- -------
-- Deleting a note (NoteViewer.performDelete -> deleteNote in
-- src/storage/indexed.ts) removed the note from IndexedDB ONLY. Its AES-GCM
-- ciphertext stayed in ward_helper_backup forever, with no cloud-delete path
-- anywhere — so the "deleted" note resurrected on a fresh-device restore
-- (pullByUsername / pullAllBlobs re-pull every surviving row). That is
-- undeleted PHI-at-rest.
--
-- Two delete paths, mirroring the two existing pull paths
-- ------------------------------------------------------
--   1. Same-device  : a row pushed from THIS device under THIS anon
--      auth.uid(). Migrations 0001/0002 deliberately omitted a DELETE policy
--      ("append-only from the client's view"), so a client `.delete()`
--      silently removes zero rows today. Part 1 below adds a NARROW DELETE
--      policy scoped to `user_id = auth.uid()` so the client's own-row
--      delete works. This is the minimal relaxation of the no-DELETE rule:
--      a session can delete ONLY rows it owns by auth.uid — never another
--      user's — so the "client bug -> mass-DELETE of someone else's backup"
--      threat that motivated the original omission does not apply. The blast
--      radius of a client bug is the caller's own rows, which it can already
--      overwrite via the UPDATE policy.
--
--   2. Cross-device : a row pushed from ANOTHER device under a DIFFERENT anon
--      auth.uid but the SAME app_users username. An auth.uid-scoped delete
--      can never reach it (different auth.uid). Part 2 adds the SECURITY
--      DEFINER RPC ward_helper_delete_by_username, which MIRRORS migration
--      0003's ward_helper_pull_by_username: it bypasses the auth.uid() RLS
--      boundary because cross-device deletes cross that boundary exactly as
--      cross-device pulls do.
--
-- Threat model (RPC) — identical posture to ward_helper_pull_by_username
-- and ward_helper_dedupe_stale_canaries (migration 0007): the username
-- column is set client-side from app_users login state and is accepted on
-- faith; knowing a username lets you delete that username's encrypted blobs.
-- This matches the existing pull-by-username posture exactly — the
-- AES-GCM(256)/PBKDF2(600k) layer is the confidentiality cap, and a delete
-- only removes already-encrypted ciphertext the username owner could already
-- fetch. The blob is keyed by (username, blob_type, blob_id), so a delete is
-- a precise single-row operation, not a bulk wipe.
--
-- This migration is idempotent — safe to re-run.

-- 1) Narrow DELETE RLS policy: a session may delete ONLY its own rows.
--    Replaces the deliberate no-DELETE-policy posture of 0001/0002 with the
--    minimal policy needed for the same-device deleteBlob path. Still NEVER
--    "FOR ALL"; still scoped to user_id = auth.uid().
drop policy if exists "owner-delete" on public.ward_helper_backup;

create policy "owner-delete" on public.ward_helper_backup
  for delete using (user_id = auth.uid());

-- 2) Cross-device delete RPC. SECURITY DEFINER bypasses the auth.uid()
--    DELETE policy above, which is the whole point — a row pushed from
--    another device has a different anon auth.users.id, so the policy check
--    would block a legitimate cross-device delete. Mirrors
--    ward_helper_pull_by_username (0003): same auth posture, same
--    `SET search_path TO 'pg_catalog', 'public'` hygiene, same GRANT.
create or replace function public.ward_helper_delete_by_username(
  p_username   text,
  p_blob_type  text,
  p_blob_id    text
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_username text;
  v_deleted  integer;
begin
  -- Defensive: NULL/empty username matches no rows. We never write an empty
  -- username (pushBlob coerces blank -> NULL), so an empty match could only
  -- group unrelated null-username rows — refuse it outright.
  v_username := nullif(trim(coalesce(p_username, '')), '');
  if v_username is null then
    return 0;
  end if;

  delete from public.ward_helper_backup b
  where b.username   = v_username
    and b.blob_type  = p_blob_type
    and b.blob_id    = p_blob_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

-- 3) GRANT EXECUTE — anon and authenticated. Mirrors the GRANT on
--    ward_helper_pull_by_username (0003) and
--    ward_helper_dedupe_stale_canaries (0007).
grant execute on function public.ward_helper_delete_by_username(text, text, text)
  to anon, authenticated;
