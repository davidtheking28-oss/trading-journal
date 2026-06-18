-- Dual-query IBKR sync: support an Activity Flex Query (365-day history, pulled
-- once daily) AND a Trade Confirmation Flex Query (today only, pulled every
-- 30 min for near-real-time fills). The two cron cadences write separate cache
-- columns so neither clobbers the other.
ALTER TABLE user_settings        ADD COLUMN IF NOT EXISTS flex_confirm_query_id text;
ALTER TABLE flex_statement_cache ADD COLUMN IF NOT EXISTS xml_confirm          text;
ALTER TABLE flex_statement_cache ADD COLUMN IF NOT EXISTS confirm_fetched_at   timestamptz;
ALTER TABLE flex_statement_cache ADD COLUMN IF NOT EXISTS confirm_imported_at  timestamptz;
