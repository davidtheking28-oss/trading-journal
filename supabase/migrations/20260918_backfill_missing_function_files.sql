-- Housekeeping, no behavior change: 16 functions existed only in the
-- database, with no migration file — CI has never verified any of them
-- deploy-from-scratch, including get_broker_secret/set_broker_secret, which
-- gate access to Vault-stored IBKR/Bybit credentials. Bodies pulled verbatim
-- via pg_get_functiondef and re-applied as CREATE OR REPLACE (idempotent).
-- purge_old_deleted_trades is intentionally excluded — it already has its own
-- file (20260918_fix_purge_archive_conflict.sql), which supersedes this.

CREATE OR REPLACE FUNCTION public.get_broker_secret(p_user_id uuid, p_field text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF NOT (auth.uid() = p_user_id OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'broker:' || p_user_id || ':' || p_field);
END $function$;

CREATE OR REPLACE FUNCTION public.set_broker_secret(p_field text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE nm text; sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_field NOT IN ('bybit_api_key','bybit_api_secret','flex_token') THEN
    RAISE EXCEPTION 'unsupported field %', p_field;
  END IF;
  nm := 'broker:' || auth.uid() || ':' || p_field;
  SELECT id INTO sid FROM vault.secrets WHERE name = nm;
  IF p_value IS NULL OR p_value = '' THEN
    IF sid IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = sid; END IF;
  ELSIF sid IS NULL THEN
    PERFORM vault.create_secret(p_value, nm);
  ELSE
    PERFORM vault.update_secret(sid, p_value);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.broker_secrets_present()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
  SELECT jsonb_object_agg(f, EXISTS (
           SELECT 1 FROM vault.secrets s WHERE s.name = 'broker:' || auth.uid() || ':' || f))
  FROM unnest(ARRAY['bybit_api_key','bybit_api_secret','flex_token']) AS f;
$function$;

CREATE OR REPLACE FUNCTION public.is_advisor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.advisors where user_id = auth.uid()) $function$;

CREATE OR REPLACE FUNCTION public.attach_pending_advisor_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.advisor_clients
    set client_id = new.id, invited_email = null
    where invited_email = lower(new.email)
      and client_id is null
      and status = 'pending';
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.invite_client_by_email(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := lower(trim(p_email));
  v_client_id uuid;
  v_recent int;
begin
  if auth.uid() is null then
    return 'not_found';
  end if;

  if not public.is_advisor() then
    return 'not_advisor';
  end if;

  if v_email is null or v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'invalid_email';
  end if;

  select count(*) into v_recent from public.advisor_invite_attempts
    where actor = auth.uid() and attempted_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    return 'rate_limited';
  end if;
  insert into public.advisor_invite_attempts(actor) values (auth.uid());

  select id into v_client_id from auth.users where lower(email) = v_email limit 1;

  if v_client_id is not null and v_client_id = auth.uid() then
    return 'self';
  end if;

  if v_client_id is not null and exists (
    select 1 from public.advisor_clients
      where advisor_id = auth.uid() and client_id = v_client_id and status = 'active'
  ) then
    return 'already_linked';
  end if;

  if exists (
    select 1 from public.advisor_clients
      where advisor_id = auth.uid()
        and status = 'pending'
        and (client_id = v_client_id or (client_id is null and invited_email = v_email))
  ) then
    return 'already_invited';
  end if;

  insert into public.advisor_clients (advisor_id, client_id, client_email, invited_email, status)
    values (auth.uid(), v_client_id, v_email, case when v_client_id is null then v_email else null end, 'pending');

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_advisor_invite(p_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.advisor_clients;
  v_updated int;
  v_recent int;
begin
  if auth.uid() is null then
    return 'not_found';
  end if;

  if not public.is_advisor() then
    return 'not_advisor';
  end if;

  select count(*) into v_recent from public.advisor_invite_attempts
    where actor = auth.uid() and attempted_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    return 'rate_limited';
  end if;
  insert into public.advisor_invite_attempts(actor) values (auth.uid());

  select * into v_row from public.advisor_clients
    where invite_code = p_code
      and status = 'pending'
      and advisor_id is null
      and (expires_at is null or expires_at > now());
  if v_row.id is null then
    return 'not_found';
  end if;
  if v_row.client_id = auth.uid() then
    return 'self';
  end if;

  update public.advisor_clients
    set advisor_id = auth.uid(), status = 'active', expires_at = null
    where id = v_row.id
      and status = 'pending'
      and advisor_id is null
      and (expires_at is null or expires_at > now());
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return 'not_found';
  end if;

  -- a successful claim clears the caller's throttle budget
  delete from public.advisor_invite_attempts where actor = auth.uid();
  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.respond_advisor_invite(p_id uuid, p_accept boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated int;
begin
  if auth.uid() is null then
    return 'not_found';
  end if;

  if p_accept then
    update public.advisor_clients
      set status = 'active'
      where id = p_id and client_id = auth.uid() and status = 'pending' and advisor_id is not null;
  else
    delete from public.advisor_clients
      where id = p_id and client_id = auth.uid() and status = 'pending' and advisor_id is not null;
  end if;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return 'not_found';
  end if;
  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_task_done(p_task_id uuid, p_done boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated int;
begin
  update public.advisor_tasks t
  set done = p_done
  where t.id = p_task_id
    and t.client_id = auth.uid()
    and t.for_client
    and exists (
      select 1 from public.advisor_clients ac
      where ac.client_id = auth.uid()
        and ac.advisor_id = t.advisor_id
        and ac.status = 'active'
    );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_report_share(p_client_id uuid, p_year integer, p_month integer, p_mode text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.is_advisor() then
    return null;
  end if;

  if not exists (
    select 1 from public.advisor_clients
    where advisor_id = auth.uid() and client_id = p_client_id and status = 'active'
  ) then
    return null;
  end if;

  insert into public.report_shares (advisor_id, client_id, year, month, budget_mode)
    values (auth.uid(), p_client_id, p_year, p_month, coalesce(p_mode, 'personal'))
    returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_shared_report(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_share public.report_shares%rowtype;
  v_row public.budget_data%rowtype;
  v_advisor record;
  v_client_email text;
  v_data jsonb;
  v_month_prefix text;
  v_tx jsonb;
  v_filtered_tx jsonb;
begin
  select * into v_share from public.report_shares
    where id = p_token and revoked_at is null;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_row from public.budget_data where user_id = v_share.client_id;

  select display_name, logo_url into v_advisor from public.advisors where user_id = v_share.advisor_id;

  select client_email into v_client_email from public.advisor_clients
    where advisor_id = v_share.advisor_id and client_id = v_share.client_id
    limit 1;

  v_month_prefix := v_share.year || '-' || lpad((v_share.month + 1)::text, 2, '0');

  v_tx := case when v_share.budget_mode = 'business'
    then coalesce(v_row.business -> 'transactions', '[]'::jsonb)
    else coalesce(v_row.transactions, '[]'::jsonb) end;

  select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_filtered_tx
    from jsonb_array_elements(v_tx) elem
    where elem ->> 'date' like v_month_prefix || '%';

  if v_share.budget_mode = 'business' then
    v_data := jsonb_build_object(
      'budgets', coalesce(v_row.business -> 'budgets', '{}'::jsonb),
      'transactions', v_filtered_tx,
      'goals', coalesce(v_row.business -> 'goals', '[]'::jsonb)
    );
  else
    v_data := jsonb_build_object(
      'budgets', coalesce(v_row.budgets, '{}'::jsonb),
      'transactions', v_filtered_tx,
      'goals', coalesce(v_row.goals, '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'year', v_share.year,
    'month', v_share.month,
    'client_email', v_client_email,
    'advisor_display_name', v_advisor.display_name,
    'advisor_logo_url', v_advisor.logo_url,
    'data', v_data
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_report_share(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.report_shares set revoked_at = now()
    where id = p_id and advisor_id = auth.uid();
  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.households_freeze_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- Missing SET search_path fixed 2026-09-18 (get_advisors security lint) —
-- low risk since this is invoker-only (not SECURITY DEFINER), but flagged and
-- one line to close.
CREATE OR REPLACE FUNCTION public.households_restrict_member_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() = old.member_id and auth.uid() <> old.owner_id then
    if new.owner_id is distinct from old.owner_id
       or new.invite_code is distinct from old.invite_code
       or new.owner_email is distinct from old.owner_email
       or new.created_at is distinct from old.created_at
       or new.member_id is not null then
      raise exception 'member can only leave the household (set member_id to null)';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preserve_first_seen()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.first_seen = OLD.first_seen;
  RETURN NEW;
END;
$function$;
