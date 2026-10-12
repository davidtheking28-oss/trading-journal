-- Read-only verification under two real identities. No credentials or journal
-- data are returned. Transaction-local role/claims are rolled back.
begin;
do $$
declare
  actor uuid;
  other_user uuid;
  denied boolean := false;
begin
  select id into actor from auth.users order by created_at limit 1;
  select id into other_user from auth.users where id <> actor order by created_at limit 1;
  if actor is null or other_user is null then raise exception 'Two identities required for this check'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists(select 1 from public.trades where user_id = other_user)
    or exists(select 1 from public.user_settings where user_id = other_user)
    or exists(select 1 from public.flex_statement_cache where user_id = other_user)
    or exists(select 1 from public.broker_balances where user_id = other_user) then
    raise exception 'Broker records exposed across users';
  end if;
  begin
    perform public.get_broker_secret(other_user, 'bybit_api_key');
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Broker credential ownership check failed'; end if;
  reset role;
end;
$$;
select 'broker tables and credential RPC enforce account ownership; no trading data changed' as verification;
rollback;
