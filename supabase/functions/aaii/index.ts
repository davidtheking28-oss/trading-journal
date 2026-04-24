const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FRED_KEY = Deno.env.get('FRED_API_KEY') ?? '';
const BASE = 'https://api.stlouisfed.org/fred/series/observations';

async function fred(id: string): Promise<number> {
  const url = `${BASE}?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=1&file_type=json`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`FRED ${id} ${res.status}: ${text.slice(0,200)}`);
  const data = JSON.parse(text);
  const val = data?.observations?.[0]?.value;
  if (!val || val === '.') throw new Error(`no value for ${id}`);
  return parseFloat(val);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!FRED_KEY) {
    return new Response(JSON.stringify({ error: 'FRED_API_KEY not set' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const [bull, bear] = await Promise.all([
      fred('AAIIBULL'),
      fred('AAIIBEAR'),
    ]);
    const neu = Math.max(0, parseFloat((100 - bull - bear).toFixed(1)));
    return new Response(JSON.stringify({ bull, bear, neu }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
