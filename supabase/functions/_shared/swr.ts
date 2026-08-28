// Stale-while-revalidate for the shared market_cache rows.
//
// The plain "if older than TTL, fetch" shape only works under constant traffic.
// This project has a handful of users, so the cache was in practice never warm:
// measured live on 2026-08-28, all four market_cache rows were 30 minutes old
// against a 5-minute TTL, meaning essentially every visit paid the full cold
// path in the foreground — 37 Yahoo tickers for theme-tracker, CNN plus 11
// sector ETFs for fear-greed. Shortening the TTL makes that worse, not better.
//
// So: a stale row is served immediately and refreshed behind the response.
// The user waits on one indexed select. Only a row older than maxStaleMs (or a
// missing row) still blocks on a real fetch, because past that bound the data
// is too old to put on screen.
export async function serveCached<T>(
  admin: { from: (t: string) => any },
  cacheKey: string,
  ttlMs: number,
  maxStaleMs: number,
  refresh: () => Promise<T | null>,
): Promise<{ payload: T | null; stale: boolean }> {
  const { data: cached } = await admin
    .from('market_cache').select('payload, refreshed_at').eq('cache_key', cacheKey).maybeSingle();
  const age = cached ? Date.now() - new Date(cached.refreshed_at).getTime() : Infinity;

  if (cached && age < ttlMs) return { payload: cached.payload as T, stale: false };

  if (cached && age < maxStaleMs) {
    // Detached on purpose: waitUntil keeps the isolate alive for the refresh
    // without the client waiting on it. A failure here is not the caller's
    // problem — they already have a usable payload.
    const p = refresh().catch((e) => { console.error(`[${cacheKey}] background refresh failed:`, e); return null; });
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
    return { payload: cached.payload as T, stale: true };
  }

  const fresh = await refresh();
  if (fresh !== null) return { payload: fresh, stale: false };
  return { payload: (cached?.payload as T) ?? null, stale: !!cached };
}
