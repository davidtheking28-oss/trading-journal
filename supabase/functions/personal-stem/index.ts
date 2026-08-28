// A real STEM (Stock Trading Environment Model), Minervini-style: not a
// market-wide index gauge, but a rolling read on how the trader's OWN focus
// list is actually behaving. Real Minervini STEM tracks his personal Focus
// List, counting "how many of the Focus List stocks are closing down for the
// 5-day period" (public description, WebSearch'd 2026-08-26) — that phrasing
// is a net 5-day return per stock, NOT a day-by-day up/down tally. An earlier
// version of this counted daily direction flips instead, which is a
// meaningfully different (noisier) signal than what's actually described;
// switched to match. Uses the trader's own open positions as the focus list,
// since we have no access to Minervini's real list and it wouldn't be this
// trader's positions anyway.
//
// For each open-position symbol: pull the last ~6 daily closes (free Yahoo
// chart endpoint, same one theme-tracker already relies on) and compute the
// net % change from 5 sessions ago to today. % of resolved symbols with a
// negative 5-day return is the signal — a high ratio means the trader's own
// book is struggling regardless of what the index is doing.
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { partitionByAge, pruneMap, type SymCacheMap } from '../_shared/sym_cache.ts';

const isNumEntry = (v: number) => typeof v === 'number';

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
// The focus list is the screener watchlist plus open journal positions, so it
// can be considerably larger than the open-positions-only list this started
// as. Each symbol is one Yahoo fetch, all issued in parallel with a 6s cap.
const MAX_SYMBOLS = 60;

async function fetch5dReturn(ticker: string): Promise<number | null> {
  for (const host of YF_HOSTS) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`https://${host}/v8/finance/chart/${ticker}?range=1mo&interval=1d`,
        { headers: YF_HEADERS, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const json = await res.json();
      const closes: number[] = (json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
        .filter((c: number) => c != null && c > 0);
      if (closes.length < 6) continue;
      const last6 = closes.slice(-6);
      const start = last6[0];
      if (!start) continue;
      return ((last6[5] - start) / start) * 100;
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

  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount } = await supabase
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', windowStart);
  if ((recentCount ?? 0) >= 10) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
      { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  supabase.from('ai_requests').insert({ user_id: user.id }).then(() => {});

  const url = new URL(req.url);
  const symbols = [...new Set((url.searchParams.get('symbols') ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.\-]{1,10}$/.test(s)))]
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) {
    return new Response(JSON.stringify({ downRatio: null, resolved: 0, total: 0 }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // A 5-day return for AAPL is the same number for every user, so it is cached
  // per SYMBOL rather than per request. The old code re-fetched the whole focus
  // list from Yahoo on every single page load — up to 60 requests, with the STEM
  // badge hidden until the slowest one landed. One row holds the whole map, so
  // a warm list costs exactly one indexed select and zero upstream calls.
  //
  // market_cache is RLS-locked with no policies, so this needs the service role.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const MAP_KEY = 'stem-5d-returns';
  const SYM_TTL_MS = 15 * 60_000;
  // Past a day the bar is genuinely wrong, so such a symbol is refetched in the
  // foreground rather than served. Between the two bounds it is served stale and
  // refreshed behind the response.
  const SYM_MAX_STALE_MS = 24 * 60 * 60_000;

  const { data: row } = await admin
    .from('market_cache').select('payload').eq('cache_key', MAP_KEY).maybeSingle();
  const map: SymCacheMap<number> = { ...((row?.payload as SymCacheMap<number>) ?? {}) };

  const { missing, stale } = partitionByAge(map, symbols, SYM_TTL_MS, SYM_MAX_STALE_MS, Date.now(), isNumEntry);

  const fetchInto = async (list: string[]) => {
    if (!list.length) return;
    const rs = await Promise.all(list.map(fetch5dReturn));
    const patch: SymCacheMap<number> = {};
    list.forEach((s, i) => { const v = rs[i]; if (v !== null) patch[s] = { r: v, ts: Date.now() }; });
    if (!Object.keys(patch).length) return;
    Object.assign(map, patch);
    // Re-read before writing: this row is shared by every user, and a plain
    // overwrite of the copy read at the top of the request would silently drop
    // symbols another request cached in the meantime.
    const { data: cur } = await admin
      .from('market_cache').select('payload').eq('cache_key', MAP_KEY).maybeSingle();
    const merged = pruneMap({ ...((cur?.payload as SymCacheMap<number>) ?? {}), ...patch }, SYM_MAX_STALE_MS);
    await admin.from('market_cache').upsert({ cache_key: MAP_KEY, payload: merged, refreshed_at: new Date().toISOString() });
  };

  await fetchInto(missing);
  if (stale.length) {
    const p = fetchInto(stale).catch((e) => { console.error('[personal-stem] background refresh failed:', e); });
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  }

  const resolved = symbols.map(s => map[s]?.r).filter((r): r is number => typeof r === 'number');
  const downCount = resolved.filter(r => r < 0).length;
  const downRatio = resolved.length ? Math.round((downCount / resolved.length) * 1000) / 10 : null;
  const avgReturn = resolved.length ? Math.round((resolved.reduce((s, r) => s + r, 0) / resolved.length) * 100) / 100 : null;

  return new Response(JSON.stringify({ downRatio, avgReturn, resolved: resolved.length, total: symbols.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
