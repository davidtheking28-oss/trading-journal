-- A row carrying both a close date and an exit price reads as "closed" to every
-- test in the app, yet P&L is measured only over closed_shares. When
-- closed_shares is under shares and no partial leg records where the rest went,
-- the row contradicts itself: either the remainder is still open (so the close
-- date is wrong) or it was sold (so closed_shares is wrong). Either way the
-- difference is money missing from P&L.
--
-- Three live rows are in this state, understating one user's book by ~$244.
-- Nothing caught it because every existing check looks for closed_shares ABOVE
-- shares — the overstating direction. The understating mirror was unowned.
--
-- Reported as a warning, not critical: the rows are contradictory rather than
-- provably wrong, and only the person who placed the trade can say which field
-- is the mistaken one.
create or replace function public.trades_unexplained_closed_volume(p_user_id uuid default null)
returns table(id bigint, user_id uuid, symbol text, shares numeric,
              closed_shares numeric, unaccounted numeric, entry_price numeric,
              exit_price numeric, close_date text, source text)
language sql
stable
set search_path to 'public'
as $function$
  select t.id, t.user_id, t.symbol, t.shares, t.closed_shares,
         t.shares - t.closed_shares as unaccounted,
         t.entry_price, t.exit_price, t.close_date,
         coalesce(nullif(t.ibkr_id,''), nullif(t.bybit_id,''), 'manual') as source
    from trades t
   where t.deleted is not true
     and (p_user_id is null or t.user_id = p_user_id)
     and t.exit_price > 0
     and t.close_date is not null and t.close_date <> ''
     and t.closed_shares is not null
     and t.closed_shares < t.shares
     and coalesce(jsonb_array_length(coalesce(t.targets,'[]'::jsonb)), 0) = 0
   order by (t.shares - t.closed_shares) * abs(t.exit_price - t.entry_price) desc;
$function$;

-- The existing body is renamed rather than restated, so the checks it already
-- carries cannot drift from a copy. data_health_report()/data_health_alert()
-- call data_health_check(), which keeps its name and signature.
alter function public.data_health_check(uuid) rename to data_health_check_core;

create or replace function public.data_health_check(p_user_id uuid default null::uuid)
returns table(check_name text, severity text, failing_rows bigint, detail text)
language sql
stable
set search_path to 'public'
as $function$
  select c.check_name, c.severity, c.failing_rows, c.detail
    from public.data_health_check_core(p_user_id) c
  union all
  select 'closed_row_unexplained_volume', 'warning', count(*),
         'Closed row whose closed_shares is under shares with no partial leg: P&L drops the difference'
    from public.trades_unexplained_closed_volume(p_user_id);
$function$;
