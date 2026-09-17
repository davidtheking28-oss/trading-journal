import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { serveCached } from '../_shared/swr.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const ALLOWED_FUNCTIONS = ['GLOBAL_QUOTE', 'OVERVIEW', 'INCOME_STATEMENT', 'EARNINGS', 'BALANCE_SHEET'];

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
    .select('av_key')
    .eq('user_id', user.id)
    .single();

  const userKey = (settings?.av_key && /^[A-Za-z0-9]{6,20}$/.test(settings.av_key))
    ? settings.av_key
    : null;
  const apiKey = userKey ?? (Deno.env.get('AV_API_KEY') ?? '');
  const usingSharedKey = !userKey;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'No Alpha Vantage API key configured.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // The shared AV_API_KEY's quota is 25 calls/day total, far tighter than
  // Finnhub/FMP's shared keys — a low per-minute cap here (same ai_requests
  // counter those use) stops one user's burst from blowing the whole day's
  // quota for everyone. Only gates the shared key; a user's own av_key is
  // theirs to spend.
  if (usingSharedKey) {
    const windowStart = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await supabase
      .from('ai_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', windowStart);

    if ((recentCount ?? 0) >= 3) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
        { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }
    await supabase.from('ai_requests').insert({ user_id: user.id });
  }

  const url = new URL(req.url);
  const func = (url.searchParams.get('function') ?? '').toUpperCase();
  const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 20);

  if (!ALLOWED_FUNCTIONS.includes(func)) {
    return new Response(JSON.stringify({ error: 'Function not allowed' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'Symbol required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const avUrl = `https://www.alphavantage.co/query?function=${func}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

  // The shared AV_API_KEY's quota is 25 calls/day total (see fx.ts) — the same
  // symbol's OVERVIEW/EARNINGS/etc. is identical for every user, so a
  // Cache-Control response header alone did nothing (an authenticated fetch()
  // response is never cached by the browser and nothing sits in front of this
  // function to honor it) and every user's lookup spent its own share of the
  // quota. GLOBAL_QUOTE stays live — it's the one path meant to be real-time.
  if (func === 'GLOBAL_QUOTE') {
    const upstream = await fetch(avUrl, { headers: { 'User-Agent': 'trading-journal/2.0' } });
    const data = await upstream.text();
    return new Response(data, { status: upstream.status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const cacheKey = `av:${func}:${symbol}`;
  const fetchFresh = async () => {
    const upstream = await fetch(avUrl, { headers: { 'User-Agent': 'trading-journal/2.0' } });
    if (!upstream.ok) return null;
    const data = await upstream.text();
    await admin.from('market_cache').upsert({ cache_key: cacheKey, payload: data, refreshed_at: new Date().toISOString() });
    return data;
  };

  try {
    const { payload } = await serveCached(admin, cacheKey, 60 * 60_000, 24 * 60 * 60_000, fetchFresh);
    if (payload === null) {
      return new Response(JSON.stringify({ error: 'Failed to fetch data' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    return new Response(payload, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[alphavantage] upstream error:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
