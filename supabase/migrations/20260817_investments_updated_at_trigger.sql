-- invSaveData rewrites the whole holdings document on every save, so two tabs
-- (or two devices) editing different rows silently overwrote each other: last
-- write wins, no error, no way to notice.
--
-- The client now guards its update with `.eq('updated_at', <value it loaded>)`
-- and reloads instead of clobbering when zero rows match. That only works if
-- updated_at actually moves on every write — until this trigger it was set by
-- the insert default alone and then never changed again.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists investments_set_updated_at on public.investments;
create trigger investments_set_updated_at
  before update on public.investments
  for each row execute function public.set_updated_at();
