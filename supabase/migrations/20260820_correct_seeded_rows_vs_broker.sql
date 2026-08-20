-- Four rows hand-entered on 2026-04-16, before the IBKR connection existed,
-- carried entry prices that disagree with the broker's own Flex statement
-- (still cached in flex_statement_cache). Each is a single fill, so no merged
-- group's weighted average could explain the difference, and every error is in
-- the same direction — an entry price rounded slightly up — which is what
-- typing from memory looks like, not a software fault.
--
-- ANAB was additionally dated a day late: the broker records the buy on
-- 2026-02-10 12:33 and the sell on 2026-02-11 09:46, so the row showed a
-- same-day trade that was actually held overnight.
--
--   AHR  53.40   -> 53.245     P&L -31.19 -> -27.01
--   SOLS 76.75   -> 76.498     P&L -40.90 -> -38.38
--   ANAB 51.46   -> 51.15      P&L -29.52 -> -27.04  (+ entry_date -1 day)
--   RDDT 233.72  -> 233.365    P&L  -3.61 ->  -2.54
-- Together they overstated the book's loss by $10.26.
--
-- Rollback:
--   update trades t set entry_price = b.entry_price, entry_date = b.entry_date
--     from trades_backup_20260820_broker_correction b where b.id = t.id;
create table if not exists public.trades_backup_20260820_broker_correction as
  select * from public.trades where id in (33, 34, 35, 29);
revoke all on public.trades_backup_20260820_broker_correction from anon, authenticated;
alter table public.trades_backup_20260820_broker_correction enable row level security;

update public.trades set entry_price = 51.15,  entry_date = '2026-02-10' where id = 33 and symbol = 'ANAB';
update public.trades set entry_price = 53.245                             where id = 34 and symbol = 'AHR';
update public.trades set entry_price = 76.498                             where id = 35 and symbol = 'SOLS';
update public.trades set entry_price = 233.365                            where id = 29 and symbol = 'RDDT';
