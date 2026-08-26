// A real STEM (Stock Trading Environment Model), Minervini-style: not a
// market-wide index gauge, but a rolling read on how the trader's OWN focus
// list is actually behaving. Real Minervini STEM tracks his personal Focus
// List's breakout success over a trailing 5-day window (see WebSearch notes
// in the 2026-08-26 conversation for the public description); this uses the
// trader's own open positions as that list, since we have no access to
// Minervini's actual list and it wouldn't be this trader's positions anyway.
//
// For each open-position symbol: pull the last ~6 daily closes (free Yahoo
// chart endpoint, same one theme-tracker already relies on) and count how
// many of the last 5 sessions closed down vs up. Aggregated down-ratio across
// every resolved symbol is the signal — a high down-ratio means the trader's
// own book is struggling regardless of what the index is doing, which is
// closer to what Minervini's model is actually for than a VIX/breadth gauge.
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

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
const MAX_SYMBOLS = 30;

async function fetchDailyDirections(ticker: string): Promise<{ up: number; down: number } | null> {
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
      let up = 0, down = 0;
      for (let i = 1; i < last6.length; i++) {
        if (last6[i] > last6[i - 1]) up++;
        else if (last6[i] < last6[i - 1]) down++;
      }
      return { up, down };
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

  const results = await Promise.all(symbols.map(fetchDailyDirections));
  const resolved = results.filter((r): r is { up: number; down: number } => r !== null);
  const totalUp = resolved.reduce((s, r) => s + r.up, 0);
  const totalDown = resolved.reduce((s, r) => s + r.down, 0);
  const totalDays = totalUp + totalDown;
  const downRatio = resolved.length && totalDays ? Math.round((totalDown / totalDays) * 1000) / 10 : null;

  return new Response(JSON.stringify({ downRatio, resolved: resolved.length, total: symbols.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
