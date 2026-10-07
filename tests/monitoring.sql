begin;
do $$
declare
  v_before bigint;
  v_after bigint;
begin
  select failing_rows into v_before from public.data_health_check() where check_name='client_errors_accumulating';
  insert into public.client_errors(kind,message,app,user_id)
    values('inv_save','rollback-only monitoring verification','dashboard',(select id from auth.users order by created_at limit 1));
  select failing_rows into v_after from public.data_health_check() where check_name='client_errors_accumulating';
  if v_after is distinct from v_before+1 then raise exception 'Investment save failure is not monitored'; end if;
  if position('client_errors_accumulating' in public.data_health_report())=0 then
    raise exception 'Save failure is missing from the scheduled alert report';
  end if;
  if not exists(select 1 from cron.job where jobname='data-health-alert' and active)
     or not exists(select 1 from cron.job where jobname='ibkr-health-alert' and active) then
    raise exception 'Required health alert schedule is inactive';
  end if;
end;
$$;
select 'save failures reach the existing health report; alert schedules are active; no notification was sent' as monitoring_verification;
rollback;
