-- Durable per-run outcome log for the IBKR cron so failures are never silent.
-- One row per user per run (ok or fail), written by the ibkr-cron Edge Function.
CREATE TABLE IF NOT EXISTS public.flex_sync_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode       text NOT NULL,
  status     text NOT NULL,          -- 'ok' | 'fail'
  error_code text,
  error_msg  text,
  run_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.flex_sync_log ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (Edge Function) and pg internals touch it.
CREATE INDEX IF NOT EXISTS flex_sync_log_user_time ON public.flex_sync_log (user_id, run_at DESC);

-- Per-user health rollup: last run, last success, the failure streak since that
-- success, and the most recent error. security_invoker so it honors the base
-- table's RLS (service role sees all; users/anon see nothing).
CREATE OR REPLACE VIEW public.flex_sync_health
WITH (security_invoker = on) AS
WITH last_ok AS (
  SELECT user_id, max(run_at) FILTER (WHERE status = 'ok') AS last_success_at
  FROM public.flex_sync_log GROUP BY user_id
)
SELECT
  l.user_id,
  max(l.run_at) AS last_run_at,
  o.last_success_at,
  count(*) FILTER (
    WHERE l.status = 'fail' AND (o.last_success_at IS NULL OR l.run_at > o.last_success_at)
  ) AS consecutive_failures,
  (array_agg(l.error_msg ORDER BY l.run_at DESC) FILTER (WHERE l.status = 'fail'))[1] AS last_error
FROM public.flex_sync_log l
LEFT JOIN last_ok o USING (user_id)
GROUP BY l.user_id, o.last_success_at;
