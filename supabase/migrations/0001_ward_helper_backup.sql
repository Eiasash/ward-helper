-- ward-helper: encrypted-ciphertext-only backup table.
-- Plaintext PHI never lands here. Client-side AES-GCM 256 / PBKDF2 >= 600k.
--
-- RLS rules per project memory: split INSERT/UPDATE/SELECT policies, OMIT
-- the DELETE policy. Never "FOR ALL ..." on user-data tables.

create table ward_helper_backup (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  blob_type    text not null check (blob_type in ('patient', 'note')),
  blob_id      text not null,
  ciphertext   bytea not null,
  iv           bytea not null,
  salt         bytea not null,
  version      int  not null default 1,
  updated_at   timestamptz not null default now(),
  unique (user_id, blob_type, blob_id)
);

alter table ward_helper_backup enable row level security;

create policy "owner-select" on ward_helper_backup
  for select using (user_id = auth.uid());

create policy "owner-insert" on ward_helper_backup
  for insert with check (user_id = auth.uid());

create policy "owner-update" on ward_helper_backup
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Intentionally: NO DELETE policy.

create index on ward_helper_backup (user_id, updated_at desc);
