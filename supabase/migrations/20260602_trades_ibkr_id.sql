-- Stores IBKR's unique execution id (tradeID) on each broker-imported trade so
-- the sync is idempotent: re-importing the same statement matches by ibkr_id and
-- updates instead of duplicating. Manual trades leave this null.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS ibkr_id text;
CREATE INDEX IF NOT EXISTS trades_user_ibkr_id_idx ON trades (user_id, ibkr_id);
