import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { computeBybitTrades } from '../_shared/bybit.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('bybit_api_key, bybit_api_secret')
    .eq('user_id', user.id)
    .single();

  const apiKey = settings?.bybit_api_key ?? '';
  const apiSecret = settings?.bybit_api_secret ?? '';
  if (!apiKey || !apiSecret) {
    return new Response(JSON.stringify({ error: 'Missing Bybit credentials' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Full-history backfill (one-time-ish) so a newly-connected user gets everything,
  // not just Bybit's default last-7-days window.
  try {
    const trades = await computeBybitTrades(apiKey, apiSecret, 365);
    return new Response(JSON.stringify({ trades }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message || 'Bybit error' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
