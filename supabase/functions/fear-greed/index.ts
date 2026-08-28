import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { serveCached } from '../_shared/swr.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Real market breadth for the STEM regime classifier, free: % of the 11 SPDR
// sector ETFs trading above their own 50-day SMA. CNN's stock_price_breadth
// is the McClellan Volume Summation Index — a different, unrelated metric —
// so it was never actually "% above SMA50" despite being used as a stand-in
// for that. This computes the real thing from the same free Yahoo chart
// endpoint theme-tracker already relies on; no paid API, no new key.
const SECTOR_ETFS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];
const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
};

async function sectorAboveSma50(ticker: string): Promise<boolean | null> {
  for (const host of YF_HOSTS) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`https://${host}/v8/finance/chart/${ticker}?range=6mo&interval=1d`,
        { headers: YF_HEADERS, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const json = await res.json();
      const closes: number[] = (json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
        .filter((c: number) => c != null && c > 0);
      if (closes.length < 50) continue;
      const last50 = closes.slice(-50);
      const sma50 = last50.reduce((s, c) => s + c, 0) / 50;
      return closes[closes.length - 1] > sma50;
    } catch { /* try next host */ }
  }
  return null;
}

async function fetchSectorBreadthPct(): Promise<number | null> {
  const results = await Promise.all(SECTOR_ETFS.map(sectorAboveSma50));
  const resolved = results.filter((r): r is boolean => r !== null);
  if (resolved.length < 6) return null; // too many failures to trust the ratio
  const above = resolved.filter(Boolean).length;
  return Math.round((above / resolved.length) * 1000) / 10;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Shared cache — identical for all users. Refresh at most every 5 min; serve
  // the last good payload if CNN is unreachable.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const CACHE_KEY = 'fear-greed';
  const CACHE_TTL_MS = 300_000;
  // Past six hours the score is too old to put on screen, so we block on a real
  // fetch instead of serving it. Inside that window the caller gets the cached
  // payload immediately and the refresh runs behind the response.
  const MAX_STALE_MS = 6 * 60 * 60 * 1000;
  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' };

  const refresh = async () => {
    // Sector breadth is heavier (11 fetches) and doesn't move meaningfully
    // within 5 minutes — cached separately with its own longer TTL so it isn't
    // recomputed on every fear-greed cache miss.
    const BREADTH_CACHE_KEY = 'sector-breadth';
    const BREADTH_TTL_MS = 900_000;
    const { data: cachedBreadth } = await admin
      .from('market_cache').select('payload, refreshed_at').eq('cache_key', BREADTH_CACHE_KEY).maybeSingle();
    let breadthPct: number | null = cachedBreadth?.payload?.breadthPct ?? null;
    if (!cachedBreadth || Date.now() - new Date(cachedBreadth.refreshed_at).getTime() >= BREADTH_TTL_MS) {
      const freshBreadth = await fetchSectorBreadthPct();
      if (freshBreadth !== null) {
        breadthPct = freshBreadth;
        await admin.from('market_cache').upsert({ cache_key: BREADTH_CACHE_KEY, payload: { breadthPct: freshBreadth }, refreshed_at: new Date().toISOString() });
      }
    }

    try {
      const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://edition.cnn.com/markets/fear-and-greed',
          'Origin': 'https://edition.cnn.com',
        }
      });
      if (!res.ok) throw new Error(`CNN returned ${res.status}`);
      const data = await res.json();
      const score = data?.fear_and_greed?.score;
      const rating = data?.fear_and_greed?.rating;
      if (score == null) throw new Error('no score in response');
      // Reused for the automatic STEM market-regime classifier (portfolio/STEM
      // mismatch alert) — the same CNN payload already carries both a live VIX
      // reading and a breadth rating (McClellan volume summation index), so no
      // second external call is needed.
      const vixSeriesRaw = data?.market_volatility_vix?.data;
      const vix = Array.isArray(vixSeriesRaw) && vixSeriesRaw.length ? vixSeriesRaw[vixSeriesRaw.length - 1]?.y : null;
      const breadthRating = data?.stock_price_breadth?.rating ?? null; // kept for reference only; STEM now uses breadthPct
      // The same CNN response already carries ~1 year of daily VIX closes (used
      // to draw their own historical chart line) — passed through as-is so the
      // client can approximate the STEM regime for past trade dates (VIX-only,
      // no historical breadth exists) without a second external data source.
      const vixSeries = Array.isArray(vixSeriesRaw)
        ? vixSeriesRaw.filter((p: any) => typeof p?.x === 'number' && typeof p?.y === 'number').map((p: any) => ({ x: p.x, y: p.y }))
        : [];
      const payload = { score, rating, vix, breadthRating, breadthPct, vixSeries };
      await admin.from('market_cache').upsert({ cache_key: CACHE_KEY, payload, refreshed_at: new Date().toISOString() });
      return payload;
    } catch (e) {
      console.error('[fear-greed] error:', e);
      return null;
    }
  };

  const { payload } = await serveCached(admin, CACHE_KEY, CACHE_TTL_MS, MAX_STALE_MS, refresh);
  if (payload) return new Response(JSON.stringify(payload), { headers: jsonHeaders });
  return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
    status: 500, headers: jsonHeaders
  });
});
