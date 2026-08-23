-- Council review 2026-08-23: ibkr-alert only ever looks at users who HAVE
-- flex_sync_log rows in the window (ok===0 && fail>0). A user whose
-- flex_query_id or token is missing/invalid never enters ibkr-cron's
-- `targets` list at all, so they get ZERO log rows — neither ok nor fail —
-- and the alert can never see them. That is exactly how account
-- `6f73a6c3` went undetected: its sync had been dead since 2026-06-24 and
-- was found by accident during a manual reconciliation, not by any check.
--
-- This closes the gap the same way every other check in this function does:
-- add a branch, not a parallel mechanism. Pure SQL, no calls into the
-- SECURITY DEFINER / VOLATILE get_broker_secret() (this function is STABLE),
-- so it only reads flex_query_id — the field ibkr-cron's own qid() regex
-- actually gates on — plus flex_statement_cache.fetched_at staleness. 4 days
-- is well past the weekday-only daily cadence (Mon-Fri 13:00 UTC) even across
-- a long weekend.
create or replace function public.data_health_check_core(p_user_id uuid default null::uuid)
 returns table(check_name text, severity text, failing_rows bigint, detail text)
 language sql
 stable
 set search_path to 'public'
as $function$
  with t as (
    select * from trades
    where deleted is not true and (p_user_id is null or user_id = p_user_id)
  ),
  -- The jsonb document, flattened and renumbered the way the backfill did it,
  -- so it can be compared position-for-position against the rows.
  doc as (
    select i.user_id,
           row_number() over (partition by i.user_id order by e.ord) - 1 as position,
           upper(trim(coalesce(e.h->>'symbol',''))) as symbol,
           coalesce((e.h->>'entryShares')::numeric, 0) as entry_shares,
           coalesce((e.h->>'entryPrice')::numeric, 0)  as entry_price
      from investments i,
           lateral jsonb_array_elements(coalesce(i.holdings,'[]'::jsonb))
                   with ordinality e(h, ord)
     where (p_user_id is null or i.user_id = p_user_id)
       and nullif(trim(coalesce(e.h->>'symbol','')),'') is not null
  ),
  rows_ as (
    select user_id, position, upper(trim(coalesce(symbol,''))) as symbol,
           entry_shares, entry_price
      from investment_holdings
     where (p_user_id is null or user_id = p_user_id)
       and nullif(trim(coalesce(symbol,'')),'') is not null
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
  -- Stage 2 dual-write checks.
  select 'holdings_doc_row_drift', 'critical',
         count(*), 'investments.holdings and investment_holdings disagree; the tab renders the rows'
  from (select user_id, position, symbol, entry_shares, entry_price from doc
        except all
        select user_id, position, symbol, entry_shares, entry_price from rows_
        union all
        select user_id, position, symbol, entry_shares, entry_price from rows_
        except all
        select user_id, position, symbol, entry_shares, entry_price from doc) d
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
  -- New 2026-08-23: an account that has (or ever had) IBKR flowing into it,
  -- with no successful Flex fetch in 4+ days. Catches both a wiped
  -- flex_query_id (6f73a6c3's actual failure) and a query_id that still
  -- resolves but has silently stopped being pulled for any other reason —
  -- ibkr-alert only sees users who already have a log row, so a user filtered
  -- out of ibkr-cron's targets before it ever logs anything is invisible to it.
  --
  -- "ever had IBKR flowing" is NOT trades.ibkr_id is not null: two of the four
  -- accounts (6f73a6c3, dcb5bdba) have no Trade ID column configured in their
  -- Flex query, so every row they import is untagged — that condition would
  -- have silently excluded the exact two accounts most prone to going stale.
  -- A row in flex_statement_cache is proof of having synced at least once
  -- regardless of tagging, so that is the fallback instead.
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
