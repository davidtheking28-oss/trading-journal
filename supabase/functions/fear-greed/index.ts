const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
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
    return new Response(JSON.stringify({ score, rating }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
