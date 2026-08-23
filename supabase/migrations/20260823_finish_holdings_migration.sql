-- Stage 3 of the holdings migration (deferred since ~2026-08-13, finished on
-- user go-ahead 2026-08-23 after a council review flagged the indefinitely
-- parallel dual-write as the single highest-risk item still open — a
-- compounding tax on every future edit to dashboard.html, not a one-time bug).
--
-- The client (dashboard.html) stopped reading and writing investments.holdings
-- in this same change: invLoadFromDB reads investment_holdings only, no jsonb
-- fallback branch; _invSaveWrite no longer includes `holdings` in the row it
-- writes to `investments`. Verified before this shipped: both paths held
-- exactly 2 users each, in perfect agreement (holdings_doc_row_drift: 0).
--
-- That agreement is now permanently frozen — investments.holdings will never
-- be written again, so the drift check would misfire on the very next holding
-- edit anyone makes. Retired along with the `doc`/`rows_` CTEs that only fed
-- it; every other check in this function reads investment_holdings or trades
-- directly and needs neither.
--
-- The investments.holdings column itself is left in place, not dropped — it
-- is now genuinely dead weight, not a rollback plan. Drop it in a later,
-- separate migration once nobody has needed to look at it for a while.
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
         count(*), 'exit_price without close_date (or the reverse) splits the closed-tests'
  from t where (exit_price is not null and close_date is null)
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
  -- 2026-08-23: an account that has (or ever had) IBKR flowing into it, with no
  -- successful Flex fetch in 4+ days. ibkr-alert only sees users who already
  -- have a flex_sync_log row, so a user filtered out of ibkr-cron's targets
  -- (e.g. flex_query_id wiped or never set) before it ever logs anything is
  -- invisible to it. "ever had IBKR flowing" is a flex_statement_cache row,
  -- not trades.ibkr_id is not null — two accounts (6f73a6c3, dcb5bdba) import
  -- untagged rows, so that condition would have excluded exactly the two
  -- accounts most prone to going stale.
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
  ) s;
$function$;
