import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const INDICES = [
  { name: 'S&P 500',     ticker: 'SPY'  },
  { name: 'Nasdaq 100',  ticker: 'QQQ'  },
  { name: 'Russell 2000',ticker: 'IWM'  },
];

const THEMES = [
  { name: 'Semiconductors',  ticker: 'SOXX'  },
  { name: 'AI',              ticker: 'AIQ'   },
  { name: 'Oil & Gas',       ticker: 'XOP'   },
  { name: 'Quantum',         ticker: 'QTUM'  },
  { name: 'Gold Miners',     ticker: 'GDX'   },
  { name: 'Software',        ticker: 'IGV'   },
  { name: 'Robotics',        ticker: 'ROBO'  },
  { name: 'China Internet',  ticker: 'KWEB'  },
  { name: 'Growth Stocks',   ticker: 'IWF'   },
  { name: 'Social Media',    ticker: 'SOCL'  },
  { name: 'Airlines',        ticker: 'JETS'  },
  { name: 'Cybersecurity',   ticker: 'HACK'  },
  { name: 'Silver Miners',   ticker: 'SIL'   },
  { name: 'Telecom',         ticker: 'IYZ'   },
  { name: 'Materials',       ticker: 'XLB'   },
  { name: 'Utilities',       ticker: 'XLU'   },
  { name: 'Steel',           ticker: 'SLX'   },
  { name: 'Bitcoin',         ticker: 'BITO'  },
  { name: 'Retail',          ticker: 'XRT'   },
  { name: 'Real Estate',     ticker: 'IYR'   },
  { name: 'Transports',      ticker: 'IYT'   },
  { name: 'Medical',         ticker: 'IHI'   },
  { name: 'Solar',           ticker: 'TAN'   },
  { name: 'Genomics',        ticker: 'ARKG'  },
  { name: 'Industrials',     ticker: 'XLI'   },
  { name: 'Bitcoin Miners',  ticker: 'WGMI'  },
  { name: 'Biotechnology',   ticker: 'XBI'   },
  { name: 'HealthCare',      ticker: 'XLV'   },
  { name: 'Banks',           ticker: 'KBE'   },
  { name: 'Home Construction', ticker: 'ITB' },
  { name: 'Aerospace',       ticker: 'ITA'   },
];

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function calcPct(closes: number[], daysBack: number): number | null {
  const last = closes[closes.length - 1];
  const idx = closes.length - 1 - daysBack;
  if (idx < 0) return null;
  const base = closes[idx];
  if (!base) return null;
  return ((last - base) / base) * 100;
}

function calcYtd(closes: number[], timestamps: number[]): number | null {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
  const ytdIdx = timestamps.findIndex(t => t >= yearStart);
  if (ytdIdx < 0) return null;
  const base = closes[ytdIdx > 0 ? ytdIdx - 1 : ytdIdx];
  const last = closes[closes.length - 1];
  if (!base) return null;
  return ((last - base) / base) * 100;
}

const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function fetchTheme(theme: { name: string; ticker: string }) {
  try {
    let result = null;
    for (const host of YF_HOSTS) {
      try {
        const url = `https://${host}/v8/finance/chart/${theme.ticker}?range=1y&interval=1d`;
        const res = await fetch(url, { headers: YF_HEADERS });
        if (!res.ok) continue;
        const json = await res.json();
        result = json?.chart?.result?.[0];
        if (result) break;
      } catch { /* try next host */ }
    }
    if (!result) throw new Error('no result');

    const meta = result.meta;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const timestamps: number[] = result.timestamp ?? [];

    const valid = closes.map((c: number, i: number) => ({ c, t: timestamps[i] }))
                        .filter(x => x.c != null && x.c > 0);
    const filteredCloses = valid.map(x => x.c);
    const filteredTs     = valid.map(x => x.t);

    const todayPct = calcPct(filteredCloses, 1);

    return {
      name:   theme.name,
      ticker: theme.ticker,
      today:  todayPct,
      w1:     calcPct(filteredCloses, 5),
      m1:     calcPct(filteredCloses, 21),
      m3:     calcPct(filteredCloses, 63),
      ytd:    calcYtd(filteredCloses, filteredTs),
    };
  } catch {
    return { name: theme.name, ticker: theme.ticker, today: null, w1: null, m1: null, m3: null, ytd: null };
  }
}

serve(async (req: Request) => {
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

  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount } = await supabase
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', windowStart);

  if ((recentCount ?? 0) >= 10) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
      { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
  supabase.from('ai_requests').insert({ user_id: user.id }).then(() => {});

  // Shared cache: this data is identical for every user. Serve a row that all
  // users share, refreshed at most once per CACHE_TTL_MS. On a source failure
  // we fall back to the last good cached payload instead of erroring.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const CACHE_KEY = 'theme-tracker';
  const CACHE_TTL_MS = 60_000;
  const { data: cached } = await admin
    .from('market_cache').select('payload, refreshed_at').eq('cache_key', CACHE_KEY).maybeSingle();
  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' };
  if (cached && Date.now() - new Date(cached.refreshed_at).getTime() < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.payload), { headers: jsonHeaders });
  }

  try {
    const [results, indices] = await Promise.all([
      Promise.all(THEMES.map(fetchTheme)),
      Promise.all(INDICES.map(fetchTheme)),
    ]);
    const payload = { themes: results, indices, ts: Date.now() };
    await admin.from('market_cache').upsert({ cache_key: CACHE_KEY, payload, refreshed_at: new Date().toISOString() });
    return new Response(JSON.stringify(payload), { headers: jsonHeaders });
  } catch (e) {
    console.error('[theme-tracker] error:', e);
    if (cached) return new Response(JSON.stringify(cached.payload), { headers: jsonHeaders });
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
