-- Personal lab: all write boundaries are server-owned and account scoped.
create table public.personal_experiments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 template text not null check(template in ('daily_limit','setup_documented','reason_documented')),
 asset_scope text not null check(asset_scope in ('stock','crypto')),
 target integer not null,
 timezone text not null,
 start_date date not null,
 end_date date not null check(end_date=start_date+30),
 status text not null default 'active' check(status in ('active','completed','cancelled')),
 summary_choice text check(summary_choice in ('keep','adjust','inconclusive')),
 summary_note text check(length(summary_note)<=500),
 summary_metrics jsonb,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default clock_timestamp(),
 check((template='daily_limit' and target between 1 and 10) or (template<>'daily_limit' and target=100)),
 check(status<>'completed' or (summary_choice is not null and summary_metrics is not null and completed_at is not null))
);
create unique index personal_experiments_one_active on public.personal_experiments(user_id) where status='active';
create index personal_experiments_history on public.personal_experiments(user_id,created_at desc,id);
alter table public.personal_experiments enable row level security;
revoke all on public.personal_experiments from public,anon,authenticated;
grant select on public.personal_experiments to authenticated;
create policy own_experiment_read on public.personal_experiments for select to authenticated using(user_id=(select auth.uid()));

create function public.personal_lab_date(v text) returns date language plpgsql immutable set search_path='' as $$
declare d date;
begin
 if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then return null;end if;
 d:=v::date;
 if to_char(d,'YYYY-MM-DD')<>v then return null;end if;
 return d;
exception when others then return null;
end $$;
create function public.personal_lab_number(v text) returns numeric language plpgsql immutable set search_path='' as $$
begin
 if v is null or btrim(v)='' then return 0;end if;
 return v::numeric;
exception when others then return 0;
end $$;

-- Private helper; only the owner-checked metrics RPC calls this function.
create function public.personal_lab_cohort(p_user uuid,p_template text,p_target integer,p_scope text,p_start date,p_end date,p_today date)
returns jsonb language plpgsql stable set search_path='' as $$
declare r record; tg jsonb; targets jsonb; entry numeric; direction integer; qty numeric; price numeric; exited numeric; rem numeric;
 pl numeric; net numeric:=0; realized integer:=0; records integer:=0; numerator integer:=0; denominator integer:=0;
 activity integer:=0; result jsonb;
begin
 for r in select * from public.trades where user_id=p_user and type=p_scope and not coalesce(deleted,false)
 and public.personal_lab_date(entry_date)>=p_start and public.personal_lab_date(entry_date)<p_end and public.personal_lab_date(entry_date)<=p_today loop
  records:=records+1;
  if (p_template='setup_documented' and r.setup_type in ('vcp','breakout','pullback','powerplay','reversal','earnings','other'))
  or (p_template='reason_documented' and length(btrim(coalesce(r.entry_reason,''),E' \t\r\n'))>0) then numerator:=numerator+1;end if;
  targets:=case when jsonb_typeof(r.targets)='array' then r.targets else '[]'::jsonb end;
  if coalesce(r.close_date,'')<>'' or coalesce(r.exit_price,0)>0 or jsonb_array_length(targets)>0 then
   realized:=realized+1;pl:=0;exited:=0;entry:=coalesce(r.entry_price,0);direction:=case when r.ls in ('L','Long') then 1 else -1 end;
   if jsonb_array_length(targets)>0 then
    for tg in select value from jsonb_array_elements(targets) loop
     qty:=public.personal_lab_number(tg->>'shares');price:=public.personal_lab_number(tg->>'price');
     exited:=exited+qty;
     if qty>0 and price>0 then pl:=pl+direction*(price-entry)*qty;end if;
    end loop;
    rem:=coalesce(nullif(r.closed_shares,0),r.shares,0)-exited;
    if rem>0 and coalesce(r.exit_price,0)>0 then pl:=pl+direction*(r.exit_price-entry)*rem;end if;
   else
    qty:=coalesce(nullif(r.closed_shares,0),r.shares,0);
    if qty>0 and coalesce(r.exit_price,0)>0 then pl:=direction*(r.exit_price-entry)*qty;end if;
   end if;
   net:=net+pl-coalesce(r.ecn,0)-coalesce(r.commission,0);
  end if;
 end loop;
 select count(*),count(*) filter(where n<=p_target) into activity,denominator from (
  select entry_date,count(*) n from public.trades where user_id=p_user and type=p_scope and not coalesce(deleted,false)
  and public.personal_lab_date(entry_date)>=p_start and public.personal_lab_date(entry_date)<p_end and public.personal_lab_date(entry_date)<=p_today group by entry_date
 ) days;
 if p_template='daily_limit' then numerator:=denominator;denominator:=activity;else denominator:=records;end if;
 result:=jsonb_build_object('records',records,'activityDays',activity,'numerator',numerator,'denominator',denominator,
  'adherence',case when denominator>0 then numerator::numeric/denominator*100 else null end,'realizedRecords',realized,'net',net,'missingIds','[]'::jsonb);
 return result;
