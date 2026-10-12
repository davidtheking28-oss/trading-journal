-- Append-only acknowledgements. No historical consent is inferred or backfilled.
create table public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  age_18_confirmed boolean not null check (age_18_confirmed),
  unique (user_id, terms_version, privacy_version)
);
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from anon, authenticated;
grant select on public.legal_acceptances to authenticated;
create policy "read own legal acknowledgement" on public.legal_acceptances
  for select to authenticated using (user_id = (select auth.uid()));

create function public.accept_legal_documents(p_terms_version text, p_privacy_version text, p_age_18 boolean)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare receipt timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_age_18 is distinct from true then raise exception 'Age confirmation required' using errcode = '22023'; end if;
  if p_terms_version is distinct from '2026-10-12' or p_privacy_version is distinct from '2026-10-12' then
    raise exception 'Unsupported legal document version' using errcode = '22023';
  end if;
  insert into public.legal_acceptances(user_id, terms_version, privacy_version, age_18_confirmed)
    values(auth.uid(), p_terms_version, p_privacy_version, true)
    on conflict (user_id, terms_version, privacy_version) do nothing;
  select accepted_at into receipt from public.legal_acceptances
    where user_id = auth.uid() and terms_version = p_terms_version and privacy_version = p_privacy_version;
  return receipt;
end;
$$;
revoke all on function public.accept_legal_documents(text,text,boolean) from public, anon;
grant execute on function public.accept_legal_documents(text,text,boolean) to authenticated;
