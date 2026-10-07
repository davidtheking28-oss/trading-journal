begin;
create temporary table restore_portfolios (like public.portfolios including all);
create temporary table restore_trades (like public.trades including all);
create temporary table restore_investments (like public.investments including all);
create temporary table restore_holdings (like public.investment_holdings including all);

insert into restore_portfolios select * from public.portfolios_backup_20261007_pre_atomic_frontend;
insert into restore_trades select * from public.trades_backup_20261007_pre_atomic_frontend;
insert into restore_investments select * from public.investments_backup_20261007_pre_atomic_frontend;
insert into restore_holdings select * from public.investment_holdings_backup_20261007_pre_atomic_frontend;

do $$
begin
  if exists (select * from public.trades_backup_20261007_pre_atomic_frontend except select * from restore_trades)
     or exists (select * from restore_trades except select * from public.trades_backup_20261007_pre_atomic_frontend)
     or exists (select * from public.investments_backup_20261007_pre_atomic_frontend except select * from restore_investments)
     or exists (select * from restore_investments except select * from public.investments_backup_20261007_pre_atomic_frontend)
     or exists (select * from public.investment_holdings_backup_20261007_pre_atomic_frontend except select * from restore_holdings)
     or exists (select * from restore_holdings except select * from public.investment_holdings_backup_20261007_pre_atomic_frontend)
     or exists (select * from public.portfolios_backup_20261007_pre_atomic_frontend except select * from restore_portfolios)
     or exists (select * from restore_portfolios except select * from public.portfolios_backup_20261007_pre_atomic_frontend) then
    raise exception 'Restored data differs from backup';
  end if;
  if exists(select 1 from restore_investments i left join restore_portfolios p on p.id=i.portfolio_id and p.user_id=i.user_id where p.id is null)
     or exists(select 1 from restore_holdings h left join restore_investments i on i.portfolio_id=h.portfolio_id and i.user_id=h.user_id where i.id is null)
     or exists(select 1 from restore_trades t left join auth.users u on u.id=t.user_id where u.id is null) then
    raise exception 'Restored data has an invalid owner or portfolio relationship';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('trades_backup_20261007_pre_atomic_frontend','investments_backup_20261007_pre_atomic_frontend',
        'investment_holdings_backup_20261007_pre_atomic_frontend','portfolios_backup_20261007_pre_atomic_frontend')
        and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'select') or has_table_privilege('authenticated',c.oid,'select'))) then
    raise exception 'Backup is accessible to an application role';
  end if;
end;
$$;

select jsonb_build_object('trades',(select count(*) from restore_trades),
  'investment_documents',(select count(*) from restore_investments),
  'holdings',(select count(*) from restore_holdings),'portfolios',(select count(*) from restore_portfolios),
  'result','restored identical rows with current schema constraints and validated relationships') as restore_verification;
rollback;
