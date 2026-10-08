# Independent watchlist price rows

Missing watchlist tickers now load one-year OHLC through the existing public endpoint independently of the general scan. Real price bars produce normal table/gallery rows and charts. Unavailable fundamental values, market cap and relative-strength ranks remain null and are not invented. A note identifies OHLC-only rows. Scan rebuilds preserve these supplemental rows.

Per-ticker in-flight deduplication and a one-minute failed-attempt cooldown avoid render-driven request loops. Late responses are ignored after account-generation changes, removal, or arrival of a richer scanner row. A failed provider lookup retains the named missing-data item and removal control.

Validation: the production-dashboard watchlist regression failed before independent loading existed and passed afterward for normal table/gallery display. Both watchlist and auth-loading tests and 350 frontend checks passed. Public read-only provider checks returned HTTP 200 and price bars for all six screenshot symbols: STX, SNDK, IESC, REX, CSTL (252 each), SPCX (82). No authenticated account data was read or changed during these checks.
