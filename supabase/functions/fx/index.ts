import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Frankfurter serves European Central Bank reference rates: no API key, no
// request quota. Alpha Vantage also exposes FX, but its free tier is 25 calls a
// day across the whole shared key — one busy afternoon would starve the quote
// lookups that already depend on it.
const ALLOWED = ['USD', 'ILS', 'EUR', 'GBP'];

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

  const url  = new URL(req.url);
  const from = (url.searchParams.get('from') ?? 'USD').toUpperCase();
  const to   = (url.searchParams.get('to')   ?? 'ILS').toUpperCase();
  if (!ALLOWED.includes(from) || !ALLOWED.includes(to)) {
    return new Response(JSON.stringify({ error: 'Currency not allowed' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const upstream = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      { headers: { 'User-Agent': 'trading-journal/2.0' } });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'Upstream error' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const data = await upstream.json();
    const rate = data?.rates?.[to];
    // A malformed body must not reach the client as a usable rate — the caller
    // sizes real orders with this number.
    if (typeof rate !== 'number' || !(rate > 0)) {
      return new Response(JSON.stringify({ error: 'No rate in response' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ from, to, rate, date: data.date ?? null }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
    });
  } catch (e) {
    console.error('[fx] upstream error:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch rate' }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
