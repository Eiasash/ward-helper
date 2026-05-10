-- Extend ward_helper_backup.blob_type CHECK constraint to allow 'day-snapshot'.
-- Constraint history:
--   0001: ('patient', 'note')
--   0004: + 'api-key'
--   0005: + 'canary'
--   0008: + 'day-snapshot'  ← this migration
--
-- daySnapshots are the morning-rounds-prep frozen-roster archives shipped in
-- v1.40.0. They live in IndexedDB store `daySnapshots`, keyed by date
-- (YYYY-MM-DD), capped to the last 20 archives. Cloud sync is opt-in via the
-- "סנכרן היסטוריה לענן" Settings toggle (localStorage key
-- `ward-helper.cloudSyncDaySnapshots`).
--
-- Encryption posture is identical to the existing `patient` and `note` blob
-- types — AES-GCM 256 ciphertext only, key derived via PBKDF2(600,000) from
-- the user's login password. Each row carries its own salt + IV.
--
-- Cap mirroring on cloud is best-effort and per-device: after each push, the
-- client deletes cloud day-snapshot rows whose blob_id is no longer in the
-- local IDB list. The evict RPC scopes by user_id = auth.uid() (security
-- defense — see RPC body), so a multi-device user may accumulate up to N×20
-- cloud day-snapshots across devices. Local stays bounded because
-- putDaySnapshot enforces the 20-cap on every write/restore.
--
-- Non-destructive: adds an allowed value, doesn't reject existing rows.
ALTER TABLE public.ward_helper_backup
  DROP CONSTRAINT IF EXISTS ward_helper_backup_blob_type_check;

ALTER TABLE public.ward_helper_backup
  ADD CONSTRAINT ward_helper_backup_blob_type_check
  CHECK (blob_type IN ('patient', 'note', 'api-key', 'canary', 'day-snapshot'));

-- Cap-mirror RPC: ward_helper_evict_day_snapshots(p_username, p_keep_ids).
--
-- Purpose: client mirrors local IDB cap (SNAPSHOT_HISTORY_CAP = 20) to cloud
-- by passing the current local snapshot IDs after each archive. Cloud rows
-- under the same username with blob_id NOT IN p_keep_ids are deleted.
--
-- DELETE is blocked at the RLS layer (migration 0002 intentionally omits a
-- DELETE policy), so this SECURITY DEFINER RPC is the only sanctioned client
-- path to remove evicted snapshots. Mirrors the pattern in migration 0007
-- (ward_helper_dedupe_stale_canaries).
--
-- Defense: caller must already own at least one day-snapshot under p_username
-- (i.e., user_id = auth.uid()). Anchors the evict to "I am cleaning up MY old
-- snapshots" rather than letting any session prune any username's history.
-- Empty p_keep_ids is a no-op (returns 0) — never wipe everything via a
-- mistakenly-empty array.
CREATE OR REPLACE FUNCTION public.ward_helper_evict_day_snapshots(
  p_username text,
  p_keep_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_username text;
  v_deleted  integer;
BEGIN
  v_username := nullif(trim(coalesce(p_username, '')), '');
  IF v_username IS NULL THEN
    RETURN 0;
  END IF;

  -- Defensive: empty keep-list is treated as a no-op. The client-side
  -- helper passes the current local IDs, which is always >= 1 because
  -- the helper only runs immediately after a successful push.
  IF p_keep_ids IS NULL OR cardinality(p_keep_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- Defense: caller must already have at least one day-snapshot under this
  -- username. Same anchor as ward_helper_dedupe_stale_canaries.
  IF NOT EXISTS (
    SELECT 1 FROM public.ward_helper_backup
    WHERE username = v_username
      AND blob_type = 'day-snapshot'
      AND user_id = auth.uid()
  ) THEN
    RETURN 0;
  END IF;

  DELETE FROM public.ward_helper_backup
  WHERE username = v_username
    AND blob_type = 'day-snapshot'
    AND user_id = auth.uid()
    AND blob_id <> ALL(p_keep_ids);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ward_helper_evict_day_snapshots(text, text[])
  TO anon, authenticated;
