-- Backup table is server-only; it must never be available through the public API.
alter table public.trades_backup_20261013_dcb5bdba_recovery enable row level security;
revoke all on public.trades_backup_20261013_dcb5bdba_recovery from public,anon,authenticated;
