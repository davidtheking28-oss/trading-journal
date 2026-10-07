begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users order by created_at limit 1), true);
set local role authenticated;
do $$
declare
  v_user uuid := auth.uid();
  v_portfolio uuid;
  v_other uuid;
  v_saved jsonb;
  v_stamp timestamptz;
  v_holding uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if v_user is null then raise exception 'Test requires an existing account'; end if;
  insert into public.portfolios(user_id, name) values(v_user, 'rollback-only atomic save test') returning id into v_portfolio;
  insert into public.portfolios(user_id, name) values(v_user, 'rollback-only other portfolio') returning id into v_other;
  v_saved := public.save_investment_portfolio(v_portfolio, null, 100, '$', '[]', '{}',
    '[{"symbol":"AAPL","entry_shares":2,"entry_price":10}]');
  v_stamp := (v_saved->>'updated_at')::timestamptz;
  v_holding := (v_saved->'holdings'->0->>'id')::uuid;
  if v_stamp is null or v_holding is null then raise exception 'Missing generated identity or timestamp'; end if;
  select jsonb_build_object('doc',to_jsonb(i),'holdings',(select jsonb_agg(to_jsonb(h)) from public.investment_holdings h where portfolio_id=v_portfolio))
    into v_before from public.investments i where portfolio_id=v_portfolio;
  begin
    perform public.save_investment_portfolio(v_portfolio, v_stamp, 999, '$', '[]', '{}',
      '[{"symbol":"FAIL","entry_shares":-1,"entry_price":10}]');
    raise exception 'Invalid holding was accepted';
  exception when check_violation then null;
  end;
  select jsonb_build_object('doc',to_jsonb(i),'holdings',(select jsonb_agg(to_jsonb(h)) from public.investment_holdings h where portfolio_id=v_portfolio))
    into v_after from public.investments i where portfolio_id=v_portfolio;
  if v_before is distinct from v_after then raise exception 'Failed save changed persisted data'; end if;
  begin
    perform public.save_investment_portfolio(v_portfolio, '2000-01-01', 888, '$', '[]', '{}', '[]');
    raise exception 'Stale save was accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.save_investment_portfolio(v_other, null, 50, '$', '[]', '{}',
      jsonb_build_array(jsonb_build_object('id',v_holding,'symbol','STOLEN')));
    raise exception 'Holding moved between portfolios';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.investments where portfolio_id=v_other) then raise exception 'Unauthorized holding write partially created a document'; end if;
  if (select symbol from public.investment_holdings where id=v_holding) <> 'AAPL' then raise exception 'Original holding changed'; end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.save_investment_portfolio(v_portfolio, v_stamp, 888, '$', '[]', '{}', '[]');
    raise exception 'Another account wrote to the portfolio';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  v_saved := public.save_investment_portfolio(v_portfolio, v_stamp, 200, '$', '[]', '{}',
    jsonb_build_array(jsonb_build_object('id',v_holding,'symbol','AAPL','entry_shares',3,'entry_price',12)));
  if (v_saved->'holdings'->0->>'id')::uuid <> v_holding then raise exception 'Holding identity changed'; end if;
  v_stamp := (v_saved->>'updated_at')::timestamptz;
  perform public.save_investment_portfolio(v_portfolio, v_stamp, 200, '$', '[]', '{}', '[]');
  if exists(select 1 from public.investment_holdings where portfolio_id=v_portfolio) then raise exception 'Last holding was not deleted'; end if;
  if has_function_privilege('anon', 'public.save_investment_portfolio(uuid,timestamptz,numeric,text,jsonb,jsonb,jsonb)', 'execute') then raise exception 'Anonymous execution allowed'; end if;
end;
$$;
rollback;
