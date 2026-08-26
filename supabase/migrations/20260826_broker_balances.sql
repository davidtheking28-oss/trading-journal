-- Broker-derived account equity, so "portfolio size" can come from the broker
-- instead of the hand-typed user_settings.portfolio_total. One row per
-- (user, broker); the sync jobs upsert on that pair:
--   * bybit-cron  — /v5/account/wallet-balance, UNIFIED totalEquity
--   * ibkr-cron   — <EquitySummaryByReportDateInBase total="..."> from the Flex
--                   statement, latest reportDate. Only present if the account
--                   has the "Net Asset Value (NAV) in Base" section enabled on
--                   its Flex Query, so this stays empty (not broken) otherwise.
--
-- Writes come only from those two jobs under the service role, which bypasses
-- RLS. Users get SELECT and nothing else: a broker-derived figure the client
-- could overwrite would be no more trustworthy than the manual field it
-- replaces, and it feeds the Kelly sizing suggestion and the STEM exposure
-- alert. See 20260826_broker_balances_read_only.sql for that narrowing.
CREATE TABLE IF NOT EXISTS public.broker_balances (
  id bigint generated always as identity primary key,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker text NOT NULL,
  equity_usd numeric NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, broker)
);

ALTER TABLE public.broker_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user owns row" ON public.broker_balances
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
