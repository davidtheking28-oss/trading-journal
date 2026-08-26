import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('finnhub_key')
    .eq('user_id', user.id)
    .single();

  const userKey = (settings?.finnhub_key && /^[A-Za-z0-9_]{10,40}$/.test(settings.finnhub_key))
    ? settings.finnhub_key
    : null;
  const apiKey = userKey ?? (Deno.env.get('FINNHUB_API_KEY') ?? '');
  const usingSharedKey = !userKey;

  if (!apiKey || !/^[A-Za-z0-9_]{10,40}$/.test(apiKey)) {
    return new Response(
      JSON.stringify({ error: 'No Finnhub API key configured.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  if (usingSharedKey) {
    const windowStart = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await supabase
      .from('ai_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', windowStart);

    if ((recentCount ?? 0) >= 30) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
        { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }
    supabase.from('ai_requests').insert({ user_id: user.id }).then(() => {});
  }

  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? 'stock/symbol';

  const ALLOWED_PATHS = ['stock/symbol', 'stock/profile2', 'stock/metric', 'quote', 'stock/earnings', 'stock/financials-reported'];
  if (!ALLOWED_PATHS.includes(path)) {
    return new Response(JSON.stringify({ error: 'Path not allowed' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const symbol    = url.searchParams.get('symbol') ?? '';
  const symbols   = url.searchParams.get('symbols') ?? '';
  const metric    = url.searchParams.get('metric') ?? '';
  const freq      = url.searchParams.get('freq') ?? '';
  const exchange  = /^[A-Z]{1,4}$/.test(url.searchParams.get('exchange') ?? '') ? (url.searchParams.get('exchange') ?? 'US') : 'US';

  // Batch quotes: the live P&L card was opening one edge-function call per
  // symbol, each paying the full auth+settings+rate-limit round trip before
  // ever reaching Finnhub. One call here does that overhead once and fans the
  // Finnhub requests out server-side instead.
  if (path === 'quote' && symbols) {
    const list = [...new Set(symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
    const results: Record<string, unknown> = {};
    // Promise.all had no per-symbol timeout, so one slow/hung Finnhub response
    // (a symbol it barely serves, a transient stall) blocked the whole batch —
    // every open position waited on the single worst one. 5s per symbol; a
    // timed-out symbol comes back null like any other failed quote, same as
    // the client already handles.
    await Promise.all(list.map(async sym => {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(`https://finnhub.io/api/v1/quote?token=${encodeURIComponent(apiKey)}&symbol=${encodeURIComponent(sym)}`,
          { headers: { 'User-Agent': 'trading-journal/2.0' }, signal: controller.signal });
        clearTimeout(tid);
        results[sym] = r.ok ? await r.json() : null;
      } catch {
        results[sym] = null;
      }
    }));
    return new Response(JSON.stringify(results), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  let finnhubUrl  = `https://finnhub.io/api/v1/${path}?token=${encodeURIComponent(apiKey)}`;
  if (path === 'stock/symbol') finnhubUrl += `&exchange=${exchange}`;
  if (symbol) finnhubUrl += `&symbol=${encodeURIComponent(symbol)}`;
  if (path === 'stock/metric' && metric) finnhubUrl += `&metric=${encodeURIComponent(metric)}`;
  if (path === 'stock/financials-reported' && freq) finnhubUrl += `&freq=${encodeURIComponent(freq)}`;

  try {
    const upstream = await fetch(finnhubUrl, { headers: { 'User-Agent': 'trading-journal/2.0' } });
    const data = await upstream.text();

    const ttl = path === 'quote' ? 0 : path === 'stock/financials-reported' ? 3600 : 14400;
    const cacheHeader = ttl === 0 ? 'no-store' : `max-age=${ttl}`;

    return new Response(data, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': cacheHeader },
    });
  } catch (e) {
    console.error('[finnhub] upstream error:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
