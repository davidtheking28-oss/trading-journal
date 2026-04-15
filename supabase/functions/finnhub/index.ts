import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
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

  // Fetch the Finnhub key from user_settings — never from the request
  const { data: settings } = await supabase
    .from('user_settings')
    .select('finnhub_key')
    .eq('user_id', user.id)
    .single();

  const apiKey = settings?.finnhub_key ?? '';
  if (!apiKey || !/^[A-Za-z0-9_]{10,40}$/.test(apiKey)) {
    return new Response(
      JSON.stringify({ error: 'No Finnhub API key configured.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? 'stock/symbol';

  // Whitelist of allowed Finnhub paths
  const ALLOWED_PATHS = ['stock/symbol', 'stock/profile2'];
  if (!ALLOWED_PATHS.includes(path)) {
    return new Response(JSON.stringify({ error: 'Path not allowed' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const symbol = url.searchParams.get('symbol') ?? '';
  let finnhubUrl = `https://finnhub.io/api/v1/${path}?token=${encodeURIComponent(apiKey)}`;
  if (path === 'stock/symbol') finnhubUrl += '&exchange=US';
  if (path === 'stock/profile2' && symbol) finnhubUrl += `&symbol=${encodeURIComponent(symbol)}`;

  const upstream = await fetch(finnhubUrl, { headers: { 'User-Agent': 'trading-journal/2.0' } });
  const data = await upstream.text();

  return new Response(data, {
    status: upstream.status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' },
  });
});
