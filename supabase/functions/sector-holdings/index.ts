import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const HOLDINGS: Record<string, string[]> = {
  SOXX: ['NVDA','AVGO','AMD','QCOM','TXN','INTC','AMAT','LRCX','KLAC','MU'],
  AIQ:  ['NVDA','MSFT','META','GOOGL','AMZN','CRM','IBM','ORCL','AMD','PLTR'],
  XOP:  ['XOM','CVX','EOG','FANG','MPC','PSX','VLO','OXY','COP','DVN'],
  QTUM: ['IONQ','RGTI','QBTS','QUBT','IBM','GOOGL','MSFT','NVDA','HON','AMZN'],
  GDX:  ['NEM','B','AEM','WPM','KGC','AGI','PAAS','FNV','HL','SSRM'],
  IGV:  ['MSFT','ORCL','CRM','ADBE','NOW','INTU','PANW','SNPS','CDNS','FTNT'],
  ROBO: ['ABB','ISRG','CGNX','ZBRA','TRMB','ROK','PTC','NXPI','BRKS','TER'],
  KWEB: ['PDD','JD','BIDU','NTES','TCOM','BEKE','VIPS','KC','FINV','NOAH'],
  IWF:  ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','GOOG','LLY','AVGO','TSLA'],
  SOCL: ['META','SNAP','PINS','SPOT','MTCH','RDDT','GOOGL','ZG','YELP','BMBL'],
  JETS: ['DAL','UAL','AAL','LUV','ALK','JBLU','ALGT','ULCC','RYAAY','SKYW'],
  HACK: ['PANW','CRWD','ZS','FTNT','NET','OKTA','S','QLYS','TENB','VRNS'],
  SIL:  ['WPM','PAAS','HL','AG','SSRM','CDE','MTA','FSM','EXK','RGLD'],
  IYZ:  ['TMUS','VZ','T','LUMN','SATS','IDT','IRDM','GSAT','USM','TDS'],
  XLB:  ['LIN','APD','SHW','FCX','NEM','ECL','NUE','VMC','MLM','ALB'],
  XLU:  ['NEE','SO','DUK','AEP','SRE','EXC','XEL','ED','ETR','WEC'],
  SLX:  ['NUE','STLD','CMC','X','CLF','RS','ATI','WOR','HCC','TS'],
  BITO: ['MARA','RIOT','CLSK','COIN','MSTR','HUT','CIFR','BTDR','BITF','WULF'],
  XRT:  ['AMZN','HD','TGT','COST','WMT','LOW','TJX','ROST','BURL','DG'],
  IYR:  ['PLD','AMT','EQIX','PSA','O','SPG','WELL','DLR','CCI','EQR'],
  IYT:  ['UPS','FDX','CSX','UNP','NSC','JBHT','ODFL','XPO','CHRW','SAIA'],
  IHI:  ['MDT','ABT','SYK','BSX','EW','ISRG','ZBH','RMD','TFX','HOLX'],
  TAN:  ['ENPH','FSLR','SEDG','RUN','DQ','ARRY','CSIQ','JKS','CWEN','SHLS'],
  ARKG: ['RXRX','NTLA','CRSP','BEAM','PACB','VEEV','IOVA','FATE','TWST','ILMN'],
  XLI:  ['GE','RTX','CAT','HON','UNP','DE','BA','LMT','ETN','WM'],
  WGMI: ['MARA','RIOT','CLSK','IREN','BTBT','HUT','CIFR','BTDR','BITF','WULF'],
  XBI:  ['MRNA','ALNY','VRTX','REGN','INCY','BMRN','SRPT','KYMR','IONS','ACAD'],
  XLV:  ['UNH','LLY','JNJ','ABBV','MRK','TMO','ABT','DHR','BMY','AMGN'],
  KBE:  ['JPM','BAC','WFC','GS','MS','C','USB','PNC','TFC','COF'],
  ITB:  ['DHI','LEN','NVR','PHM','TMHC','MDC','MHO','BECN','BLDR','IBP'],
  ITA:  ['RTX','LMT','NOC','GD','BA','TDG','HEI','TXT','LHX','KTOS'],
};

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchETFHoldings(etfTicker: string): Promise<string[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(etfTicker)}?modules=topHoldings`;
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return [];
    const json = await res.json();
    const holdings: { symbol?: string }[] = json?.quoteSummary?.result?.[0]?.topHoldings?.holdings ?? [];
    const symbols = holdings.map(h => h.symbol).filter((s): s is string => !!s && /^[A-Z0-9.]{1,10}$/.test(s));
    return symbols;
  } catch {
    return [];
  }
}

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

async function fetchStock(symbol: string, period: string): Promise<{ symbol: string; name: string; pct: number | null }> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return { symbol, name: symbol, pct: null };
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return { symbol, name: symbol, pct: null };

    const meta = result.meta;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const timestamps: number[] = result.timestamp ?? [];

    const valid = closes
      .map((c: number, i: number) => ({ c, t: timestamps[i] }))
      .filter(x => x.c != null && x.c > 0);
    const filteredCloses = valid.map(x => x.c);
    const filteredTs     = valid.map(x => x.t);

    let pct: number | null = null;
    switch (period) {
      case 'today': pct = meta.regularMarketChangePercent ?? calcPct(filteredCloses, 1); break;
      case 'w1':    pct = calcPct(filteredCloses, 5);  break;
      case 'm1':    pct = calcPct(filteredCloses, 21); break;
      case 'm3':    pct = calcPct(filteredCloses, 63); break;
      case 'ytd':   pct = calcYtd(filteredCloses, filteredTs); break;
    }
    return { symbol, name: symbol, pct };
  } catch {
    return { symbol, name: symbol, pct: null };
  }
}

serve(async (req: Request) => {
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

  try {
    const url    = new URL(req.url);
    const ticker = url.searchParams.get('ticker')?.toUpperCase();
    const period = url.searchParams.get('period') ?? 'today';

    if (!ticker || !/^[A-Z0-9]{1,10}$/.test(ticker)) {
      return new Response(JSON.stringify({ error: 'Invalid ticker' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    let symbols = await fetchETFHoldings(ticker);
    if (!symbols.length) symbols = HOLDINGS[ticker] ?? [];
    if (!symbols.length) return new Response(JSON.stringify({ holdings: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    const results = await Promise.all(symbols.map(s => fetchStock(s, period)));
    results.sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));

    return new Response(JSON.stringify({ ticker, holdings: results }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('[sector-holdings] error:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
