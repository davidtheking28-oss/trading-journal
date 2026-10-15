-- Dedicated fake users and trades; every write is rolled back.
begin;
insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','lab-a@example.invalid'),('22222222-2222-4222-8222-222222222222','lab-b@example.invalid');
insert into public.journal_members(user_id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$
declare a public.personal_experiments; b public.personal_experiments;
begin
 a := public.start_personal_experiment('daily_limit','stock',3,'Asia/Jerusalem');
 b := public.start_personal_experiment('daily_limit','stock',3,'Asia/Jerusalem');
 if a.id <> b.id or a.end_date-a.start_date <> 30 then raise exception 'Retry or duration broken'; end if;
 begin perform public.finish_personal_experiment(a.id,a.updated_at,'keep','');raise exception 'Early completion accepted';exception when invalid_parameter_value then null;end;
 begin perform public.cancel_personal_experiment(a.id,a.updated_at-interval '1 second');raise exception 'Stale write accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.start_personal_experiment('unknown','stock',3,'Asia/Jerusalem');raise exception 'Invalid template accepted';exception when invalid_parameter_value then null;end;
 if has_table_privilege('authenticated','public.personal_experiments','INSERT') or has_table_privilege('authenticated','public.personal_experiments','UPDATE') or has_table_privilege('anon','public.personal_experiments','SELECT') then raise exception 'Excess privileges';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $$ begin if exists(select 1 from public.personal_experiments) then raise exception 'Other user visible';end if;end $$;
reset role;
select 'personal lab checks passed; rolling back' as result;
rollback;

-- The same financial cases are exercised by tests/personal-lab.test.mjs.
begin;
insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','lab-a@example.invalid'),('22222222-2222-4222-8222-222222222222','lab-b@example.invalid');
do $test$
declare item jsonb;r public.trades;m jsonb;e public.personal_experiments;snapshot jsonb;uid uuid:='11111111-1111-4111-8111-111111111111';eid uuid;
begin
 for item in select value from jsonb_array_elements($fixtures$[
 {"row":{"type":"stock","symbol":"LAB","entry_date":"2026-10-15","entry_price":100,"shares":10,"exit_price":110,"ls":"L","commission":2},"net":98,"realized":1},
 {"row":{"type":"stock","symbol":"LAB","entry_date":"2026-10-15","entry_price":100,"shares":10,"exit_price":90,"ls":"S","commission":2},"net":98,"realized":1},
 {"row":{"type":"stock","symbol":"LAB","entry_date":"2026-10-15","entry_price":100,"shares":10,"exit_price":90,"targets":[{"shares":4,"price":110}],"ls":"L","commission":2},"net":-22,"realized":1},
 {"row":{"type":"stock","symbol":"LAB","entry_date":"2026-10-15","entry_price":100,"shares":10,"exit_price":null,"ls":"L"},"net":0,"realized":0},
 {"row":{"type":"stock","symbol":"LAB","entry_date":"2026-10-15","entry_price":100,"shares":10,"closed_shares":0,"exit_price":110,"ls":"Long","ecn":1,"commission":1},"net":98,"realized":1}
]
$fixtures$::jsonb) loop
  r:=jsonb_populate_record(null::public.trades,item->'row');
  insert into public.trades(user_id,type,symbol,entry_date,entry_price,shares,closed_shares,exit_price,targets,ls,ecn,commission)
  values(uid,r.type,r.symbol,r.entry_date,r.entry_price,r.shares,r.closed_shares,r.exit_price,r.targets,r.ls,r.ecn,r.commission);
  m:=public.personal_lab_cohort(uid,'daily_limit',3,'stock','2026-10-15','2026-11-14','2026-10-16');
  if (m->>'net')::numeric<>(item->>'net')::numeric or (m->>'realizedRecords')::int<>(item->>'realized')::int then raise exception 'Financial fixture mismatch';end if;
  delete from public.trades where user_id=uid;
 end loop;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 e:=public.start_personal_experiment('reason_documented','stock',100,'Asia/Jerusalem');
 eid:=e.id;
 begin
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  perform public.personal_experiment_metrics(eid);
  raise exception 'Other account metrics exposed';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 update public.personal_experiments set start_date=(now() at time zone timezone)::date-30,end_date=(now() at time zone timezone)::date where id=eid returning * into e;
 e:=public.finish_personal_experiment(e.id,e.updated_at,'inconclusive','rollback only');
 snapshot:=e.summary_metrics;
 insert into public.trades(user_id,type,symbol,entry_date,entry_price,shares,exit_price,ls) values(uid,'stock','LAB',((now() at time zone 'Asia/Jerusalem')::date-1)::text,10,1,20,'L');
 if public.personal_experiment_metrics(e.id)<>snapshot then raise exception 'Historical snapshot mutated';end if;
 if e.status<>'completed' then raise exception 'Completion failed';end if;
 begin perform public.cancel_personal_experiment(e.id,e.updated_at);raise exception 'Completed experiment mutated';exception when sqlstate 'PT409' then null;end;
 begin perform public.start_personal_experiment('daily_limit','stock',11,'Invalid/Zone');raise exception 'Bad config accepted';exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.start_personal_experiment('daily_limit','stock',3,'UTC');raise exception 'Anonymous start accepted';exception when insufficient_privilege then null;end;
end $test$;
select 'financial fixtures, ownership, snapshots and lifecycle passed; rolling back' as result;
rollback;

begin;
insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','lab-a@example.invalid');
insert into public.trades(user_id,type,symbol,entry_date,entry_price,shares,ls,entry_reason) values('11111111-1111-4111-8111-111111111111','stock','LAB','2026-10-15',100,1,'L',chr(160));
do $$ declare m jsonb;begin
 m:=public.personal_lab_cohort('11111111-1111-4111-8111-111111111111','reason_documented',100,'stock','2026-10-15','2026-11-14','2026-10-16');
 if (m->>'numerator')::int<>0 then raise exception 'Whitespace-only reason was counted as documentation';end if;
end $$;
rollback;

begin;
insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','lab-a@example.invalid');
insert into public.trades(user_id,type,symbol,entry_date,entry_price,shares,exit_price,targets,ls,commission) values('11111111-1111-4111-8111-111111111111','stock','LAB','2026-10-15',100,10,90,to_jsonb('[{"shares":4,"price":110}]'::text),'L',2);
do $$ declare m jsonb;begin
 m:=public.personal_lab_cohort('11111111-1111-4111-8111-111111111111','daily_limit',3,'stock','2026-10-15','2026-11-14','2026-10-16');
 if (m->>'net')::numeric<>-22 then raise exception 'String-encoded target parity failed';end if;
end $$;
rollback;
