-- Cache of the latest IBKR Flex statement XML, pre-fetched server-side by a
-- scheduled job at a time when IBKR's reporting backend is available (after the
-- once-daily end-of-day batch). The app imports from this cache on login, so it
-- never has to hit IBKR live at a bad time (which returns error 1001).
CREATE TABLE IF NOT EXISTS flex_statement_cache (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xml         text NOT NULL,
  ref_code    text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  imported_at timestamptz
);

ALTER TABLE flex_statement_cache ENABLE ROW LEVEL SECURITY;

-- Users read/update their own row. The scheduled job writes via the service
-- role key, which bypasses RLS.
DROP POLICY IF EXISTS "user owns flex cache" ON flex_statement_cache;
CREATE POLICY "user owns flex cache" ON flex_statement_cache
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
