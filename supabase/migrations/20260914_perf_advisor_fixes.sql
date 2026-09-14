-- Fixes for the Supabase performance/security advisor lints that are
-- actually trading-journal's (not the sibling budget/advisor app sharing
-- this project). See screener_4round_improvement_2026_09 memory / this
-- session for the audit that found them.

-- auth_rls_initplan: auth.uid() was re-evaluated per row; wrapping in a
-- scalar subquery makes Postgres evaluate it once per statement instead.
alter policy "user owns row" on public.push_subscriptions
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "report own errors" on public.client_errors
  with check ((user_id is null) or (user_id = (select auth.uid())));

alter policy "send own support message" on public.support_messages
  with check ((user_id is null) or (user_id = (select auth.uid())));

-- unindexed_foreign_keys: no covering index on these FK columns.
create index if not exists client_errors_user_id_idx on public.client_errors(user_id);
create index if not exists investments_portfolio_id_idx on public.investments(portfolio_id);
create index if not exists support_messages_user_id_idx on public.support_messages(user_id);
