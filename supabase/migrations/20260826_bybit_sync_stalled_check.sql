-- data_health_check had no Bybit staleness check at all: ibkr_sync_stalled
-- covers only the Flex track, so when user 9f9ffff4's Bybit API key expired on
-- 2026-08-22 16:00 UTC the sync failed 183 consecutive times over four days in
-- complete silence. Nothing in the health layer was watching that broker.
--
-- Two design points worth keeping, both found by testing the branch against
-- live data before shipping it:
--
--  1. The window is 12 HOURS, not the 4 days ibkr_sync_stalled uses. bybit-sync
--     runs every 30 minutes; 4 days there is 192 failed runs before anyone is
--     told, and — measured on the real data — the 4-day form still returned 0
--     while the key had already been dead for most of four days. IBKR's daily
--     cadence is what makes 4 days reasonable for it. Match the window to the
--     cadence, don't copy the number across.
--
--  2. Membership is "has bybit sync log rows OR holds bybit-tagged trades",
--     NOT the Vault credential rows. data_health_check_core is SECURITY
--     INVOKER with search_path=public, so a normal caller cannot read
--     vault.secrets and the check would error for them. The trades half of the
--     union is what survives a credential wipe — the same blind spot that hid
--     6f73a6c3's dead IBKR sync for two months (see the 2026-08-23 note in
--     CLAUDE.md about not keying such a check off something the broken state
--     itself erases).
CREATE OR REPLACE FUNCTION public.data_health_check_core(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(check_name text, severity text, failing_rows bigint, detail text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  ) sb;
$function$;
