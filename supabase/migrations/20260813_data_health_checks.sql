-- Database-side changes from the 2026-08-13 import/P&L audit.
-- Applied live via MCP that day; captured here so a rebuilt database keeps them.

-- The unique index ignored soft-deleted rows' ibkr_id, so a retroactive cleanup
-- left tombstones that blocked the next resync ("2 עדכוני סנכרון נכשלו").
DROP INDEX IF EXISTS trades_user_ibkr_id;
CREATE UNIQUE INDEX trades_user_ibkr_id ON public.trades (user_id, ibkr_id)
  WHERE deleted IS NOT TRUE;

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS order_id_notice_seen boolean DEFAULT false;

-- Symbol/day clusters of 3+ IBKR rows: an early warning for re-fragmentation.
-- Not proof of a bug on its own — genuine day trading looks the same. Verify
-- against the raw Flex XML before acting.
CREATE OR REPLACE FUNCTION public.detect_fragmented_trades(p_user_id uuid)
 RETURNS TABLE(symbol text, entry_date text, cluster_size bigint, total_shares numeric, ids bigint[])
 LANGUAGE sql
 STABLE
AS $function$
  SELECT t.symbol, t.entry_date, count(*) AS cluster_size, sum(t.shares) AS total_shares,
    array_agg(t.id ORDER BY t.id)
  FROM trades t
  WHERE t.user_id = p_user_id AND t.deleted IS NOT TRUE AND t.ibkr_id IS NOT NULL
  GROUP BY t.symbol, t.entry_date
  HAVING count(*) >= 3
  ORDER BY count(*) DESC;
$function$;

-- Layer 2 of the regression suite (see tests/README.md). Each check is a defect
-- class that reached production; a nonzero critical row means live data is
-- wrong right now.
CREATE OR REPLACE FUNCTION public.data_health_check(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(check_name text, severity text, failing_rows bigint, detail text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH t AS (
    SELECT * FROM trades
    WHERE deleted IS NOT TRUE AND (p_user_id IS NULL OR user_id = p_user_id)
  )
  SELECT 'closed_shares_exceeds_shares', 'critical',
         count(*), 'Overstates P&L: P&L is measured over closed_shares'
  FROM t WHERE closed_shares > shares
  UNION ALL
  SELECT 'ibkr_trade_typed_as_crypto', 'critical',
         count(*), 'IBKR cannot report a crypto fill; wrong tab and wrong array'
  FROM t WHERE ibkr_id IS NOT NULL AND type = 'crypto'
  UNION ALL
  SELECT 'fx_conversion_imported_as_position', 'critical',
         count(*), 'assetCategory CASH rows (USD.ILS) are not positions'
  FROM t WHERE ibkr_id IS NOT NULL AND symbol ~ '^[A-Z]{3}\.[A-Z]{3}$'
  UNION ALL
  SELECT 'duplicate_broker_execution_id', 'critical',
         coalesce(sum(n - 1), 0), 'One broker execution imported more than once'
  FROM (SELECT count(*) AS n FROM t WHERE ibkr_id IS NOT NULL
        GROUP BY user_id, ibkr_id HAVING count(*) > 1) d
  UNION ALL
  SELECT 'duplicate_bybit_execution_id', 'critical',
         coalesce(sum(n - 1), 0), 'One Bybit execution imported more than once'
  FROM (SELECT count(*) AS n FROM t WHERE bybit_id IS NOT NULL
        GROUP BY user_id, bybit_id HAVING count(*) > 1) d
  UNION ALL
  SELECT 'partials_exceed_closed_volume', 'critical',
         count(*), 'sum(targets[].shares) > closed_shares makes calcPL drop the final leg'
  FROM t WHERE targets IS NOT NULL AND targets::text NOT IN ('[]', 'null')
    AND (SELECT coalesce(sum((e->>'shares')::numeric), 0)
         FROM jsonb_array_elements(targets) e) > closed_shares
  UNION ALL
  SELECT 'half_closed_row', 'warning',
         count(*), 'exit_price without close_date (or the reverse) splits the closed-tests'
  FROM t WHERE (exit_price IS NOT NULL AND close_date IS NULL)
             OR (close_date IS NOT NULL AND exit_price IS NULL)
  UNION ALL
  SELECT 'closed_without_closed_shares', 'warning',
         count(*), 'Counted in stats but invisible to renderMonthlyTracker'
  FROM t WHERE exit_price > 0 AND coalesce(closed_shares, 0) = 0
  UNION ALL
  SELECT 'malformed_row', 'critical',
         count(*), 'Missing or non-positive symbol/shares/entry_price'
  FROM t WHERE shares IS NULL OR shares <= 0 OR entry_price IS NULL OR entry_price <= 0
             OR symbol IS NULL OR trim(symbol) = ''
  UNION ALL
  SELECT 'row_dropped_by_client_validation', 'critical',
         count(*), 'validateTradeSchema silently hides these from the journal'
  FROM t WHERE ls NOT IN ('L','S') OR length(symbol) > 20
             OR upper(symbol) <> regexp_replace(upper(symbol), '[^A-Z0-9._\-]', '', 'g')
  UNION ALL
  SELECT 'close_before_entry', 'critical',
         count(*), 'Negative holding period'
  FROM t WHERE close_date IS NOT NULL AND close_date < entry_date
  UNION ALL
  SELECT 'both_broker_ids', 'warning',
         count(*), 'A row cannot come from IBKR and Bybit at once'
  FROM t WHERE ibkr_id IS NOT NULL AND bybit_id IS NOT NULL
  UNION ALL
  SELECT 'negative_commission', 'warning',
         count(*), 'Commission is stored as a positive cost'
  FROM t WHERE commission < 0
  UNION ALL
  SELECT 'table_missing_rls', 'critical',
         count(*), 'Public table without row-level security'
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity;
$function$;
