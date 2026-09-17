-- trades-purge-deleted failed every night for a week: a row whose ibkr_id had
-- already been archived once (broker resync recreated the same execution,
-- got soft-deleted again) collided with the existing archive row, and one
-- conflict aborted the entire batch INSERT for every OTHER user that night.
-- ON CONFLICT DO NOTHING keeps the purge running for everyone else; the
-- colliding row's own re-deletion is simply not re-archived (an older copy
-- of that exact execution is already preserved there).
--
-- Also replaces the original "INSERT INTO trades_archive SELECT *, now()"
-- with an explicit column list. That positional form relied on
-- trades_archive's columns being exactly trades's columns plus archived_at
-- appended last — true when first written, but broken the same day this
-- session added last_close_dt to trades (20260917_trades_last_close_dt.sql)
-- after trades_archive already had archived_at in that slot: SELECT * then
-- put last_close_dt's text value into archived_at's timestamptz column.
-- Explicit columns are immune to this as long as future ALTER TABLE ADD
-- COLUMN on trades is mirrored onto trades_archive (see
-- 20260918_trades_archive_last_close_dt.sql).
CREATE OR REPLACE FUNCTION public.purge_old_deleted_trades()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  WITH moved AS (
    DELETE FROM trades
    WHERE deleted = true AND deleted_at < now() - interval '30 days'
    RETURNING *
  ), ins AS (
    INSERT INTO trades_archive (
      id, user_id, type, entry_date, ls, symbol, entry_price, shares, stop,
      targets, close_date, closed_shares, exit_price, ecn, commission,
      notes_keep, notes_improve, entry_reason, setup_type, market_cond,
      process_score, archived, created_at, deleted, deleted_at, mood,
      ibkr_id, bybit_id, last_close_dt, archived_at
    )
    SELECT
      id, user_id, type, entry_date, ls, symbol, entry_price, shares, stop,
      targets, close_date, closed_shares, exit_price, ecn, commission,
      notes_keep, notes_improve, entry_reason, setup_type, market_cond,
      process_score, archived, created_at, deleted, deleted_at, mood,
      ibkr_id, bybit_id, last_close_dt, now()
    FROM moved
    ON CONFLICT (user_id, ibkr_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END $function$;
