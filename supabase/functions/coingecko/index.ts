import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// CoinGecko is a public API — no user key needed
const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const upstream = await fetch(
    'https://api.coingecko.com/api/v3/coins/list?include_platform=false',
    { headers: { 'User-Agent': 'trading-journal/2.0' } }
  );
  const data = await upstream.text();
  return new Response(data, {
    status: upstream.status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' },
  });
});
