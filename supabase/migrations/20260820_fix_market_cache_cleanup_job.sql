-- The market-cache-cleanup cron job had never once succeeded: it deleted on a
-- column named created_at, but market_cache has (cache_key, payload,
-- refreshed_at). Every nightly run failed with "column created_at does not
-- exist", silently — a failing pg_cron job is only visible in
-- cron.job_run_details, and nothing alerts on it.
--
-- 779 of 2286 rows were older than the 7-day retention it was supposed to
-- enforce, the oldest from 2026-07-02.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'market-cache-cleanup'),
  command => 'DELETE FROM public.market_cache WHERE refreshed_at < now() - interval ''7 days'''
);

delete from public.market_cache where refreshed_at < now() - interval '7 days';
