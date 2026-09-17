-- Marks the cached Flex statement as imported now that its 27 trades were
-- manually recovered, so the user's next real app visit (or a future
-- server-side import) doesn't re-run the same window and re-trigger the
-- orphan-close double-count bug documented in 20260917_recover_dcb5bdba_ibkr_import.
update flex_statement_cache set imported_at = now() where user_id = 'dcb5bdba-8863-4f8f-92f5-498ea9eae59a';
