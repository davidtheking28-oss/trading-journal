-- Move IBKR Flex prefetch scheduling off GitHub Actions (whose scheduled runs
-- were unreliable — most ticks silently dropped) onto Supabase pg_cron, which
-- fires on time inside the same infra. pg_cron triggers the `ibkr-cron` Edge
-- Function via pg_net; that function does the SendRequest -> poll GetStatement
-- fetch with the service role and upserts flex_statement_cache. The frontend
-- still imports from that cache on login, so it never hits IBKR live (no 1001).
--
-- Auth: the Edge Function runs with verify_jwt=false and checks a shared secret
-- (x-cron-key header) against public.app_secrets('cron_secret'). That table is
-- RLS-locked with no policies, so only the service role (the function) and the
-- in-database cron job can read the secret; anon/authenticated callers cannot.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.app_secrets (
  key   text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: anon/authenticated get zero rows; service_role bypasses RLS.

INSERT INTO public.app_secrets (key, value)
VALUES ('cron_secret', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- Daily FULL run (Activity Flex, 365-day history) ~13:00 UTC (~09:00 ET), Mon-Fri.
SELECT cron.schedule(
  'ibkr-full-daily',
  '0 13 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/ibkr-cron',
       body := jsonb_build_object('mode','full'),
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'x-cron-key',(SELECT value FROM public.app_secrets WHERE key='cron_secret')
       ),
       timeout_milliseconds := 120000
     ); $$
);

-- Intraday CONFIRM run (Trade Confirmation Flex, today only) every 30 min during
-- US market hours, for near-real-time fills/closes.
SELECT cron.schedule(
  'ibkr-confirm-intraday',
  '*/30 13-21 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/ibkr-cron',
       body := jsonb_build_object('mode','confirm'),
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'x-cron-key',(SELECT value FROM public.app_secrets WHERE key='cron_secret')
       ),
       timeout_milliseconds := 120000
     ); $$
);
