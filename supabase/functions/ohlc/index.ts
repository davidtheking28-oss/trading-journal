// Daily OHLC candles for the custom trade-review chart (replaces the earlier
// TradingView iframe embed, which cannot mark a custom entry/stop/exit price -
// only their paid Charting Library supports that; the free embed widget does
// not). Cached per SYMBOL via the same sym_cache module personal-stem uses:
// one candle series is identical for every user, so there is no reason to key
// it per request.
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { partitionByAge, pruneMap, type SymCacheMap } from '../_shared/sym_cache.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
};

type Candle = { t: number; o: number; h: number; l: number; c: number };
const isCandleArray = (v: Candle[]) => Array.isArray(v) && v.length > 0;

// 1y so a trade opened up to a year ago still has its entry candle in range.
async function fetchDailyCandles(ticker: string): Promise<Candle[] | null> {
  for (const host of YF_HOSTS) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`https://${host}/v8/finance/chart/${ticker}?range=1y&interval=1d`,
        { headers: YF_HEADERS, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const ts: number[] = result?.timestamp ?? [];
      const q = result?.indicators?.quote?.[0];
      if (!ts.length || !q) continue;
      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        candles.push({ t: ts[i], o, h, l, c });
      }
      if (candles.length) return candles;
    } catch { /* try next host */ }
  }
  return null;
}

Deno.serve(async (req: Request) => {
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

  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase().replace(/[^A-Z0-9._\-]/g, '');
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'symbol required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const MAP_KEY = 'ohlc-daily';
  // A day's candle is final once the session closes, so the cost of staleness
  // is only ever "missing today's bar" - a long TTL is fine and keeps this from
  // re-pulling a full year of history on every trade review.
  const TTL_MS = 6 * 60 * 60_000;
  const MAX_STALE_MS = 7 * 24 * 60 * 60_000;

  const { data: row } = await admin
    .from('market_cache').select('payload').eq('cache_key', MAP_KEY).maybeSingle();
  const map: SymCacheMap<Candle[]> = { ...((row?.payload as SymCacheMap<Candle[]>) ?? {}) };
  const { missing, stale } = partitionByAge(map, [symbol], TTL_MS, MAX_STALE_MS, Date.now(), isCandleArray);

  const fetchOne = async () => {
    const candles = await fetchDailyCandles(symbol);
    if (!candles) return;
    map[symbol] = { r: candles, ts: Date.now() };
    const { data: cur } = await admin
      .from('market_cache').select('payload').eq('cache_key', MAP_KEY).maybeSingle();
    const merged = pruneMap(
      { ...((cur?.payload as SymCacheMap<Candle[]>) ?? {}), [symbol]: map[symbol] },
      MAX_STALE_MS,
    );
    await admin.from('market_cache').upsert({ cache_key: MAP_KEY, payload: merged, refreshed_at: new Date().toISOString() });
  };

  if (missing.includes(symbol)) {
    await fetchOne();
  } else if (stale.includes(symbol)) {
    const p = fetchOne().catch((e) => console.error('[ohlc] background refresh failed:', e));
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  }

  const candles = map[symbol]?.r ?? [];
  return new Response(JSON.stringify({ symbol, candles }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
