-- On 2026-08-12, one day before the _dedupeTrades fix (commit 63481e2), 71
-- broker-tagged rows were soft-deleted for user 5f72e0bb. That bug grouped only
-- on symbol+entryDate+entryPrice, so IBKR's several same-day SMART-router fills
-- looked identical and were offered for permanent deletion.
--
-- Reconciling per symbol against that account's own cached Flex statement shows
-- the deletions were NOT uniformly wrong. Doing this per symbol rather than in
-- aggregate is the whole point — the aggregate hides it:
--
--   MSTU  broker 52563.8963 == journal active 52563.8963
--   MSTZ  broker      12940 == journal active      12940
--         Their 4542 + 1100 deleted shares are genuine duplicates; the active
--         rows already carry the full broker volume. Restoring them would
--         inject phantom volume. They stay deleted.
--
--   SNDU  broker 26840 vs active 20385 + deleted 6455
--   SNDQ  broker 14850 vs active 12125 + deleted 2725
--   NNE   broker  1030 vs active   730 + deleted  300
--   SCO   broker   300 vs active   200 + deleted  100
--         Here the active rows are short by exactly the deleted amount, and the
--         exit side reconciles identically, so there is no double counting.
--         These 57 rows are real executions represented nowhere else.
--
-- All 57 appear in the broker statement with matching quantity and price, and
-- all are fully closed, so this is realised P&L.
--
-- Deliberately NOT restored: the 8 rows deleted 2026-08-11 — USD.ILS and
-- ILS.USD currency conversions, which are not positions at all.
--
-- Rollback:
--   update trades t set deleted = true, deleted_at = b.deleted_at
--     from trades_restored_20260820 b where b.id = t.id;
create table if not exists public.trades_restored_20260820 as
  select id, user_id, symbol, deleted, deleted_at
    from public.trades
   where user_id = '5f72e0bb-fb32-4bd4-b766-96e907ece8fd'
     and deleted is true and deleted_at::date = '2026-08-12'
     and symbol in ('SNDU','SNDQ','NNE','SCO');
revoke all on public.trades_restored_20260820 from anon, authenticated;
alter table public.trades_restored_20260820 enable row level security;

update public.trades
   set deleted = false, deleted_at = null
 where user_id = '5f72e0bb-fb32-4bd4-b766-96e907ece8fd'
   and deleted is true and deleted_at::date = '2026-08-12'
   and symbol in ('SNDU','SNDQ','NNE','SCO');
