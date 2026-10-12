-- Rollback-only checks: use an existing ID internally; never output account data.
begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users limit 1), true);
set local role authenticated;
do $$
declare first_receipt timestamptz; second_receipt timestamptz;
begin
  first_receipt := public.accept_legal_documents('2026-10-12','2026-10-12',true);
  second_receipt := public.accept_legal_documents('2026-10-12','2026-10-12',true);
  if first_receipt is null or first_receipt is distinct from second_receipt then raise exception 'Receipt changed on retry'; end if;
  if exists(select 1 from public.legal_acceptances where user_id <> auth.uid()) then raise exception 'Other user visible'; end if;
  begin
    perform public.accept_legal_documents('2026-10-12','2026-10-12',false);
    raise exception 'False age accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.accept_legal_documents('unknown','2026-10-12',true);
    raise exception 'Unknown version accepted';
  exception when invalid_parameter_value then null;
  end;
  if has_table_privilege('authenticated','public.legal_acceptances','UPDATE') or
     has_table_privilege('authenticated','public.legal_acceptances','INSERT') or
     has_table_privilege('authenticated','public.legal_acceptances','DELETE') then raise exception 'Receipt mutable'; end if;
end;
$$;
reset role;
select 'legal checks passed; rolling back' as result;
rollback;
