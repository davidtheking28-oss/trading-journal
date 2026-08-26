-- broker_balances is written exclusively by bybit-cron / ibkr-cron under the
-- service role (which bypasses RLS). The original "FOR ALL" policy also let the
-- owning user INSERT/UPDATE their own row from the browser, which quietly
-- defeats the whole point of the table: a broker-derived equity figure that the
-- client can overwrite is no more trustworthy than the manual
-- user_settings.portfolio_total it exists to replace, and it feeds the Kelly
-- sizing suggestion and the STEM exposure alert. Read-only for users.
DROP POLICY IF EXISTS "user owns row" ON public.broker_balances;

CREATE POLICY "user reads own balance" ON public.broker_balances
  FOR SELECT
  USING (auth.uid() = user_id);
