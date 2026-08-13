-- Nightly alert on data_health_check(). A check nobody runs catches nothing —
-- the 65 overstated-P&L rows were found by eye, not by a monitor.
-- Pure SQL: pg_cron + pg_net straight to Telegram, reusing app_secrets like the
-- existing ibkr-health-alert job. No Edge Function involved.

-- Returns the alert text, or NULL when everything passes. Split out from the
-- sender so it can be exercised without messaging anyone.
CREATE OR REPLACE FUNCTION public.data_health_report()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
    E'⚠️ Data health check failed\n\n' ||
    string_agg(format('%s [%s] — %s rows%s%s', check_name, severity, failing_rows,
                      E'\n', detail), E'\n\n' ORDER BY severity, check_name)
  END
  FROM data_health_check()
  WHERE failing_rows > 0;
$function$;

REVOKE ALL ON FUNCTION public.data_health_report() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.data_health_alert(p_force_text text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  msg text := coalesce(p_force_text, data_health_report());
BEGIN
  IF msg IS NULL THEN RETURN 'clean'; END IF;
  PERFORM net.http_post(
    url := 'https://api.telegram.org/bot'
           || (SELECT value FROM app_secrets WHERE key = 'telegram_bot_token')
           || '/sendMessage',
    body := jsonb_build_object(
      'chat_id', (SELECT value FROM app_secrets WHERE key = 'telegram_chat_id'),
      'text', msg),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  RETURN 'sent';
END;
$function$;

REVOKE ALL ON FUNCTION public.data_health_alert(text) FROM public, anon, authenticated;

-- 03:45 UTC, after the nightly cleanup jobs (03:15/03:25/03:35) have run.
SELECT cron.unschedule('data-health-alert')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-health-alert');

SELECT cron.schedule('data-health-alert', '45 3 * * *',
  $$ SELECT public.data_health_alert(); $$);
