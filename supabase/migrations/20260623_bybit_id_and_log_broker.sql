-- Bybit parity with IBKR: a stable per-trade broker id for robust dedup, and a
-- broker discriminator on the shared sync log so failures/alerts cover both.
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS bybit_id text;
-- One journal trade per Bybit closing execId; partial so manual trades (null) coexist.
CREATE UNIQUE INDEX IF NOT EXISTS trades_user_bybit_id
  ON public.trades (user_id, bybit_id) WHERE bybit_id IS NOT NULL;
ALTER TABLE public.flex_sync_log ADD COLUMN IF NOT EXISTS broker text NOT NULL DEFAULT 'ibkr';
