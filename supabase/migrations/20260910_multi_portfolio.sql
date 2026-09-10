-- Multi-portfolio support: portfolios table, portfolio_id on investments/investment_holdings,
-- portfolio_total moved from user_settings onto investments (per-portfolio).
-- Backups taken before this migration: investments_backup_20260910, investment_holdings_backup_20260910.

create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table portfolios enable row level security;

create policy "user owns portfolio" on portfolios
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table investments add column portfolio_id uuid references portfolios(id);
alter table investment_holdings add column portfolio_id uuid references portfolios(id);
alter table investments add column portfolio_total numeric;

-- Backfill: one default portfolio per existing investments user, carry over portfolio_total.
do $$
declare
  r record;
  new_id uuid;
begin
  for r in select * from investments loop
    insert into portfolios (user_id, name, is_default)
    values (r.user_id, 'תיק ראשי', true)
    returning id into new_id;

    update investments set portfolio_id = new_id where id = r.id;
    update investment_holdings set portfolio_id = new_id where user_id = r.user_id;

    update investments
      set portfolio_total = (select us.portfolio_total from user_settings us where us.user_id = r.user_id)
      where id = r.id;
  end loop;
end $$;

alter table investments alter column portfolio_id set not null;
alter table investment_holdings alter column portfolio_id set not null;

alter table investments drop constraint investments_user_id_key;
alter table investments add constraint investments_user_portfolio_key unique (user_id, portfolio_id);

create index idx_investment_holdings_portfolio_id on investment_holdings(portfolio_id);
