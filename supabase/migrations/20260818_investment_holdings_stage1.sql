-- Stage 1 of moving holdings out of a single jsonb document per user.
--
-- The document model is why a save had to rewrite every holding, why two
-- overlapping saves could discard an edit, and why a row's identity was its
-- index in an array — which once deleted a different position than the one
-- clicked. One row per holding gives each position a stable id.
--
-- Additive only: nothing reads this table yet. investments.holdings remains the
-- source of truth until stage 2.

-- Point-in-time copy taken before anything is split. Restore with:
--   update investments i set holdings = b.holdings
--     from investments_backup_20260818 b where b.user_id = i.user_id;
create table if not exists public.investments_backup_20260818 as
  select * from public.investments;
revoke all on public.investments_backup_20260818 from anon, authenticated;
-- Deny by default, matching app_secrets / flex_sync_log / market_cache: RLS on,
-- no policy. Grants alone would leave it one GRANT away from exposure.
alter table public.investments_backup_20260818 enable row level security;

create table if not exists public.investment_holdings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  symbol        text not null default '',
  cat           text,
  sector        text,
  entry_shares  numeric not null default 0,
  entry_price   numeric not null default 0,
  current_price numeric,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Mirrors the invariant the client already enforces via invStripBlank: a
  -- holding with no symbol and no size is a blank editing row, not data.
  constraint investment_holdings_nonneg check (entry_shares >= 0 and entry_price >= 0),
  constraint investment_holdings_cat check (cat is null or cat in ('blue','green','yellow'))
);

create index if not exists investment_holdings_user_pos
  on public.investment_holdings (user_id, position);

alter table public.investment_holdings enable row level security;

drop policy if exists "user owns holding" on public.investment_holdings;
create policy "user owns holding" on public.investment_holdings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists investment_holdings_updated_at on public.investment_holdings;
create trigger investment_holdings_updated_at
  before update on public.investment_holdings
  for each row execute function public.update_investments_timestamp();

-- Backfill, preserving array order in `position` so the table reproduces the
-- current on-screen ordering exactly. Idempotent: only runs when the table is
-- empty, so re-running during stage 2 cannot duplicate a user's positions.
insert into public.investment_holdings
  (user_id, symbol, cat, sector, entry_shares, entry_price, current_price, position)
select i.user_id,
       coalesce(h.value->>'symbol', ''),
       nullif(h.value->>'cat', ''),
       nullif(h.value->>'sector', ''),
       coalesce((h.value->>'entryShares')::numeric, 0),
       coalesce((h.value->>'entryPrice')::numeric, 0),
       (h.value->>'currentPrice')::numeric,
       h.ordinality - 1
  from public.investments i,
       lateral jsonb_array_elements(i.holdings) with ordinality as h(value, ordinality)
 where not exists (select 1 from public.investment_holdings)
   and coalesce(h.value->>'symbol', '') <> '';
