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

function periodToFrom(period: string): number {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case 'w1':  return now - 7 * 86400;
    case 'm1':  return now - 30 * 86400;
    case 'm3':  return now - 90 * 86400;
    case 'ytd': return Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
    default:    return 0;
  }
}

async function fetchQuote(symbol: string, apiKey: string): Promise<{ symbol: string; name: string; pct: number | null }> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`,
      { headers: { 'User-Agent': 'trading-journal/2.0' } }
    );
    if (!res.ok) return { symbol, name: symbol, pct: null };
    const json = await res.json();
    if (json?.c === 0 && json?.pc === 0 && json?.t === 0) return { symbol, name: symbol, pct: null };
    let pct: number | null = typeof json?.dp === 'number' ? json.dp : null;
    if (pct == null && typeof json?.c === 'number' && typeof json?.pc === 'number' && json.pc > 0) {
      pct = ((json.c - json.pc) / json.pc) * 100;
    }
    return { symbol, name: symbol, pct };
  } catch {
    return { symbol, name: symbol, pct: null };
  }
}

async function fetchCandle(symbol: string, apiKey: string, from: number): Promise<{ symbol: string; name: string; pct: number | null }> {
  try {
    const to = Math.floor(Date.now() / 1000);
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`,
      { headers: { 'User-Agent': 'trading-journal/2.0' } }
    );
    if (!res.ok) return { symbol, name: symbol, pct: null };
    const json = await res.json();
    if (json?.s !== 'ok' || !json.o?.length || !json.c?.length) return { symbol, name: symbol, pct: null };
    const startPrice = json.o[0];
    const endPrice = json.c[json.c.length - 1];
    if (!startPrice) return { symbol, name: symbol, pct: null };
    return { symbol, name: symbol, pct: ((endPrice - startPrice) / startPrice) * 100 };
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

    const symbols = HOLDINGS[ticker];
    if (!symbols?.length) return new Response(JSON.stringify({ holdings: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    const { data: settings } = await supabase.from('user_settings').select('finnhub_key').eq('user_id', user.id).single();
    const apiKey = (settings?.finnhub_key && /^[A-Za-z0-9_]{10,40}$/.test(settings.finnhub_key))
      ? settings.finnhub_key
      : (Deno.env.get('FINNHUB_API_KEY') ?? '');

    if (!apiKey) return new Response(JSON.stringify({ error: 'No Finnhub API key configured.' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const from = periodToFrom(period);
    const results = await Promise.all(
      symbols.map(s => period === 'today' ? fetchQuote(s, apiKey) : fetchCandle(s, apiKey, from))
    );

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
