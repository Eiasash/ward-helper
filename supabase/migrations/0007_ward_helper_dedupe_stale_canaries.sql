-- 0007: ward_helper_dedupe_stale_canaries(p_username) RPC.
--
-- Why this exists: anon Supabase auth mints fresh user_id values when
-- device tokens expire, IDB is cleared, or the user opens a new
-- browser. The (user_id, blob_type, blob_id) UNIQUE constraint on
-- ward_helper_backup means each fresh user_id slips past the
-- constraint and INSERTs a new canary row instead of updating. Real
-- production data: 9 canary rows accumulated for one username over
-- 5 days.
--
-- v1.39.16 fixed the read side (verifyCanaryFromRows now picks the
-- newest canary deterministically). v1.39.17 adds this RPC so
-- pushCanary can clean up stale canaries from prior user_ids on
-- every push, preventing unbounded accumulation.
--
-- Threat model: the RPC is callable by any authenticated/anon
-- session. Defense: it only deletes canaries from user_ids OTHER
-- than the caller's, AND only if the caller already has a canary
-- under the same username. Net effect — a malicious anon session
-- can't delete a target user's canary unless it has somehow already
-- planted its own canary under that username, which is governed
-- by the existing INSERT RLS (user_id = auth.uid()). The username
-- column is set client-side from app_users login state and is not
-- itself authenticated; that's an existing design choice consistent
-- with pullByUsername which also accepts username on faith and
-- relies on the AES-GCM/PBKDF2 layer for actual confidentiality.

CREATE OR REPLACE FUNCTION public.ward_helper_dedupe_stale_canaries(p_username text)
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

  -- Defense: caller must already have a canary under this username.
  -- This anchors the dedupe to "I am cleaning up MY old user_ids"
  -- rather than letting any session nuke any username's canaries.
  IF NOT EXISTS (
    SELECT 1 FROM public.ward_helper_backup
    WHERE username = v_username
      AND blob_type = 'canary'
      AND user_id = auth.uid()
  ) THEN
    RETURN 0;
  END IF;

  DELETE FROM public.ward_helper_backup
  WHERE username = v_username
    AND blob_type = 'canary'
    AND user_id <> auth.uid();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ward_helper_dedupe_stale_canaries(text) TO anon, authenticated;
