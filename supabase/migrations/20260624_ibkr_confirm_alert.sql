-- Tight intraday alert for the IBKR confirm track. The daily ibkr-alert (26h
-- window) is tuned for the once-daily activity sync; a broken intraday confirm
-- sync would otherwise go unnoticed for ~a day. This runs ibkr-alert with
-- scope='confirm' (4h window, mode='confirm' only) every 2h across the confirm
-- window so confirm breakage is caught within hours.
SELECT cron.schedule(
  'ibkr-confirm-alert',
  '0 16-22/2 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/ibkr-alert',
       body := jsonb_build_object('scope','confirm'),
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'x-cron-key',(SELECT value FROM public.app_secrets WHERE key='cron_secret')
       )
     ); $$
);
