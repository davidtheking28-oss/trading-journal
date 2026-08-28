import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { serveCached } from '../_shared/swr.ts';

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
  // alternative.me publishes one value per day, so a stale row inside 48h is
  // still the current reading often enough to paint immediately and refresh
  // behind the response.
  const MAX_STALE_MS = 48 * 60 * 60 * 1000;
  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' };

  const refresh = async () => {
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
      return payload;
    } catch (e) {
      console.error('[crypto-fear-greed] error:', e);
      return null;
    }
  };

  const { payload } = await serveCached(admin, CACHE_KEY, CACHE_TTL_MS, MAX_STALE_MS, refresh);
  if (payload) return new Response(JSON.stringify(payload), { headers: jsonHeaders });
  return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
    status: 500, headers: jsonHeaders
  });
});
