create or replace function public.save_investment_portfolio(
  p_portfolio_id uuid,
  p_expected_updated_at timestamptz,
  p_portfolio_total numeric,
  p_currency text,
  p_deposits jsonb,
  p_alloc_targets jsonb,
  p_holdings jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_stamp timestamptz;
  v_exists boolean;
  v_rows integer;
  v_ids uuid[];
  v_saved jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform 1 from public.portfolios
    where id = p_portfolio_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Portfolio not found' using errcode = '42501';
  end if;
  if p_currency is null or p_currency not in ('$', '₪')
     or p_portfolio_total < 0
     or jsonb_typeof(p_deposits) is distinct from 'array'
     or jsonb_typeof(p_alloc_targets) is distinct from 'object'
     or jsonb_typeof(p_holdings) is distinct from 'array' then
    raise exception 'Invalid portfolio payload' using errcode = '22023';
  end if;
  select updated_at into v_stamp from public.investments
    where user_id = v_user_id and portfolio_id = p_portfolio_id for update;
  v_exists := found;
  if (v_exists and (p_expected_updated_at is null or v_stamp is distinct from p_expected_updated_at))
     or (not v_exists and p_expected_updated_at is not null) then
    raise exception 'Portfolio changed on another device' using errcode = 'PT409';
  end if;
  if v_exists then
    update public.investments set
      deposits = p_deposits, currency = p_currency,
      alloc_targets = p_alloc_targets, portfolio_total = p_portfolio_total
      where user_id = v_user_id and portfolio_id = p_portfolio_id
      returning updated_at into v_stamp;
  else
    insert into public.investments (user_id, portfolio_id, deposits, currency, alloc_targets, portfolio_total)
      values (v_user_id, p_portfolio_id, p_deposits, p_currency, p_alloc_targets, p_portfolio_total)
      returning updated_at into v_stamp;
  end if;
  if exists (select 1 from jsonb_array_elements(p_holdings) h
             where jsonb_typeof(h) <> 'object' or nullif(btrim(h->>'symbol'), '') is null) then
    raise exception 'Every holding must have a symbol' using errcode = '22023';
  end if;
  with supplied as (
    select coalesce(nullif(h->>'id', '')::uuid, gen_random_uuid()) as id,
           h, ordinality::integer - 1 as position
    from jsonb_array_elements(p_holdings) with ordinality as x(h, ordinality)
  ), saved as (
    insert into public.investment_holdings as existing
      (id, user_id, portfolio_id, symbol, cat, sector, entry_shares, entry_price, current_price, position)
    select id, v_user_id, p_portfolio_id, upper(btrim(h->>'symbol')),
           nullif(h->>'cat', ''), nullif(h->>'sector', ''),
           coalesce((h->>'entry_shares')::numeric, 0), coalesce((h->>'entry_price')::numeric, 0),
           (h->>'current_price')::numeric, position
    from supplied
    on conflict (id) do update set
      symbol = excluded.symbol, cat = excluded.cat, sector = excluded.sector,
      entry_shares = excluded.entry_shares, entry_price = excluded.entry_price,
      current_price = excluded.current_price, position = excluded.position
      where existing.user_id = v_user_id and existing.portfolio_id = p_portfolio_id
    returning id, position
  )
  select count(*), coalesce(array_agg(id), '{}'::uuid[]),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'position', position) order by position), '[]'::jsonb)
    into v_rows, v_ids, v_saved from saved;
  if v_rows <> jsonb_array_length(p_holdings) then
    raise exception 'Holding belongs to another portfolio' using errcode = '42501';
  end if;
  delete from public.investment_holdings
    where user_id = v_user_id and portfolio_id = p_portfolio_id and not (id = any(v_ids));
  return jsonb_build_object('updated_at', v_stamp, 'holdings', v_saved);
end;
$$;

revoke all on function public.save_investment_portfolio(uuid,timestamptz,numeric,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.save_investment_portfolio(uuid,timestamptz,numeric,text,jsonb,jsonb,jsonb) to authenticated;
