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

  // Shared cache — identical for all users. Refresh at most every 5 min; serve
  // the last good payload if CNN is unreachable.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const CACHE_KEY = 'fear-greed';
  const CACHE_TTL_MS = 300_000;
  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' };
  const { data: cached } = await admin
    .from('market_cache').select('payload, refreshed_at').eq('cache_key', CACHE_KEY).maybeSingle();
  if (cached && Date.now() - new Date(cached.refreshed_at).getTime() < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.payload), { headers: jsonHeaders });
  }

  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://edition.cnn.com/markets/fear-and-greed',
        'Origin': 'https://edition.cnn.com',
      }
    });
    if (!res.ok) throw new Error(`CNN returned ${res.status}`);
    const data = await res.json();
    const score = data?.fear_and_greed?.score;
    const rating = data?.fear_and_greed?.rating;
    if (score == null) throw new Error('no score in response');
    const payload = { score, rating };
    await admin.from('market_cache').upsert({ cache_key: CACHE_KEY, payload, refreshed_at: new Date().toISOString() });
    return new Response(JSON.stringify(payload), { headers: jsonHeaders });
  } catch (e) {
    console.error('[fear-greed] error:', e);
    if (cached) return new Response(JSON.stringify(cached.payload), { headers: jsonHeaders });
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
