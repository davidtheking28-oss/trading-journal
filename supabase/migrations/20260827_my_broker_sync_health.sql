-- The dashboard had no way to tell the user that one of their brokers had gone
-- silent. flex_sync_log is RLS-locked with zero policies (deliberately — see
-- 20260623_harden_secret_tables.sql), so the browser cannot read sync history
-- at all, and the only signal was a nightly Telegram alert the user may not see.
--
-- That is the same "silent failure" shape already fixed once at the alerting
-- layer (ibkr-alert grouped per user, so a healthy IBKR masked a dead Bybit).
-- It matters more now that broker_balances feeds the Kelly sizing suggestion
-- and the STEM exposure alert: a stale broker means those numbers are computed
-- off incomplete data with nothing on screen saying so.
--
-- Rather than opening the table up, this exposes only the derived per-broker
-- health of the CALLING user. SECURITY DEFINER to read past the lockdown;
-- auth.uid() still resolves from the caller's JWT, so it cannot return another
-- user's rows.
CREATE OR REPLACE FUNCTION public.my_broker_sync_health()
RETURNS TABLE(broker text, last_ok timestamptz, fails_since_ok bigint, last_error text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  with mine as (
    select l.broker, l.status, l.run_at, l.error_msg
    from flex_sync_log l
    where l.user_id = auth.uid()
      and l.run_at > now() - interval '7 days'
  ),
  ok as (
    select m.broker, max(m.run_at) as last_ok
    from mine m where m.status = 'ok' group by m.broker
  )
  select m.broker,
         o.last_ok,
         count(*) filter (
           where m.status = 'fail' and (o.last_ok is null or m.run_at > o.last_ok)
         ) as fails_since_ok,
         (array_agg(m.error_msg order by m.run_at desc)
            filter (where m.status = 'fail'))[1] as last_error
  from mine m
  left join ok o on o.broker = m.broker
  group by m.broker, o.last_ok;
$$;

REVOKE ALL ON FUNCTION public.my_broker_sync_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_broker_sync_health() TO authenticated;
