# Saved membership without scan data

The user reported 14 saved tickers but eight visible stocks. Source review showed that membership counts use the whole watchlist, whereas table/gallery rows omit tickers absent from `ttUniverse`. The missing-data notice previously named these symbols as text only. The actual six user symbols were not queried.

Missing symbols now have visible individual items with an explicit unavailable-price label and an accessible removal action. No synthetic prices or scores are displayed. Search filters those items by symbol, and they disappear automatically when quote rows become available. Existing scan and cloud membership behavior is preserved.

A real-dashboard synthetic browser assertion for an accessible removal button on a missing ticker failed before the change and passed afterward. The watchlist integration and 350 frontend assertions passed. GitHub CI gates the publication with server and browser regressions.
