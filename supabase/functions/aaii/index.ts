const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NASDAQ_KEY = Deno.env.get('NASDAQ_API_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url = `https://data.nasdaq.com/api/v3/datasets/AAII/SENTIMENT/data.json?api_key=${NASDAQ_KEY}&rows=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nasdaq returned ${res.status}`);
    const json = await res.json();

    const cols: string[] = json?.dataset_data?.column_names ?? [];
    const row: number[]  = json?.dataset_data?.data?.[0]  ?? [];

    const idx = (name: string) => cols.findIndex(c => c.toLowerCase().includes(name));
    const bull = row[idx('bull')];
    const neu  = row[idx('neutral')];
    const bear = row[idx('bear')];

    if (bull == null || bear == null) throw new Error('unexpected Nasdaq format');

    return new Response(JSON.stringify({ bull, bear, neu: neu ?? Math.max(0, 100 - bull - bear) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
