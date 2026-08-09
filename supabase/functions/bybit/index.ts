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

  // Credentials live in Vault, not in a plaintext user_settings column.
  const [{ data: apiKeyRaw }, { data: apiSecretRaw }] = await Promise.all([
    supabase.rpc('get_broker_secret', { p_user_id: user.id, p_field: 'bybit_api_key' }),
    supabase.rpc('get_broker_secret', { p_user_id: user.id, p_field: 'bybit_api_secret' }),
  ]);
  const apiKey = apiKeyRaw ?? '';
  const apiSecret = apiSecretRaw ?? '';
  if (!apiKey || !apiSecret) {
    return new Response(JSON.stringify({ error: 'Missing Bybit credentials' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Full-history backfill (one-time-ish) so a newly-connected user gets everything,
  // not just Bybit's default last-7-days window.
  try {
    const trades = await computeBybitTrades(apiKey, apiSecret, 730);
    return new Response(JSON.stringify({ trades }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message || 'Bybit error' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
