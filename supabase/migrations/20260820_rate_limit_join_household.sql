-- join_household had no throttling at all against a 6-character invite code,
-- while claim_advisor_invite next to it has been throttled since it shipped.
-- Zero households exist today, so nothing is exposed yet — this lands before
-- the feature ships rather than after it is abused.
--
-- Two limits, because one is not enough:
--   • per actor (10 / 10 min), matching the existing advisor pattern;
--   • per code, globally (20 / hour) — an attacker who registers fresh accounts
--     resets the per-actor budget, so the code itself has to carry one too.
-- Codes are stored hashed: this table is a throttle ledger, not a place to
-- accumulate a list of live invite codes.
--
-- digest() lives in the `extensions` schema and this function pins search_path
-- to public (which is what makes a SECURITY DEFINER function safe), so the call
-- must be schema-qualified — unqualified it throws on every invocation.
alter table public.advisor_invite_attempts
  add column if not exists kind   text not null default 'advisor',
  add column if not exists target text;

create index if not exists advisor_invite_attempts_kind_time
  on public.advisor_invite_attempts (kind, attempted_at desc);
create index if not exists advisor_invite_attempts_target_time
  on public.advisor_invite_attempts (kind, target, attempted_at desc);

create or replace function public.join_household(p_code text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_updated int;
  v_recent  int;
  v_percode int;
  v_target  text;
begin
  if auth.uid() is null then
    return false;
  end if;

  v_target := encode(extensions.digest(coalesce(p_code,''), 'sha256'), 'hex');

  select count(*) into v_recent from public.advisor_invite_attempts
   where actor = auth.uid() and kind = 'household'
     and attempted_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    return false;
  end if;

  select count(*) into v_percode from public.advisor_invite_attempts
   where kind = 'household' and target = v_target
     and attempted_at > now() - interval '1 hour';
  if v_percode >= 20 then
    return false;
  end if;

  insert into public.advisor_invite_attempts(actor, kind, target)
  values (auth.uid(), 'household', v_target);

  update public.households
     set member_id = auth.uid(),
         member_email = (select email from auth.users where id = auth.uid())
   where invite_code = p_code
     and member_id is null
     and owner_id <> auth.uid();
  get diagnostics v_updated = row_count;

  -- A successful join clears the caller's budget, exactly as the advisor claim
  -- does: the limit exists to slow guessing, not to punish a legitimate join.
  if v_updated > 0 then
    delete from public.advisor_invite_attempts
     where actor = auth.uid() and kind = 'household';
  end if;
  return v_updated > 0;
end;
$function$;
