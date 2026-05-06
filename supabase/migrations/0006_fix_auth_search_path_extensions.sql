-- Fix: auth_login_user and auth_set_api_key were created with
-- SET search_path = public (missing 'extensions'), so calls to
-- crypt(text, text) — provided by pgcrypto in the extensions schema —
-- failed with "function crypt(text, text) does not exist".
--
-- The error surfaces in production as a red banner under the login form
-- on the live PWA: "שגיאת שרת: function crypt(text, text) does not exist".
--
-- Other auth RPCs (auth_register_user, auth_change_password) already
-- had the correct three-element search_path. This migration brings the
-- two outliers into line.
--
-- ALTER FUNCTION ... SET search_path is non-destructive: function body
-- and ownership unchanged, only the runtime search_path overrides.

ALTER FUNCTION public.auth_login_user(text, text)
  SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.auth_set_api_key(text, text, text)
  SET search_path = pg_catalog, public, extensions;
