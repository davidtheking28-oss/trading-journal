-- Match supported legacy target encoding and ECMAScript trim semantics.
create or replace function public.personal_lab_cohort(p_user uuid,p_template text,p_target integer,p_scope text,p_start date,p_end date,p_today date)
returns jsonb language plpgsql stable set search_path='' as $$
declare r record; tg jsonb; targets jsonb; entry numeric; direction integer; qty numeric; price numeric; exited numeric; rem numeric;
 pl numeric; net numeric:=0; realized integer:=0; records integer:=0; numerator integer:=0; denominator integer:=0;
 activity integer:=0; result jsonb;
begin
 for r in select * from public.trades where user_id=p_user and type=p_scope and not coalesce(deleted,false)
 and public.personal_lab_date(entry_date)>=p_start and public.personal_lab_date(entry_date)<p_end and public.personal_lab_date(entry_date)<=p_today loop
  records:=records+1;
  if (p_template='setup_documented' and r.setup_type in ('vcp','breakout','pullback','powerplay','reversal','earnings','other'))
  or (p_template='reason_documented' and length(btrim(coalesce(r.entry_reason,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0) then numerator:=numerator+1;end if;
  targets:=r.targets;
  if jsonb_typeof(targets)='string' then
   begin targets:=(targets #>> '{}')::jsonb; exception when others then targets:='[]'::jsonb; end;
  end if;
  targets:=case when jsonb_typeof(targets)='array' then targets else '[]'::jsonb end;
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
