-- Follow-ups from the 2026-08-20 multi-user audit.
--
-- 1. Drift detection for the stage-2 dual write. investments.holdings (jsonb)
--    and investment_holdings (rows) are both written on every save and nothing
--    enforced that they agree — a disagreement is invisible, because the tab
--    renders the rows. A unique (user_id, position) constraint was considered
--    and rejected: deleting the first of two holdings legitimately moves the
--    second to position 0 while the first still occupies it, and the upsert and
--    the cleanup delete are separate requests, so the overlap is real and not
--    deferrable. Detect the duplicate; do not refuse the write.
--    (The full data_health_check body lives in the applied migration
--    20260820_health_checks_for_holdings_table_drift; the three added checks are
--    holdings_doc_row_drift, holding_duplicate_position and
--    holding_orphaned_from_investments.)
--
-- 2. Publish the holdings rows to realtime. They are written a round-trip after
--    the document, so the document's echo reloaded a second tab too early: it
--    read the fresh document but the stale rows, and reads prefer the rows.
--    Also a prerequisite for stage 3, when the document write goes away.
alter publication supabase_realtime add table public.investment_holdings;

-- 3. Defence in depth. An audit confirmed RLS already denies all of these
--    writes, but the grants are broader than the intent: one future
--    `create policy ... for all using (true)` would turn them into real write
--    paths. screener_daily is the sharpest case — it grants anon full DML while
--    its only policy is a deliberate public SELECT for scan results.
revoke insert, update, delete, truncate on public.screener_daily          from anon, authenticated;
revoke insert, update, delete, truncate on public.market_cache            from anon, authenticated;
revoke insert, update, delete, truncate on public.sector_cache            from anon, authenticated;
revoke insert, update, delete, truncate on public.push_log                from anon, authenticated;
revoke insert, update, delete, truncate on public.advisor_invite_attempts from anon, authenticated;
