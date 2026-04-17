import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const ALLOWED_PATHS = ['quote', 'profile', 'income-statement', 'key-metrics', 'earnings'];

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
    .select('fmp_key')
    .eq('user_id', user.id)
    .single();

  const apiKey = (settings?.fmp_key && /^[A-Za-z0-9]{10,40}$/.test(settings.fmp_key))
    ? settings.fmp_key
    : (Deno.env.get('FMP_API_KEY') ?? '');

  if (!apiKey || !/^[A-Za-z0-9]{10,40}$/.test(apiKey)) {
    return new Response(
      JSON.stringify({ error: 'No FMP API key configured.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? '';
  const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 20);
  const period = url.searchParams.get('period') ?? 'annual';

  if (!ALLOWED_PATHS.includes(path)) {
    return new Response(JSON.stringify({ error: 'Path not allowed' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'Symbol required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let fmpUrl = `https://financialmodelingprep.com/api/v3/${path}/${symbol}?apikey=${encodeURIComponent(apiKey)}`;
  if (path === 'income-statement' || path === 'key-metrics') {
    fmpUrl += `&period=${encodeURIComponent(period)}&limit=4`;
  }

  const upstream = await fetch(fmpUrl, { headers: { 'User-Agent': 'trading-journal/2.0' } });
  const data = await upstream.text();

  return new Response(data, {
    status: upstream.status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
  });
});
