-- my_broker_sync_health()'s last_ok lookup was capped to the same 7-day
-- window used for fails_since_ok, so an outage longer than a week reported
-- "never succeeded" instead of the real last-success date. fails_since_ok
-- correctly stays windowed (unbounded would make it grow forever); only the
-- last_ok search needs its own, much wider window.
create or replace function public.my_broker_sync_health()
returns table(broker text, last_ok timestamp with time zone, fails_since_ok bigint, last_error text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with mine as (
    select l.broker, l.status, l.run_at, l.error_msg
    from flex_sync_log l
    where l.user_id = auth.uid()
      and l.run_at > now() - interval '7 days'
  ),
  ok as (
    select l.broker, max(l.run_at) as last_ok
    from flex_sync_log l
    where l.user_id = auth.uid()
      and l.status = 'ok'
      and l.run_at > now() - interval '180 days'
    group by l.broker
  )
  select m.broker,
         o.last_ok,
         count(*) filter (
           where m.status = 'fail' and (o.last_ok is null or m.run_at > o.last_ok)
         ) as fails_since_ok,
         (array_agg(m.error_msg order by m.run_at desc)
            filter (where m.status = 'fail'))[1] as last_error
  from mine m
  left join ok o on o.broker = m.broker
  group by m.broker, o.last_ok;
$function$;
