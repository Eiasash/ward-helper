-- ward-helper: harden RLS per project rule.
--
-- Memory rule: "NEVER use CREATE POLICY ... FOR ALL ... on tables holding
-- user data. Always split into separate INSERT/UPDATE/SELECT and OMIT the
-- DELETE policy." A client-side bug could otherwise trigger mass-DELETE of
-- the user's own backup — and backups should be append-only from the
-- client's perspective anyway. Deletions happen via admin/service-role if
-- ever needed.
--
-- This migration is idempotent — safe to run on a fresh project or on one
-- that already applied 0001.

alter table if exists ward_helper_backup enable row level security;

drop policy if exists "owner-only"              on ward_helper_backup;
drop policy if exists "owner-select"            on ward_helper_backup;
drop policy if exists "owner-insert"            on ward_helper_backup;
drop policy if exists "owner-update"            on ward_helper_backup;

create policy "owner-select" on ward_helper_backup
  for select using (user_id = auth.uid());

create policy "owner-insert" on ward_helper_backup
  for insert with check (user_id = auth.uid());

create policy "owner-update" on ward_helper_backup
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Intentionally: NO DELETE policy.
-- If you ever need to purge a user's backups, use the service-role key
-- from a server context — never grant anon/authenticated DELETE.
