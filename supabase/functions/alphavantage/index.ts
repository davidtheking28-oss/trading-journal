import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const ALLOWED_FUNCTIONS = ['GLOBAL_QUOTE', 'OVERVIEW', 'INCOME_STATEMENT', 'EARNINGS', 'BALANCE_SHEET'];

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
    .select('av_key')
    .eq('user_id', user.id)
    .single();

  const apiKey = (settings?.av_key && /^[A-Za-z0-9]{6,20}$/.test(settings.av_key))
    ? settings.av_key
    : (Deno.env.get('AV_API_KEY') ?? '');

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'No Alpha Vantage API key configured.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
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
  const upstream = await fetch(avUrl, { headers: { 'User-Agent': 'trading-journal/2.0' } });
  const data = await upstream.text();

  const ttl = func === 'GLOBAL_QUOTE' ? 0 : 3600;
  const cacheHeader = ttl === 0 ? 'no-store' : `max-age=${ttl}`;

  return new Response(data, {
    status: upstream.status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': cacheHeader },
  });
});
