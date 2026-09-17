-- Neither failure mode found in today's audit had ANY monitoring:
-- trades-purge-deleted failed 7/7 nights silently (fixed alongside this in
-- 20260918_fix_purge_archive_conflict.sql) and 29 client-side JS errors piled
-- up with nobody looking. data_health_check() already runs nightly via the
-- data-health-alert cron and messages Telegram on any failure — these two
-- branches route both failure classes through that same, already-working
-- channel instead of adding a new one.
--
-- Base: pg_get_functiondef confirmed identical to 20260917_flex_imported_stale_check.sql
-- before this edit (all 21 checks, 0 failing) — see that file's own note
-- about why the live definition, not a migration file picked by eye, is the
-- only safe base for a CREATE OR REPLACE FUNCTION with no partial-alter form.
create or replace function public.data_health_check_core(p_user_id uuid default null::uuid)
 returns table(check_name text, severity text, failing_rows bigint, detail text)
 language sql
 stable
 set search_path to 'public'
as $function$
  with t as (
    select * from trades
    where deleted is not true and (p_user_id is null or user_id = p_user_id)
  )
  select 'closed_shares_exceeds_shares', 'critical',
         count(*), 'Overstates P&L: P&L is measured over closed_shares'
  from t where closed_shares is not null and shares is not null and closed_shares > shares
  union all
  select 'ibkr_trade_typed_as_crypto', 'critical',
         count(*), 'IBKR cannot report a crypto fill; wrong tab and wrong array'
  from t where ibkr_id is not null and type = 'crypto'
  union all
  select 'fx_conversion_imported_as_position', 'critical',
         count(*), 'assetCategory CASH rows (USD.ILS) are not positions'
  from t where symbol ~ '^[A-Z]{3}\.[A-Z]{3}$'
  union all
  select 'duplicate_broker_execution_id', 'critical',
         coalesce(sum(c) - count(*), 0), 'One broker execution imported more than once'
  from (select count(*) as c from t where ibkr_id is not null group by user_id, ibkr_id having count(*) > 1) x
  union all
  select 'duplicate_bybit_execution_id', 'critical',
         coalesce(sum(c) - count(*), 0), 'One Bybit execution imported more than once'
  from (select count(*) as c from t where bybit_id is not null group by user_id, bybit_id having count(*) > 1) y
  union all
  select 'partials_exceed_closed_volume', 'critical',
         count(*), 'sum(targets[].shares) > closed_shares makes calcPL drop the final leg'
  from t where closed_shares is not null
    and (select coalesce(sum((p->>'shares')::numeric),0)
           from jsonb_array_elements(coalesce(targets,'[]'::jsonb)) p) > closed_shares
  union all
  select 'half_closed_row', 'warning',
         count(*), 'Fully-closed row missing close_date (or a close_date with no exit_price) splits the closed-tests'
  from t where (exit_price is not null and close_date is null
                and coalesce(closed_shares, 0) >= coalesce(shares, 0))
             or (close_date is not null and exit_price is null)
  union all
  select 'closed_without_closed_shares', 'warning',
         count(*), 'Counted in stats but invisible to renderMonthlyTracker'
  from t where exit_price is not null and exit_price > 0
             and (closed_shares is null or closed_shares <= 0)
  union all
  select 'malformed_row', 'critical',
         count(*), 'Missing or non-positive symbol/shares/entry_price'
  from t where shares is null or shares <= 0 or entry_price is null or entry_price <= 0
             or symbol is null or trim(symbol) = ''
  union all
  select 'row_dropped_by_client_validation', 'critical',
         count(*), 'validateTradeSchema silently hides these from the journal'
  from t where ls not in ('L','S') or length(symbol) > 20
             or upper(symbol) <> regexp_replace(upper(symbol), '[^A-Z0-9._\-]', '', 'g')
  union all
  select 'close_before_entry', 'critical',
         count(*), 'Negative holding period'
  from t where close_date is not null and close_date < entry_date
  union all
  select 'both_broker_ids', 'warning',
         count(*), 'A row cannot come from IBKR and Bybit at once'
  from t where ibkr_id is not null and bybit_id is not null
  union all
  select 'negative_commission', 'warning',
         count(*), 'Commission is stored as a positive cost'
  from t where commission < 0
  union all
  select 'table_missing_rls', 'critical',
         count(*), 'Public table without row-level security'
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
  union all
  select 'holding_duplicate_position', 'critical',
         coalesce(sum(c) - count(*), 0), 'Two holdings share one slot; the list renders a duplicate'
  from (select count(*) as c from investment_holdings
         where (p_user_id is null or user_id = p_user_id)
         group by user_id, position having count(*) > 1) z
  union all
  select 'holding_orphaned_from_investments', 'warning',
         count(*), 'Holding rows for a user with no investments row are never loaded'
  from investment_holdings ih
  where (p_user_id is null or ih.user_id = p_user_id)
    and not exists (select 1 from investments i where i.user_id = ih.user_id)
  union all
  select 'ibkr_sync_stalled', 'warning',
         count(*), 'No successful Flex fetch in 4+ days for an account that syncs or has synced before'
  from (
    select us.user_id
      from user_settings us
     where (p_user_id is null or us.user_id = p_user_id)
       and (
             us.flex_query_id is not null
          or exists (select 1 from flex_statement_cache fc2 where fc2.user_id = us.user_id)
       )
       and not exists (
             select 1 from flex_statement_cache fc
              where fc.user_id = us.user_id and fc.fetched_at > now() - interval '4 days'
           )
  ) s
  union all
  select 'bybit_sync_stalled', 'warning',
         count(*), 'No successful Bybit sync in 12+ hours for an account that syncs or has synced before'
  from (
    select b.user_id
      from (
        select l.user_id from flex_sync_log l where l.broker = 'bybit'
        union
        select tr.user_id from trades tr where tr.bybit_id is not null and tr.deleted is not true
      ) b
     where (p_user_id is null or b.user_id = p_user_id)
       and not exists (
             select 1 from flex_sync_log l2
              where l2.user_id = b.user_id and l2.broker = 'bybit'
                and l2.status = 'ok' and l2.run_at > now() - interval '12 hours'
           )
  ) sb
  union all
  select 'opposite_direction_open_same_symbol', 'critical',
         count(*), 'A long and a short in the same symbol are both open — a broker account cannot hold both at once; a no-indicator import misread a close as a new position'
  from t a
  join t b on a.user_id = b.user_id and a.symbol = b.symbol and a.ls = 'L' and b.ls = 'S' and a.id < b.id
  where (a.shares - coalesce(a.closed_shares, 0)) > 0.01
    and (b.shares - coalesce(b.closed_shares, 0)) > 0.01
  union all
  select 'flex_fetched_not_imported', 'warning',
         count(*), 'Flex statement fetched but never imported for 2+ days — the app was not opened to run the client-side import step'
  from flex_statement_cache fc
  where (p_user_id is null or fc.user_id = p_user_id)
    and (
      (fc.stale_since is not null and fc.stale_since < now() - interval '2 days')
      or (fc.confirm_stale_since is not null and fc.confirm_stale_since < now() - interval '2 days')
    )
  union all
  -- New 2026-09-18: neither the fetch/import checks above nor anything else
  -- notices when a scheduled job itself errors out (distinct from "didn't
  -- run" — pg_net/pg_cron logs a run either way). trades-purge-deleted found
  -- this failure mode by having no monitoring at all: 7 straight failed
  -- nights, discovered only by reading cron.job_run_details by hand.
  -- Global regardless of p_user_id, same as table_missing_rls above.
  select 'cron_job_failed_recently', 'warning',
         count(distinct jobid), 'A scheduled job failed in the last 48h (cron.job_run_details) — check its command and recent logs'
  from cron.job_run_details
  where status = 'failed' and start_time > now() - interval '48 hours'
  union all
  -- client_errors already exists (report own errors) but nothing reads it
  -- proactively — 29 dashboard/advisor crashes sat there for weeks. Scoped
  -- to app='dashboard': this project's client_errors table is shared with
  -- the unrelated budget-app/advisor frontend (different repo, same
  -- Supabase project), whose own error volume is not this repo's concern.
  select 'client_errors_accumulating', 'warning',
         count(*), 'New JS errors reported by the dashboard app in the last 7 days (client_errors) — check for a live regression'
  from client_errors
  where app = 'dashboard' and created_at > now() - interval '7 days';
$function$;
