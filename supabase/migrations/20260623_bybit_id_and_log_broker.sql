-- Bybit parity with IBKR: a stable per-trade broker id for robust dedup, and a
-- broker discriminator on the shared sync log so failures/alerts cover both.
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS bybit_id text;
-- One journal trade per Bybit closing execId. Plain (non-partial) unique index so
-- it can serve as an ON CONFLICT arbiter for upsert; Postgres treats NULLs as
-- distinct, so manual trades (bybit_id NULL) still coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS trades_user_bybit_id ON public.trades (user_id, bybit_id);
ALTER TABLE public.flex_sync_log ADD COLUMN IF NOT EXISTS broker text NOT NULL DEFAULT 'ibkr';
