-- 20260917_trades_last_close_dt.sql added this column to trades but not to
-- trades_archive, which purge_old_deleted_trades() populates via
-- "INSERT INTO trades_archive SELECT *, now() FROM moved" — column-count
-- mismatch, breaking the nightly purge for every account, not just the
-- ibkr_id conflict fixed alongside this.
alter table trades_archive add column last_close_dt text;
