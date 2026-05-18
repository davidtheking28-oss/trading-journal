import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`alternative.me returned ${res.status}`);
    const data = await res.json();
    const entry = data?.data?.[0];
    if (!entry) throw new Error('no data in response');
    return new Response(JSON.stringify({
      score: parseInt(entry.value),
      rating: entry.value_classification,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('[crypto-fear-greed] error:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
