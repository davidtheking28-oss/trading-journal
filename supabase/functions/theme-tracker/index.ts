import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

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

async function fetchTheme(theme: { name: string; ticker: string }) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${theme.ticker}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('no result');

    const meta = result.meta;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const timestamps: number[] = result.timestamp ?? [];

    // Filter out null closes
    const valid = closes.map((c: number, i: number) => ({ c, t: timestamps[i] }))
                        .filter(x => x.c != null && x.c > 0);
    const filteredCloses = valid.map(x => x.c);
    const filteredTs     = valid.map(x => x.t);

    return {
      name:   theme.name,
      ticker: theme.ticker,
      today:  meta.regularMarketChangePercent ?? calcPct(filteredCloses, 1),
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

  try {
    const results = await Promise.all(THEMES.map(fetchTheme));
    return new Response(JSON.stringify({ themes: results, ts: Date.now() }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
