-- Tracks which days the user actually opened the Screener tab, so a small
-- calendar can show gaps ("did I actually screen today"). One row per
-- user per calendar day; upserted (ignoreDuplicates) from the client on
-- every switch to the Screener tab.
create table public.screener_visits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  visit_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, visit_date)
);

alter table public.screener_visits enable row level security;

create policy "user owns row" on public.screener_visits
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index screener_visits_user_id_idx on public.screener_visits(user_id);
