-- Guarantee row-level security on the two most sensitive tables:
--   trades        — every user's trade history
--   user_settings — holds broker API credentials (flex_token, bybit_api_secret, etc.)
-- Idempotent: safe to run repeatedly. Policies are scoped to the owning user so
-- a user can only ever read/write their own rows.

ALTER TABLE trades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user owns trades" ON trades;
CREATE POLICY "user owns trades" ON trades
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user owns settings" ON user_settings;
CREATE POLICY "user owns settings" ON user_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
