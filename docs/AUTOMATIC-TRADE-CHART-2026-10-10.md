# Automatic closed-trade chart — 2026-10-10

The stock trade table has a final Trade chart column. Fully closed trades with entry/close dates and actual positive entry/exit prices generate a single SVG image from daily OHLC bars. The two markers use the recorded trade prices and dates, including short trades and same-day trades. Clicking the thumbnail opens the existing lightbox. Existing uploaded screenshots remain separate and unchanged.

Generation is deferred until cells approach the viewport, with at most three concurrent jobs. The existing per-symbol OHLC request cache is reused. Up to 100 generated images are cached in memory. Asynchronous results are guarded by account, database identity, current trade fingerprint and cell attachment. Retry invalidates the symbol's bars cache. Partial closes, deleted trades and crypto rows do not generate a completed stock chart.

Images are derived at display time, not permanently uploaded or stored in Supabase. The current shared OHLC endpoint supports only 3mo/1y; this feature uses 1y. If coverage does not include both trade dates, show unavailable/retry rather than fabricate historical candles. Daily bars show dates, not intraday execution timestamps. The image marks the final recorded exit, not individual partial fills. No stock-screener Edge Functions were changed or deployed.

Validation: 234 logic/snapshot checks passed; browser image checks cover rendering, enlargement, edit invalidation, partial closes, unavailable data/retry and account changes. Desktop table column widths and expanded row spans were adjusted for the new column. Browser checks use synthetic data only.
