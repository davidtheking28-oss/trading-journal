import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const BYBIT_BASE = 'https://api.bybit.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const encoder = new TextEncoder();

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bybitGet(apiKey: string, apiSecret: string, path: string, params: Record<string, string>) {
  const queryString = new URLSearchParams(params).toString();
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signature = await hmacSha256(apiSecret, timestamp + apiKey + recvWindow + queryString);
  const res = await fetch(`${BYBIT_BASE}${path}?${queryString}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });
  return res.json();
}

interface ExecEntry { qty: number; price: number; fee: number; time: number; }
interface OpenPos   { side: 'Long' | 'Short'; entries: ExecEntry[]; }

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

  // Fetch up to 3 pages of executions (600 total)
  const allExecs: Record<string, string>[] = [];
  let cursor = '';
  for (let page = 0; page < 3; page++) {
    const params: Record<string, string> = { category: 'linear', limit: '200', execType: 'Trade' };
    if (cursor) params.cursor = cursor;
    const json = await bybitGet(apiKey, apiSecret, '/v5/execution/list', params);
    if (json.retCode !== 0) {
      return new Response(JSON.stringify({ error: json.retMsg || 'Bybit error' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const list: Record<string, string>[] = json.result?.list ?? [];
    allExecs.push(...list);
    cursor = json.result?.nextPageCursor ?? '';
    if (!cursor || list.length < 200) break;
  }

  // Sort ascending so we can process FIFO
  allExecs.sort((a, b) => parseInt(a.execTime) - parseInt(b.execTime));

  const openPositions = new Map<string, OpenPos>();
  const trades: Record<string, unknown>[] = [];

  for (const exec of allExecs) {
    const symbol     = exec.symbol;
    const side       = exec.side;
    const qty        = parseFloat(exec.execQty);
    const price      = parseFloat(exec.execPrice);
    const fee        = parseFloat(exec.execFee || '0');
    const time       = parseInt(exec.execTime);
    const closedSize = parseFloat(exec.closedSize || '0');

    if (closedSize === 0) {
      // Opening or adding to position
      const ls: 'Long' | 'Short' = side === 'Buy' ? 'Long' : 'Short';
      if (!openPositions.has(symbol)) {
        openPositions.set(symbol, { side: ls, entries: [] });
      }
      openPositions.get(symbol)!.entries.push({ qty, price, fee, time });
    } else {
      // Closing execution
      const pos = openPositions.get(symbol);
      let entryTime: number;
      let avgEntry: number;
      let entryFees: number;
      let ls: 'Long' | 'Short';

      if (pos) {
        ls        = pos.side;
        entryTime = pos.entries[0].time;
        const totalQty = pos.entries.reduce((s, e) => s + e.qty, 0);
        avgEntry  = pos.entries.reduce((s, e) => s + e.price * e.qty, 0) / totalQty;
        entryFees = pos.entries.reduce((s, e) => s + e.fee, 0);
        const remaining = totalQty - closedSize;
        if (remaining <= 0.0001) {
          openPositions.delete(symbol);
        } else {
          pos.entries = [{ qty: remaining, price: avgEntry, fee: 0, time: pos.entries[0].time }];
        }
      } else {
        // Orphan close — position opened before our data window
        ls        = side === 'Sell' ? 'Long' : 'Short';
        entryTime = time;
        avgEntry  = price;
        entryFees = 0;
      }

      const commission = Math.round((entryFees + fee) * 10000) / 10000;
      const ep  = Math.round(avgEntry * 100) / 100;
      const xp  = Math.round(price * 100) / 100;
      const pnl = ls === 'Long'
        ? Math.round((xp - ep) * closedSize * 100) / 100 - commission
        : Math.round((ep - xp) * closedSize * 100) / 100 - commission;

      trades.push({
        type:       'crypto',
        ls,
        symbol:     symbol.replace(/USDT$|USD$|BUSD$/, ''),
        entryDate:  new Date(entryTime).toISOString().split('T')[0],
        closeDate:  new Date(time).toISOString().split('T')[0],
        entryPrice: ep,
        exitPrice:  xp,
        shares:     closedSize,
        commission,
        pnl,
        stop:       null,
        t:          [],
      });
    }
  }

  return new Response(JSON.stringify({ trades }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
