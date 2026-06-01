-- Shared cache for sector-holdings market data (public market data, not
-- user-owned). Any authenticated user can read it and refresh it; the edge
-- function serves rows younger than the TTL without re-hitting Yahoo.
CREATE TABLE IF NOT EXISTS sector_cache (
  ticker     text PRIMARY KEY,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sector_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read-write sector cache" ON sector_cache;
CREATE POLICY "authenticated read-write sector cache" ON sector_cache
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
