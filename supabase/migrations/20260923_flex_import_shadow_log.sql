create table if not exists flex_import_shadow_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ibkr_id text not null,
  kind text not null check (kind in ('missing', 'extra', 'mismatched')),
  expected jsonb,
  actual jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, ibkr_id, kind)
);

alter table flex_import_shadow_log enable row level security;
create policy "user owns row" on flex_import_shadow_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
