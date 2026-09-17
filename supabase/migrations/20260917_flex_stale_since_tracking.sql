-- Replaces the flex_fetched_not_imported heuristic from
-- 20260917_flex_imported_stale_check.sql: `imported_at is null` right after a
-- cron fetch is NORMAL (ibkr-cron always resets it to null on every
-- successful fetch, so the client can tell a fresh statement needs
-- importing) — checked live against the two healthy, actively-used accounts
-- and both false-positived on it, since imported_at is routinely null for a
-- few hours between a cron run and the user's next visit. fetched_at can't
-- fix this either: it's also overwritten every run, so it can never reveal
-- "stuck since when" — only a persisted marker that survives the upsert can.
--
-- stale_since is that marker, maintained by a trigger instead of editing
-- ibkr-cron (no redeploy needed, and the logic belongs next to the data it
-- protects): null while imported_at is set (healthy), and set to now() the
-- moment imported_at goes null with nothing already tracking it — then left
-- alone on every subsequent fetch that still hasn't been imported, so it
-- keeps the time the gap actually started rather than resetting each cron run.
alter table flex_statement_cache add column stale_since timestamptz;
alter table flex_statement_cache add column confirm_stale_since timestamptz;

create or replace function flex_cache_track_staleness()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.imported_at is not null then
    new.stale_since := null;
  else
    new.stale_since := coalesce(old.stale_since, now());
  end if;

  if new.confirm_imported_at is not null then
    new.confirm_stale_since := null;
  else
    new.confirm_stale_since := coalesce(old.confirm_stale_since, now());
  end if;
  return new;
end;
$$;

create trigger flex_cache_staleness
before update on flex_statement_cache
for each row execute function flex_cache_track_staleness();
