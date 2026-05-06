-- Extend ward_helper_backup.blob_type CHECK constraint to allow 'canary'.
-- Constraint history:
--   0001: ('patient', 'note')
--   0004: + 'api-key'
--   0005: + 'canary'  ← this migration
--
-- The canary blob is a known plaintext ('ward-helper-canary' marker) encrypted
-- with the user's backup passphrase. restoreFromCloud decrypts the canary
-- before iterating any patient/note rows, so a wrong passphrase fails
-- deterministically in ~300ms instead of N×PBKDF2(600k) per row.
--
-- Non-destructive: adds an allowed value, doesn't reject existing rows.
ALTER TABLE public.ward_helper_backup
  DROP CONSTRAINT IF EXISTS ward_helper_backup_blob_type_check;

ALTER TABLE public.ward_helper_backup
  ADD CONSTRAINT ward_helper_backup_blob_type_check
  CHECK (blob_type IN ('patient', 'note', 'api-key', 'canary'));
