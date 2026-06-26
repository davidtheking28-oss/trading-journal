-- Server-side Bybit sync so trades import even when the app is closed (parity
-- with the ibkr-cron schedule). Crypto trades 24/7, so run every 30 min.
SELECT cron.schedule(
  'bybit-sync',
  '*/30 * * * *',
  $$ SELECT net.http_post(
       url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/bybit-cron',
       body := '{}'::jsonb,
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'x-cron-key',(SELECT value FROM public.app_secrets WHERE key='cron_secret')
       ),
       timeout_milliseconds := 120000
     ); $$
);
