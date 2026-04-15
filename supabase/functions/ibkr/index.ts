import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const IBKR_BASE = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService';
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

  // Credentials come from DB — never from client request params
  const { data: settings } = await supabase
    .from('user_settings')
    .select('flex_token, flex_query_id')
    .eq('user_id', user.id)
    .single();

  const token = settings?.flex_token ?? '';
  const qid   = settings?.flex_query_id ?? '';

  if (!token || !/^\d{10,35}$/.test(token)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid IBKR token' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const url    = new URL(req.url);
  const action = url.searchParams.get('action') ?? 'send';

  let endpoint: string;
  if (action === 'send') {
    if (!qid || !/^\d{1,15}$/.test(qid)) {
      return new Response(JSON.stringify({ error: 'Missing or invalid IBKR query ID' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    endpoint = `${IBKR_BASE}.SendRequest?t=${token}&q=${qid}&v=3`;
  } else if (action === 'get') {
    const refCode = url.searchParams.get('ref') ?? '';
    if (!refCode || !/^\w{1,30}$/.test(refCode)) {
      return new Response(JSON.stringify({ error: 'Invalid reference code' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    endpoint = `${IBKR_BASE}.GetStatement?t=${token}&q=${refCode}&v=3`;
  } else {
    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const upstream = await fetch(endpoint, { headers: { 'User-Agent': 'trading-journal/2.0' } });
  const xml = await upstream.text();
  return new Response(xml, { status: upstream.status, headers: { ...CORS, 'Content-Type': 'text/xml' } });
});
