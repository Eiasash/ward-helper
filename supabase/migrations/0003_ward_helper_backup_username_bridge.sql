-- ward-helper: option 2 hybrid bridge — username column + cross-device pull RPC.
--
-- Applied to Supabase project krmlzwwelqvlfslwltol on 2026-04-29 (platform
-- version 20260429T <ts>). This file is the canonical record alongside
-- 0001_ward_helper_backup.sql and 0002_ward_helper_backup_rls_harden.sql.
--
-- Decision context
-- ----------------
-- ward-helper has had cloud sync since pre-v1.29 via auth.signInAnonymously()
-- writing to ward_helper_backup with user_id = the per-device anon
-- Supabase user. Each device == a separate anon user → no cross-device sync.
--
-- v1.29.0 (2026-04-29) shipped app_users RPC auth (mirrors the FM/Pnimit/Geri
-- canonical pattern), but the cloud sync path was NOT migrated to use it.
-- This migration is the bridge: it adds a routing key (username) to the
-- existing schema without disturbing the 20 rows of pre-bridge data.
--
-- Encryption considerations
-- -------------------------
-- The AES-GCM 256 key is PBKDF2(600k iter)-derived from a separate
-- user-set "backup passphrase" held only in volatile JS memory
-- (src/ui/hooks/useSettings.ts), with a fresh random salt per row.
-- Cross-device decrypt therefore already works — the user types their
-- passphrase on the new device, fetches their rows, and the salt+iv
-- inside each row lets the client re-derive the key. The DB only needs
-- a routing key (username) to find the right rows.
--
-- Threat model
-- ------------
-- Knowing a username is enough to download encrypted blobs for that
-- username. PBKDF2(600k) + AES-GCM(256) is the cap. This is identical
-- to the *_backups posture for the other PWAs after Phase 2: knowing
-- the id (which == username for authed users) lets you download
-- encrypted backups; encryption is the actual protection.
--
-- What this migration does
-- ------------------------
-- 1. Adds `username text NULL` to ward_helper_backup. Existing 20 rows
--    keep working via the existing anon-user-id SELECT policy. Future
--    writes from authed clients populate username.
-- 2. Partial index on (username, blob_type, blob_id) WHERE username IS
--    NOT NULL — keeps index size proportional to authed-user rows only.
-- 3. New RPC ward_helper_pull_by_username(p_username) — SECURITY DEFINER,
--    LANGUAGE sql, returns the same column shape that pullAllBlobs in
--    src/storage/cloud.ts already consumes. Bypasses the auth.uid()-based
--    SELECT RLS policy because cross-device pulls cross the auth.uid()
--    boundary.
--
-- What this migration does NOT do (intentionally)
-- -----------------------------------------------
-- - Does NOT change RLS policies. Direct REST SELECT remains
--   per-anon-user-id-restricted (the existing posture).
-- - Does NOT migrate the existing 20 NULL-username rows. Those become
--   reachable across devices only after the original user logs in via
--   app_users on their original device and the client populates the
--   column on the next write. Pre-bridge data without a re-write stays
--   anon-user-id-only — acceptable, no data loss.
-- - Does NOT add a write-path RPC. Existing client INSERT (with user_id
--   from anon auth) just gains an optional username param.
--
-- Client wiring TODO (not in this migration)
-- ------------------------------------------
-- src/storage/cloud.ts pushBlob(): include `username` in upsert when
--   the user is logged in via app_users (read from auth state).
-- src/storage/cloud.ts: add pullByUsername(username) that calls the new
--   RPC, returning the same CloudBlobRow[] shape pullAllBlobs returns.
-- src/notes/restore.ts (or wherever restore lives): on a fresh device,
--   if the user logs in via app_users, prefer pullByUsername(username)
--   over the existing pullAllBlobs() (which is per-anon-user-id and
--   would return nothing on a fresh anon Supabase user).

-- 1) Column
ALTER TABLE public.ward_helper_backup
  ADD COLUMN IF NOT EXISTS username text NULL;

-- 2) Partial index — covers only post-bridge rows, keeps size minimal
CREATE INDEX IF NOT EXISTS ward_helper_backup_username_idx
  ON public.ward_helper_backup (username, blob_type, blob_id)
  WHERE username IS NOT NULL;

-- 3) Cross-device pull RPC. SECURITY DEFINER bypasses the auth.uid()
--    SELECT policy, which is the whole point — different devices have
--    different anon auth.users.id values, so the ownership check would
--    block a legitimate cross-device pull.
CREATE OR REPLACE FUNCTION public.ward_helper_pull_by_username(p_username text)
RETURNS TABLE (
  blob_type   text,
  blob_id     text,
  ciphertext  bytea,
  iv          bytea,
  salt        bytea,
  updated_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- Defensive: NULL username matches no rows (NULL = NULL is false in SQL).
  -- Empty string also matches no rows because we never write empty username.
  SELECT
    b.blob_type,
    b.blob_id,
    b.ciphertext,
    b.iv,
    b.salt,
    b.updated_at
  FROM public.ward_helper_backup b
  WHERE b.username = p_username
  ORDER BY b.blob_type, b.blob_id;
$function$;

-- 4) GRANT EXECUTE — anon and authenticated. Mirrors the existing
--    backup_get(p_app, p_id) RPC pattern for the PWAs.
GRANT EXECUTE ON FUNCTION public.ward_helper_pull_by_username(text) TO anon, authenticated;
