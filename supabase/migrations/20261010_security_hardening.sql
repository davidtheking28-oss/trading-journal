create or replace function public.client_errors_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recent int;
begin
  new.kind := left(new.kind, 60);
  new.message := left(new.message, 1000);
  new.source := left(new.source, 300);
  new.stack := left(new.stack, 4000);
  new.app := left(new.app, 60);
  new.ua := left(new.ua, 300);
  if new.user_id is null then
    select count(*) into recent from public.client_errors where user_id is null and created_at > now() - interval '1 minute';
    if recent >= 20 then return null; end if;
  else
    select count(*) into recent from public.client_errors where user_id = new.user_id and created_at > now() - interval '1 minute';
    if recent >= 30 then return null; end if;
  end if;
  return new;
end $$;

drop trigger if exists client_errors_guard on public.client_errors;
create trigger client_errors_guard before insert on public.client_errors
for each row execute function public.client_errors_guard();

create or replace function public.support_messages_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recent int;
begin
  if length(coalesce(new.body, '')) > 4000 then raise exception 'support message too long' using errcode = '22001'; end if;
  new.email := left(new.email, 254);
  new.topic := left(new.topic, 100);
  new.app := left(new.app, 60);
  new.ua := left(new.ua, 300);
  if new.user_id is null then
    select count(*) into recent from public.support_messages where user_id is null and created_at > now() - interval '1 hour';
    if recent >= 10 then raise exception 'too many support messages, try again later' using errcode = '54000'; end if;
  else
    select count(*) into recent from public.support_messages where user_id = new.user_id and created_at > now() - interval '1 hour';
    if recent >= 5 then raise exception 'too many support messages, try again later' using errcode = '54000'; end if;
  end if;
  return new;
end $$;

drop trigger if exists support_messages_guard on public.support_messages;
create trigger support_messages_guard before insert on public.support_messages
for each row execute function public.support_messages_guard();

revoke execute on function public.client_errors_guard() from public, anon, authenticated;
revoke execute on function public.support_messages_guard() from public, anon, authenticated;
revoke execute on function public.enforce_admin_only_flex_confirm() from public, anon, authenticated;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and (c.relname like '%\_backup\_%' escape '\' or c.relname like '%\_restored\_%' escape '\')
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
