-- trades: the boot-path load (loadDB / _syncReloadTrades) runs
-- `select('*').eq('user_id', X).order('entry_date', {ascending:false})` on
-- every login and every realtime reload, and every RLS policy on this table
-- evaluates `auth.uid() = user_id` on every row. There was no plain user_id
-- index — the two existing composite indexes (user_id, ibkr_id) and
-- (user_id, bybit_id) don't cover it (the first is partial, WHERE deleted IS
-- NOT TRUE, so the planner can't use it for the unfiltered load query).
-- EXPLAIN ANALYZE confirmed a Seq Scan today (426 rows kept, 327 removed by
-- filter) — at current row counts (largest account: 426) this costs ~2ms, so
-- it is not today's perceived slowness, but it stops being free as accounts
-- and the shared table grow. Sorted descending to match the query's ORDER BY.
CREATE INDEX IF NOT EXISTS trades_user_id_entry_date_idx
  ON public.trades (user_id, entry_date DESC);

-- missed_opportunities and portfolios had no user_id index at all (only the
-- primary key) despite every query and every RLS policy filtering on it.
CREATE INDEX IF NOT EXISTS missed_opportunities_user_id_idx
  ON public.missed_opportunities (user_id);
CREATE INDEX IF NOT EXISTS portfolios_user_id_idx
  ON public.portfolios (user_id);
