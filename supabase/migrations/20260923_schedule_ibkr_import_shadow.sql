select cron.schedule(
  'ibkr-import-shadow',
  '0 14,20 * * 1-5',
  $$
    select net.http_post(
      url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/ibkr-import',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-key',(select value from public.app_secrets where key='cron_secret')
      ),
      timeout_milliseconds := 120000
    );
  $$
);
