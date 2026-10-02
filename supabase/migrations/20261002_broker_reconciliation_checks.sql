-- Nightly broker-vs-journal reconciliation, added 2026-10-02 after four
-- silent errors were found only by hand: EGBN phantom short + missing closing
-- commission (9f9ffff4), MD missing commission (9f9ffff4), QTTB exit off by
-- $29 (5f72e0bb). None of them tripped any existing check, because every
-- existing check tests the journal against itself. These test it against the
-- raw IBKR executions cached in flex_statement_cache.

create table if not exists public.broker_reconcile_accepted (
  user_id     uuid not null,
  symbol      text not null,
  check_name  text not null,
  diff        numeric not null default 0,
  note        text,
  accepted_at timestamptz not null default now(),
  primary key (user_id, symbol, check_name)
);
alter table public.broker_reconcile_accepted enable row level security;

-- Per symbol whose fills net to zero inside the Flex window, the broker's
-- realised P&L is exactly sum(-quantity*price + commission). The journal's is
-- calcTotal summed over its rows opened inside the window. Accounts whose
-- cache has not been imported are skipped (flex_fetched_not_imported covers
-- them), as are known differences recorded in broker_reconcile_accepted —
-- an accepted symbol alerts again as soon as its gap moves.
create or replace function public.broker_pnl_mismatch(p_user_id uuid default null)
returns table(user_id uuid, symbol text, broker_pl numeric, journal_pl numeric, diff numeric)
language sql stable set search_path to 'public' as $$
with src as (
  select c.user_id, c.xml as x from flex_statement_cache c
   where c.stale_since is null and (p_user_id is null or c.user_id = p_user_id)
  union all
  select c.user_id, coalesce(c.xml_confirm, '') from flex_statement_cache c
   where c.stale_since is null and (p_user_id is null or c.user_id = p_user_id)),
el as (select s.user_id, (regexp_matches(s.x, '<Trade(?:Confirm)? [^>]*>', 'g'))[1] e from src s),
f as (select el.user_id,
  substring(e from 'symbol="([^"]*)"') sym,
  substring(e from 'tradeID="([^"]*)"') tid,
  substring(e from 'dateTime="([^"]*)"') dt,
  coalesce(substring(e from 'tradePrice="([^"]*)"'), substring(e from ' price="([^"]*)"'))::numeric px,
  substring(e from 'quantity="([^"]*)"')::numeric q,
  coalesce(substring(e from 'ibCommission="([^"]*)"'), substring(e from 'commission="([^"]*)"'))::numeric cm
  from el),
d as (select distinct on (f.user_id, coalesce(f.tid, f.sym || f.dt || f.q)) * from f),
b as (select d.user_id, d.sym, sum(d.q) nq, sum(-d.q * d.px + d.cm) cf, min(left(d.dt, 8)) d0 from d group by 1, 2),
r as (select t.user_id, t.symbol, t.id, t.ls, t.entry_price e, coalesce(t.closed_shares, t.shares) cs, t.exit_price x,
  coalesce(t.commission, 0) + coalesce(t.ecn, 0) fees, coalesce(t.targets, '[]'::jsonb) tg
  from trades t join b on b.user_id = t.user_id and b.sym = t.symbol
  where not t.deleted and t.type = 'stock' and replace(t.entry_date::text, '-', '') >= b.d0),
lg as (select r.id, coalesce(sum((g->>'shares')::numeric), 0) lsh,
  coalesce(sum(case when r.ls = 'L' then ((g->>'price')::numeric - r.e) else (r.e - (g->>'price')::numeric) end
               * (g->>'shares')::numeric), 0) lpl
  from r left join lateral jsonb_array_elements(case when jsonb_typeof(r.tg) = 'array' then r.tg else '[]' end) g on true
  group by r.id),
j as (select r.user_id, r.symbol,
  sum(l.lpl + case when r.x > 0 and r.cs - l.lsh > 0
                   then (case when r.ls = 'L' then r.x - r.e else r.e - r.x end) * (r.cs - l.lsh) else 0 end - r.fees) pl
  from r join lg l on l.id = r.id group by 1, 2)
select b.user_id, b.sym, round(b.cf, 2), round(j.pl, 2), round(j.pl - b.cf, 2)
  from b join j on j.user_id = b.user_id and j.symbol = b.sym
  left join broker_reconcile_accepted a
    on a.user_id = b.user_id and a.symbol = b.sym and a.check_name = 'broker_pnl_mismatch'
 where b.nq = 0
   and abs(j.pl - b.cf - coalesce(a.diff, 0)) >= 0.05;
$$;

-- An open position that starts on the very fill that closed an opposite row:
-- the shape of every phantom found so far (EGBN short, AAPL/EM shorts). A
-- genuine reversal looks the same, so this is a warning to verify, and a
-- verified one is recorded in broker_reconcile_accepted.
create or replace function public.reversal_from_closing_fill(p_user_id uuid default null)
returns table(user_id uuid, symbol text, open_id bigint, closed_id bigint)
language sql stable set search_path to 'public' as $$
select p.user_id, p.symbol, p.id, c.id
  from trades p
  join trades c on c.user_id = p.user_id and c.symbol = p.symbol and c.ls <> p.ls and not c.deleted
   and c.close_date = p.entry_date and abs(c.exit_price - p.entry_price) < 0.0001
  left join broker_reconcile_accepted a
    on a.user_id = p.user_id and a.symbol = p.symbol and a.check_name = 'reversal_from_closing_fill'
 where not p.deleted and p.ibkr_id is not null
   and coalesce(p.closed_shares, 0) < p.shares - 0.01
   and a.user_id is null
   and (p_user_id is null or p.user_id = p_user_id);
$$;

create or replace function public.data_health_check(p_user_id uuid default null::uuid)
 returns table(check_name text, severity text, failing_rows bigint, detail text)
 language sql stable set search_path to 'public'
as $function$
  select c.check_name, c.severity, c.failing_rows, c.detail
    from public.data_health_check_core(p_user_id) c
  union all
  select 'closed_row_unexplained_volume', 'warning', count(*),
         'Closed row whose closed_shares is under shares with no partial leg: P&L drops the difference'
    from public.trades_unexplained_closed_volume(p_user_id)
  union all
  select 'broker_pnl_mismatch', 'critical', count(*),
         coalesce('Journal P&L differs from the raw IBKR fills: ' ||
           string_agg(format('%s %s journal %s vs broker %s', left(user_id::text, 8), symbol, journal_pl, broker_pl), '; '), '')
    from public.broker_pnl_mismatch(p_user_id)
  union all
  select 'reversal_from_closing_fill', 'warning', count(*),
         coalesce('Open position starting on the fill that closed an opposite row (phantom?): ' ||
           string_agg(format('%s %s open #%s / closed #%s', left(user_id::text, 8), symbol, open_id, closed_id), '; '), '')
    from public.reversal_from_closing_fill(p_user_id);
$function$;
