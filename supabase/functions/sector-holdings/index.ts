import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
};

const HOLDINGS: Record<string, string[]> = {
  SOXX: ['NVDA','AVGO','AMD','QCOM','TXN','INTC','AMAT','LRCX','KLAC','MU'],
  AIQ:  ['NVDA','MSFT','META','GOOGL','AMZN','CRM','IBM','ORCL','AMD','PLTR'],
  XOP:  ['XOM','CVX','EOG','PXD','MPC','PSX','VLO','OXY','COP','DVN'],
  QTUM: ['IONQ','RGTI','QBTS','QUBT','IBM','GOOGL','MSFT','NVDA','HONEYWELL','AMZN'],
  GDX:  ['NEM','GOLD','AEM','WPM','KGC','AGI','PAAS','FNV','HL','SSRM'],
  IGV:  ['MSFT','ORCL','CRM','ADBE','NOW','INTU','PANW','SNPS','CDNS','FTNT'],
  ROBO: ['ABB','ISRG','FANUC','YASKAWA','KEYENCE','ROK','PTC','OMRN','BRKS','IRBT'],
  KWEB: ['PDD','JD','BIDU','NTES','TCOM','BEKE','VIPS','KC','FINV','NOAH'],
  IWF:  ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','GOOG','LLY','AVGO','TSLA'],
  SOCL: ['META','SNAP','PINS','SPOT','MTCH','TWTR','NAVER','KAKAO','ZG','YELP'],
  JETS: ['DAL','UAL','AAL','LUV','ALK','JBLU','HA','ULCC','RYAAY','ICAGY'],
  HACK: ['PANW','CRWD','ZS','FTNT','CYBR','OKTA','S','QLYS','TENB','VRNS'],
  SIL:  ['WPM','PAAS','HL','AG','SSRM','SAND','MTA','FSM','EXK','GPL'],
  IYZ:  ['TMUS','VZ','T','LUMN','SATS','IDT','IRDM','GSAT','USM','TDS'],
  XLB:  ['LIN','APD','SHW','FCX','NEM','ECL','NUE','VMC','MLM','ALB'],
  XLU:  ['NEE','SO','DUK','AEP','SRE','EXC','XEL','ED','ETR','WEC'],
  SLX:  ['NUE','STLD','CMC','X','CLF','RS','ATI','WOR','MTL','TS'],
  BITO: ['BTC-USD'],
  XRT:  ['AMZN','HD','TGT','COST','WMT','LOW','TJX','ROST','BURL','DG'],
  IYR:  ['PLD','AMT','EQIX','PSA','O','SPG','WELL','DLR','CCI','EQR'],
  IYT:  ['UPS','FDX','CSX','UNP','NSC','JBHT','ODFL','XPO','CHRW','SAIA'],
  IHI:  ['MDT','ABT','SYK','BSX','EW','ISRG','ZBH','RMD','TFX','HOLX'],
  TAN:  ['ENPH','FSLR','SEDG','RUN','NOVA','ARRY','CSIQ','JKS','SPWR','SHLS'],
  ARKG: ['RXRX','NTLA','CRSP','BEAM','PACB','VEEV','IOVA','FATE','TWST','EXAS'],
  XLI:  ['GE','RTX','CAT','HON','UNP','DE','BA','LMT','ETN','WM'],
  WGMI: ['MARA','RIOT','CLSK','IREN','BTBT','HUT','CIFR','BTDR','CORZ','BRRR'],
  XBI:  ['MRNA','ALNY','VRTX','REGN','SGEN','BMRN','BLUE','KYMR','IONS','ACAD'],
  XLV:  ['UNH','LLY','JNJ','ABBV','MRK','TMO','ABT','DHR','BMY','AMGN'],
  KBE:  ['JPM','BAC','WFC','GS','MS','C','USB','PNC','TFC','COF'],
  ITB:  ['DHI','LEN','NVR','PHM','TMHC','MDC','MHO','BECN','BLDR','IBP'],
  ITA:  ['RTX','LMT','NOC','GD','BA','TDG','HEI','TXT','L3H','KTOS'],
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url    = new URL(req.url);
    const ticker = url.searchParams.get('ticker')?.toUpperCase();
    if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const symbols = HOLDINGS[ticker];
    if (!symbols?.length) return new Response(JSON.stringify({ holdings: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}`;
    const res = await fetch(quoteUrl, { headers: YF_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const results = (json?.quoteResponse?.result ?? []).map((q: Record<string, unknown>) => ({
      symbol: q.symbol,
      name:   q.shortName || q.longName || q.symbol,
      pct:    q.regularMarketChangePercent ?? null,
      price:  q.regularMarketPrice ?? null,
    }));

    // Sort by absolute % change descending
    results.sort((a: { pct: number | null }, b: { pct: number | null }) =>
      Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0)
    );

    return new Response(JSON.stringify({ ticker, holdings: results }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
