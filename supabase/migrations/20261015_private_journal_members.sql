-- Journal-only access. Do not disable signup in the shared Supabase Auth project.
create table public.journal_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 admitted_at timestamptz not null default now()
);
alter table public.journal_members enable row level security;
revoke all on public.journal_members from public,anon,authenticated;
grant select on public.journal_members to authenticated;
create policy "read own journal membership" on public.journal_members
 for select to authenticated using (user_id=(select auth.uid()));
-- One-time snapshot; future Auth users (including advisor clients) are NOT added.
insert into public.journal_members(user_id) select id from auth.users;

create function public.journal_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.journal_members where user_id=auth.uid()
 );
$$;
revoke all on function public.journal_access_allowed() from public,anon;
grant execute on function public.journal_access_allowed() to authenticated;

-- Restrictive policies compose with existing ownership policies rather than replacing them.
-- Shared advisor/budget tables, Auth and user_settings are deliberately untouched.
create function public.require_journal_member_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')='authenticated' and not public.journal_access_allowed() then
  raise exception 'Journal access is limited to existing members' using errcode='42501';
 end if;
 if TG_OP='DELETE' then return OLD;end if;
 return NEW;
end;
$$;
revoke all on function public.require_journal_member_write() from public,anon,authenticated;

do $$
declare name text;
begin
 foreach name in array array['trades','missed_opportunities','investments','investment_holdings',
 'portfolios','personal_experiments','flex_statement_cache','broker_balances','legal_acceptances',
 'screener_watchlist','screener_prefs'] loop
  execute format('create policy journal_members_only on public.%I as restrictive for all to authenticated using ((select public.journal_access_allowed())) with check ((select public.journal_access_allowed()))',name);
  -- Security-definer journal mutations bypass RLS; the trigger also checks the caller JWT.
  execute format('create trigger journal_member_write before insert or update or delete on public.%I for each row execute function public.require_journal_member_write()',name);
 end loop;
end $$;

comment on table public.journal_members is 'Explicit journal access only. New shared-auth accounts are not automatically admitted. Manage through trusted SQL administration; no client insert permissions.';
