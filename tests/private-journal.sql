-- Run through the SQL tool. All test writes roll back. No personal data returned.
begin;
do $$
declare existing_id uuid; denied_id uuid:=gen_random_uuid(); accepted boolean;
begin
 insert into auth.users(id) values(denied_id);
 -- Shared Auth user creation remains possible (e.g. advisor onboarding).
 select user_id into existing_id from public.journal_members limit 1;
 if existing_id is null then raise exception 'No existing journal member';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',existing_id,'role','authenticated')::text,true);
 if not public.journal_access_allowed() then raise exception 'Existing member denied';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',denied_id,'role','authenticated')::text,true);
 if public.journal_access_allowed() then raise exception 'Unknown member admitted';end if;
 begin
  perform public.accept_legal_documents('2026-10-12','2026-10-12',true);
  raise exception 'Definer write unexpectedly admitted';
 exception when insufficient_privilege then null;
 end;
 if has_table_privilege('authenticated','public.journal_members','INSERT') then raise exception 'Clients can self-admit';end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename like 'advisor%' and policyname='journal_members_only') then raise exception 'Advisor policies changed';end if;
end $$;
set local role authenticated;
select count(*)=0 as denied_reads_empty from public.trades;
rollback;
