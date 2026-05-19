import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function scoreToRating(score: number): string {
  if (score <= 24) return 'extreme fear';
  if (score <= 44) return 'fear';
  if (score <= 55) return 'neutral';
  if (score <= 74) return 'greed';
  return 'extreme greed';
}

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
    const res = await fetch('https://feargreedchart.com/api/?action=all', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`feargreedchart returned ${res.status}`);
    const data = await res.json();
    const score = data?.score?.score;
    if (score == null) throw new Error('no score in response');
    const rating = scoreToRating(Math.round(score));
    return new Response(JSON.stringify({ score, rating }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('[fear-greed] error:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
