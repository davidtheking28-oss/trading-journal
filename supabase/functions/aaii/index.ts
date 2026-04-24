const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const res = await fetch('https://www.aaii.com/sentimentsurvey', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    if (!res.ok) throw new Error(`AAII page returned ${res.status}`);
    const html = await res.text();

    // Find percentages near "Bullish", "Neutral", "Bearish" labels
    const pct = (label: string) => {
      const re = new RegExp(label + '[^%]*?(\\d+\\.?\\d*)\\s*%', 'i');
      const m = html.match(re);
      return m ? parseFloat(m[1]) : null;
    };

    let bull = pct('Bullish');
    let bear = pct('Bearish');
    let neu  = pct('Neutral');

    // Fallback: look for the three largest % numbers near "sentiment"
    if (!bull || !bear) {
      const nums = [...html.matchAll(/(\d{1,2}\.\d)%/g)].map(m => parseFloat(m[1]));
      if (nums.length >= 3) { [bull, neu, bear] = nums.slice(0, 3); }
    }

    if (!bull || !bear) throw new Error('parse failed — AAII changed their HTML');

    return new Response(JSON.stringify({
      bull: bull ?? 0,
      bear: bear ?? 0,
      neu: neu ?? Math.max(0, 100 - (bull ?? 0) - (bear ?? 0)),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
