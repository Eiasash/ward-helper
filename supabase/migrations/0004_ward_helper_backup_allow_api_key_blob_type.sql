-- Extend ward_helper_backup.blob_type CHECK constraint to allow 'api-key'.
-- Original constraint from migration 0001_ward_helper_backups (line 10):
--   check (blob_type in ('patient', 'note'))
--
-- Adding 'api-key' enables Option A (per-user API key cloud sync):
-- the user's Anthropic API key is encrypted with their PBKDF2-derived
-- AES key and stored as a special blob_type so it syncs across devices
-- alongside their notes and patients. Same threat model as 'note':
-- ciphertext-only on Supabase, passphrase is the actual lock.
--
-- Non-destructive: adds an allowed value, doesn't reject existing rows.
ALTER TABLE public.ward_helper_backup
  DROP CONSTRAINT IF EXISTS ward_helper_backup_blob_type_check;

ALTER TABLE public.ward_helper_backup
  ADD CONSTRAINT ward_helper_backup_blob_type_check
  CHECK (blob_type IN ('patient', 'note', 'api-key'));