end $$;

create function public.personal_experiment_metrics(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.personal_experiments;today date;c jsonb;b jsonb;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 select * into e from public.personal_experiments where id=p_id and user_id=auth.uid();
 if not found then raise insufficient_privilege;end if;
 if e.status='completed' then return e.summary_metrics;end if;
 today:=(now() at time zone e.timezone)::date;
 c:=public.personal_lab_cohort(e.user_id,e.template,e.target,e.asset_scope,e.start_date,e.end_date,today);
 b:=public.personal_lab_cohort(e.user_id,e.template,e.target,e.asset_scope,e.start_date-30,e.start_date,today);
 return jsonb_build_object('version',1,'computed_at',clock_timestamp(),'current',c,'baseline',b,
 'smallSample',(c->>'records')::int<20 or (b->>'records')::int<20 or (e.template='daily_limit' and ((c->>'activityDays')::int<5 or (b->>'activityDays')::int<5)));
end $$;

create function public.start_personal_experiment(p_template text,p_asset_scope text,p_target integer,p_timezone text)
returns public.personal_experiments language plpgsql security definer set search_path='' as $$
declare e public.personal_experiments;d date;uid uuid:=auth.uid();
begin
 if uid is null then raise insufficient_privilege;end if;
 if p_template is null or p_template not in ('daily_limit','setup_documented','reason_documented') or p_asset_scope is null or p_asset_scope not in ('stock','crypto')
 or p_target is null or (p_template='daily_limit' and p_target not between 1 and 10) or (p_template<>'daily_limit' and p_target<>100)
 or p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise invalid_parameter_value using message='Invalid experiment configuration';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,82361));
 select * into e from public.personal_experiments where user_id=uid and status='active';
 if found then return e;end if;
 d:=(now() at time zone p_timezone)::date+1;
 insert into public.personal_experiments(user_id,template,asset_scope,target,timezone,start_date,end_date)
 values(uid,p_template,p_asset_scope,p_target,p_timezone,d,d+30) returning * into e;
 return e;
end $$;

create function public.finish_personal_experiment(p_id uuid,p_expected_updated_at timestamptz,p_choice text,p_note text)
returns public.personal_experiments language plpgsql security definer set search_path='' as $$
declare e public.personal_experiments;snapshot jsonb;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 select * into e from public.personal_experiments where id=p_id and user_id=auth.uid() for update;
 if not found then raise insufficient_privilege;end if;
 if e.status<>'active' or e.updated_at is distinct from p_expected_updated_at then raise sqlstate 'PT409' using message='Experiment changed; reload';end if;
 if p_choice is null or p_choice not in ('keep','adjust','inconclusive') or length(coalesce(p_note,''))>500 or (now() at time zone e.timezone)::date<e.end_date then raise invalid_parameter_value;end if;
 snapshot:=public.personal_experiment_metrics(e.id);
 update public.personal_experiments set status='completed',summary_choice=p_choice,summary_note=coalesce(p_note,''),summary_metrics=snapshot,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=e.id returning * into e;
 return e;
end $$;
create function public.cancel_personal_experiment(p_id uuid,p_expected_updated_at timestamptz)
returns public.personal_experiments language plpgsql security definer set search_path='' as $$
declare e public.personal_experiments;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 select * into e from public.personal_experiments where id=p_id and user_id=auth.uid() for update;
 if not found then raise insufficient_privilege;end if;
 if e.status<>'active' or e.updated_at is distinct from p_expected_updated_at then raise sqlstate 'PT409' using message='Experiment changed; reload';end if;
 update public.personal_experiments set status='cancelled',updated_at=clock_timestamp() where id=e.id returning * into e;
 return e;
end $$;
revoke all on function public.personal_lab_date(text),public.personal_lab_number(text),public.personal_lab_cohort(uuid,text,integer,text,date,date,date) from public,anon,authenticated;
revoke all on function public.start_personal_experiment(text,text,integer,text),public.finish_personal_experiment(uuid,timestamptz,text,text),public.cancel_personal_experiment(uuid,timestamptz),public.personal_experiment_metrics(uuid) from public,anon,authenticated;
grant execute on function public.start_personal_experiment(text,text,integer,text),public.finish_personal_experiment(uuid,timestamptz,text,text),public.cancel_personal_experiment(uuid,timestamptz),public.personal_experiment_metrics(uuid) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='personal_experiments') then
  alter publication supabase_realtime add table public.personal_experiments;
 end if;
end $$;
