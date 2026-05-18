import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BYBIT_BASE = 'https://api.bybit.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const encoder = new TextEncoder();

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
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

  const apiKey    = settings?.bybit_api_key ?? '';
  const apiSecret = settings?.bybit_api_secret ?? '';

  if (!apiKey || !apiSecret) {
    return new Response(JSON.stringify({ error: 'Missing Bybit credentials' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const url      = new URL(req.url);
  const category = url.searchParams.get('category') || 'linear';
  const limit    = '200';

  const timestamp   = Date.now().toString();
  const recvWindow  = '5000';
  const queryString = `category=${category}&limit=${limit}`;
  const signStr     = timestamp + apiKey + recvWindow + queryString;
  const signature   = await hmacSha256(apiSecret, signStr);

  const upstream = await fetch(`${BYBIT_BASE}/v5/position/closed-pnl?${queryString}`, {
    headers: {
      'X-BAPI-API-KEY':      apiKey,
      'X-BAPI-SIGN':         signature,
      'X-BAPI-SIGN-TYPE':    '2',
      'X-BAPI-TIMESTAMP':    timestamp,
      'X-BAPI-RECV-WINDOW':  recvWindow,
    },
  });

  const json = await upstream.json();

  if (json.retCode !== 0) {
    return new Response(JSON.stringify({ error: json.retMsg || 'Bybit error' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const raw    = json.result?.list ?? [];
  const trades = raw.map((item: Record<string, string>) => ({
    type:        'crypto',
    ls:          item.side === 'Buy' ? 'Long' : 'Short',
    symbol:      item.symbol.replace(/USDT$|USD$|BUSD$/, ''),
    entryDate:   new Date(+item.createdTime).toISOString().split('T')[0],
    closeDate:   new Date(+item.updatedTime).toISOString().split('T')[0],
    entryPrice:  parseFloat(item.avgEntryPrice),
    exitPrice:   parseFloat(item.avgExitPrice),
    shares:      parseFloat(item.closedSize),
    pnl:         parseFloat(item.closedPnl),
    stop:        null,
    t:           [],
  }));

  return new Response(JSON.stringify({ trades }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
