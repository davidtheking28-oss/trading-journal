const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const res = await fetch('https://www.aaii.com/sentimentsurvey/sent_res.js', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.aaii.com/sentimentsurvey',
      }
    });
    if (!res.ok) throw new Error(`AAII returned ${res.status}`);
    const text = await res.text();

    // Parse: bullish=46.0;bearish=34.4;neutral=19.5 (or similar JS vars)
    const bull = parseFloat(text.match(/bullish\s*=\s*([\d.]+)/i)?.[1] ?? '');
    const bear = parseFloat(text.match(/bearish\s*=\s*([\d.]+)/i)?.[1] ?? '');
    const neu  = parseFloat(text.match(/neutral\s*=\s*([\d.]+)/i)?.[1] ?? '');

    if (isNaN(bull) || isNaN(bear)) throw new Error(`parse failed: ${text.slice(0, 200)}`);

    return new Response(JSON.stringify({
      bull,
      bear,
      neu: isNaN(neu) ? Math.max(0, 100 - bull - bear) : neu,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
