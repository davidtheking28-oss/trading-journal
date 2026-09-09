-- auth.uid() in a policy re-evaluates per row; (select auth.uid()) lets the
-- planner evaluate it once per query (Supabase's auth_rls_initplan lint).
-- Same access rule, cheaper on large scans. No behavior change.
drop policy "user reads own balance" on public.broker_balances;
create policy "user reads own balance" on public.broker_balances
  for select
  using ((select auth.uid()) = user_id);

drop policy "user owns holding" on public.investment_holdings;
create policy "user owns holding" on public.investment_holdings
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
