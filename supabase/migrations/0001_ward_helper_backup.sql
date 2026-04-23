-- ward-helper: encrypted-ciphertext-only backup table
-- Plaintext PHI never lands here. Client-side AES-GCM 256 / PBKDF2-600k.

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

create policy "owner-only" on ward_helper_backup
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index on ward_helper_backup (user_id, updated_at desc);
