import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
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
  const metric    = url.searchParams.get('metric') ?? '';
  const freq      = url.searchParams.get('freq') ?? '';
  const exchange  = /^[A-Z]{1,4}$/.test(url.searchParams.get('exchange') ?? '') ? (url.searchParams.get('exchange') ?? 'US') : 'US';
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
