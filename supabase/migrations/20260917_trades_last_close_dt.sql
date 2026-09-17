-- Idempotency key for the orphan-close import path (dashboard.html's
-- _flexImportInner) — see the comment there. IBKR's raw dateTime for the
-- closing execution (unique to the second, even without a Trade ID column),
-- so a resync that re-includes an already-applied close can recognize it and
-- skip instead of double-counting closedShares.
alter table trades add column last_close_dt text;
