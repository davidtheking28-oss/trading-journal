import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Shared cache — identical for all users; this index updates ~once a day.
  // Refresh at most hourly and fall back to the last good payload on failure.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const CACHE_KEY = 'crypto-fear-greed';
  const CACHE_TTL_MS = 3_600_000;
  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' };
  const { data: cached } = await admin
    .from('market_cache').select('payload, refreshed_at').eq('cache_key', CACHE_KEY).maybeSingle();
  if (cached && Date.now() - new Date(cached.refreshed_at).getTime() < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.payload), { headers: jsonHeaders });
  }

  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`alternative.me returned ${res.status}`);
    const data = await res.json();
    const entry = data?.data?.[0];
    if (!entry) throw new Error('no data in response');
    const payload = { score: parseInt(entry.value), rating: entry.value_classification };
    await admin.from('market_cache').upsert({ cache_key: CACHE_KEY, payload, refreshed_at: new Date().toISOString() });
    return new Response(JSON.stringify(payload), { headers: jsonHeaders });
  } catch (e) {
    console.error('[crypto-fear-greed] error:', e);
    if (cached) return new Response(JSON.stringify(cached.payload), { headers: jsonHeaders });
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
