# Watchlist stuck checking synchronization

The user's screenshot shows an authenticated watchlist loading status with a zero tab count. This count does not establish that cloud membership is empty.

`initAuth` awaited `loadUserData` inside the Supabase `onAuthStateChange` callback. Supabase documents that awaiting API calls from this callback can deadlock because those requests need the session held by the callback. A regression using the actual `initAuth` source and a synthetic auth lock failed before the change and passed after deferring loading with `setTimeout`. The deferred work is guarded by its captured account generation.

Validation: `tests/screener-auth-loading.test.cjs`, `tests/tablet-watchlist-sync.test.cjs`, and 350 screener checks passed. The earlier broad mocks omitted auth event delivery and therefore did not cover this integration boundary. User-account recovery still requires verification on the live site; no personal watchlist contents were queried or changed during diagnosis.

Reference: https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0
