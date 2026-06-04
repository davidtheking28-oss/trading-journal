-- sector_cache holds shared market data and is now read/written by the
-- sector-holdings edge function via the service role (which bypasses RLS).
-- Drop the permissive "USING (true) WITH CHECK (true)" policy that let any
-- authenticated user write/delete cache rows (flagged by the security linter).
-- RLS stays enabled with no authenticated policy → only the service role.
DROP POLICY IF EXISTS "authenticated read-write sector cache" ON sector_cache;
