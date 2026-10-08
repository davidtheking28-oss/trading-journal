-- Which investments already sent a "reached the stop" Telegram message and have
-- not yet recovered above it. Service role only (RLS on, no policies).
create table if not exists public.stop_alert_state (
  user_id uuid not null,
  symbol text not null,
  alerted_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
alter table public.stop_alert_state enable row level security;

select cron.schedule('stop-alert', '*/10 13-21 * * 1-5', $$
  SELECT net.http_post(
    url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/stop-alert',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-key',(SELECT value FROM public.app_secrets WHERE key='cron_secret')
    )
  );
$$);
