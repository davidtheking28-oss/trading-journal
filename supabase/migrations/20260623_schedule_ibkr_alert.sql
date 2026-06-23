-- Daily IBKR sync health alert, ~1h after the full sync so the day's results are
-- logged. Calls the ibkr-alert Edge Function, which messages Telegram if any user
-- had runs but no success in the last 26h. Telegram creds live in app_secrets.
SELECT cron.schedule(
  'ibkr-health-alert',
  '0 14 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/ibkr-alert',
       body := '{}'::jsonb,
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'x-cron-key',(SELECT value FROM public.app_secrets WHERE key='cron_secret')
       )
     ); $$
);
