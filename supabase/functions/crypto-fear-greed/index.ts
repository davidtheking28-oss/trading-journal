const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
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
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
