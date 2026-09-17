-- Follow-up to 20260917_recover_dcb5bdba_ibkr_import: data_health_check flagged
-- two issues after the recovery ran.
alter table trades_backup_20260917_dcb5bdba_recovery enable row level security;

-- ONDS id 3195: orphan-close set close_date on a genuine partial close
-- (20 of 53 shares) — matches the closed_row_unexplained_volume /
-- half_closed_row distinction from the 2026-08-27 fix: only a row that
-- closed its FULL size should carry a close_date.
update trades set close_date = null where id = 3195 and user_id = 'dcb5bdba-8863-4f8f-92f5-498ea9eae59a';
