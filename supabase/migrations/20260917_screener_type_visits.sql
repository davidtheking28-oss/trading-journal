-- One row per (user, day, screener type) actually viewed — replaces the
-- coarser screener_visits (tab-open only) as the source for the tracking
-- widget: opening the tab isn't evidence of having gone through the
-- filters, switching screener type is.
create table public.screener_type_visits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  visit_date date not null,
  screener_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, visit_date, screener_key)
);

alter table public.screener_type_visits enable row level security;

create policy "user owns row" on public.screener_type_visits
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index screener_type_visits_user_id_idx on public.screener_type_visits(user_id);
