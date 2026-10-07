create table public.trades_backup_20261007_pre_atomic_frontend as table public.trades;
create table public.investments_backup_20261007_pre_atomic_frontend as table public.investments;
create table public.investment_holdings_backup_20261007_pre_atomic_frontend as table public.investment_holdings;
create table public.portfolios_backup_20261007_pre_atomic_frontend as table public.portfolios;

alter table public.trades_backup_20261007_pre_atomic_frontend enable row level security;
alter table public.investments_backup_20261007_pre_atomic_frontend enable row level security;
alter table public.investment_holdings_backup_20261007_pre_atomic_frontend enable row level security;
alter table public.portfolios_backup_20261007_pre_atomic_frontend enable row level security;

revoke all on public.trades_backup_20261007_pre_atomic_frontend from public, anon, authenticated;
revoke all on public.investments_backup_20261007_pre_atomic_frontend from public, anon, authenticated;
revoke all on public.investment_holdings_backup_20261007_pre_atomic_frontend from public, anon, authenticated;
revoke all on public.portfolios_backup_20261007_pre_atomic_frontend from public, anon, authenticated;
