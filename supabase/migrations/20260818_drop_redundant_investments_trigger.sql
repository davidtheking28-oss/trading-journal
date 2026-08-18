-- 20260817_investments_updated_at_trigger.sql added a BEFORE UPDATE trigger on
-- public.investments on the premise that updated_at was set by the insert
-- default alone and never moved again. That premise was wrong: the table
-- already had investments_updated_at running update_investments_timestamp(),
-- which does exactly the same thing. Two triggers were firing per update and
-- assigning the same now().
--
-- Dropping the newer one. The pre-existing trigger stays and keeps the
-- optimistic-concurrency guard in the client working. set_updated_at() is used
-- by nothing else (verified against pg_trigger) and, unlike the function that
-- remains, it carries no `SET search_path`, so it goes too.
drop trigger if exists investments_set_updated_at on public.investments;
drop function if exists public.set_updated_at();
