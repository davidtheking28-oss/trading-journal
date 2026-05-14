import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const HOLDINGS: Record<string, string[]> = {
  SOXX: ['NVDA','AVGO','AMD','QCOM','TXN','INTC','AMAT','LRCX','KLAC','MU','MRVL','ON','MPWR','NXPI','ADI','MCHP','TER','ENTG','SWKS','QRVO','WOLF','SLAB','AMBA','CRUS','POWI','FORM','LSCC','ONTO','MKSI','AZTA'],
  AIQ:  ['NVDA','MSFT','META','GOOGL','AMZN','CRM','IBM','ORCL','AMD','PLTR','SNOW','AI','PATH','SOUN','ARISTA','NET','MDB','DDOG','GTLB','APP','BBAI','CFLT','UPST','ZS','PANW','DT','ESTC','HUBS','TTD','MNDY'],
  XOP:  ['XOM','CVX','EOG','FANG','MPC','PSX','VLO','OXY','COP','DVN','HES','APA','MRO','SLB','HAL','BKR','CIVI','SM','MTDR','PR','VTLE','NOG','KOS','CNX','AR','RRC','EQT','LNG','OVV','TRGP'],
  QTUM: ['IONQ','RGTI','QBTS','QUBT','IBM','GOOGL','MSFT','NVDA','HON','AMZN','INTC','ARQQ','MU','AVGO','FORM','MKSI','ONTO','AZTA','BIDU','SANM'],
  GDX:  ['NEM','GOLD','AEM','WPM','KGC','AGI','PAAS','FNV','HL','SSRM','KL','OR','MAG','RGLD','BTG','EDV','CDE','MTA','EXK','FSM','SILV','PVG','SAND','DRD','HMY','AU','GFI'],
  IGV:  ['MSFT','ORCL','CRM','ADBE','NOW','INTU','PANW','SNPS','CDNS','FTNT','TEAM','WDAY','DDOG','MDB','VEEV','HUBS','GTLB','ESTC','APPF','AZPN','PCTY','BSY','BILL','TOST','TTD','BRZE','MNDY','ZM','DOCN','BOX'],
  ROBO: ['ABB','ISRG','CGNX','ZBRA','TRMB','ROK','PTC','NXPI','BRKS','TER','NVDA','OMCL','ONTO','MKSI','AZTA','ACMR','FORM','LSCC','MVIS','OUST','AEVA','LAZR'],
  KWEB: ['PDD','JD','BIDU','NTES','TCOM','BEKE','VIPS','KC','BABA','TME','IQ','BILI','EDU','XPEV','NIO','LI','WB','TIGR','DOYU','HUYA','RLX','NOAH','YMM','DQ','GDS','MNSO','ZTO','HTHT','YUMC','BZ'],
  IWF:  ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','LLY','AVGO','TSLA','V','MA','UNH','HD','COST','NFLX','ADBE','CRM','AMD','ORCL','TMO','NOW','ABBV','MRK','ABT','DHR','ISRG','TXN','QCOM','INTU','AMAT'],
  SOCL: ['META','SNAP','PINS','SPOT','MTCH','RDDT','GOOGL','YELP','BMBL','RBLX','DUOL','HOOD','ETSY','LYFT','UBER','ABNB','DASH','IAC','TKO','MSGS','CARG','RVLV','POSH'],
  JETS: ['DAL','UAL','AAL','LUV','ALK','JBLU','ALGT','ULCC','RYAAY','SKYW','HA','JOBY','ACHR','SNCY','GOL','AZUL','MESA','BA','SPR','HXL','TDG'],
  HACK: ['PANW','CRWD','ZS','FTNT','NET','OKTA','S','QLYS','TENB','VRNS','CYBR','RPD','CSCO','DDOG','DT','ESTC','MNDT','JAMF','TELOS','BAH','LDOS','SAIC','CACI'],
  SIL:  ['WPM','PAAS','HL','AG','SSRM','CDE','MTA','FSM','EXK','RGLD','SVM','SILV','MAG','SAND','BTG','PVG','GATO','GPL','SA'],
  IYZ:  ['TMUS','VZ','T','LUMN','SATS','IDT','IRDM','GSAT','USM','TDS','CHTR','CMCSA','CABO','FYBR','BAND','OOMA','ATNI','LBRDA','ATUS','LBTYA','SHEN','CNSL'],
  XLB:  ['LIN','APD','SHW','FCX','NEM','ECL','NUE','VMC','MLM','ALB','DD','PPG','IFF','CF','MOS','FMC','RPM','PKG','IP','BALL','SEE','BMS','SON','GEF','EMN','HUN','OLN','KRO','TROX'],
  XLU:  ['NEE','SO','DUK','AEP','SRE','EXC','XEL','ED','ETR','WEC','ES','PPL','CNP','CMS','ATO','LNT','PNW','EVRG','OGE','POR','AVA','NI','AWK'],
  SLX:  ['NUE','STLD','CMC','X','CLF','RS','ATI','WOR','HCC','TS','MT','GGB','SID','METC','ESAB','ZEUS','HAYN','PKX','SCHN','TX','WIRE','KALU','CRS','CSTM'],
  BITO: ['MARA','RIOT','CLSK','COIN','MSTR','HUT','CIFR','BTDR','BITF','WULF','IREN','BTBT','SQ','HOOD','CORZ','HIVE','ARBK','PYPL','GREE'],
  XRT:  ['AMZN','HD','TGT','COST','WMT','LOW','TJX','ROST','BURL','DG','DLTR','BBY','ULTA','LULU','FIVE','OLLI','BOOT','GPS','ANF','AEO','URBN','KSS','M','JWN'],
  IYR:  ['PLD','AMT','EQIX','PSA','O','SPG','WELL','DLR','CCI','EQR','AVB','VICI','ARE','BXP','EXR','CUBE','LSI','MAA','UDR','CPT','NNN','GLPI','KIM','REG','FRT'],
  IYT:  ['UPS','FDX','CSX','UNP','NSC','JBHT','ODFL','XPO','CHRW','SAIA','EXPD','GXO','TFII','LSTR','KNX','WERN','MRTN','HUBG','ARCB','SNDR','HTLD','CVLG','RXO'],
  IHI:  ['MDT','ABT','SYK','BSX','EW','ISRG','ZBH','RMD','TFX','HOLX','BDX','DXCM','SWAV','NARI','INSP','TNDM','ICAD','MASI','NVRO','GKOS','LMAT','AXNX','IRTC'],
  TAN:  ['ENPH','FSLR','SEDG','RUN','DQ','ARRY','CSIQ','JKS','CWEN','SHLS','NOVA','MAXN','SPWR','BE','FLNC','STEM','AMPX','NEP','ORA','HASI','AES'],
  ARKG: ['RXRX','NTLA','CRSP','BEAM','PACB','VEEV','IOVA','TWST','ILMN','EDIT','ALNY','EXAS','GH','NTRA','TDOC','SDGR','QDEL','KRTX','RARE','INSM','FOLD'],
  XLI:  ['GE','RTX','CAT','HON','UNP','DE','BA','LMT','ETN','WM','MMM','EMR','PH','ROK','CARR','OTIS','TT','NDSN','ROP','CPRT','GEV','AXON','VRSK','PWR','FTV'],
  WGMI: ['MARA','RIOT','CLSK','IREN','BTBT','HUT','CIFR','BTDR','BITF','WULF','CORZ','HIVE','SOS','ARBK','GREE','COIN','MSTR'],
  XBI:  ['MRNA','ALNY','VRTX','REGN','INCY','BMRN','SRPT','KYMR','IONS','ACAD','EXEL','INSM','ARWR','ITCI','CYTK','HALO','FOLD','RCKT','BGNE','ZYME','PTGX','MGNX','PRGO'],
  XLV:  ['UNH','LLY','JNJ','ABBV','MRK','TMO','ABT','DHR','BMY','AMGN','GILD','ISRG','CVS','CI','MCK','CAH','ABC','DGX','LH','IQV','HUM','CNC','MDT','ZBH','BAX'],
  KBE:  ['JPM','BAC','WFC','GS','MS','C','USB','PNC','TFC','COF','SCHW','BK','STT','RF','KEY','FITB','HBAN','CFG','MTB','ZION','WAL','EWBC','OZK','FHN'],
  ITB:  ['DHI','LEN','NVR','PHM','TMHC','MDC','MHO','BECN','BLDR','IBP','SKY','CVCO','LGIH','TPH','CCS','GRBK','JELD','MAS','AWI','FBHS','SSD','TREX','AZEK','DOOR','UFPI'],
  ITA:  ['RTX','LMT','NOC','GD','BA','TDG','HEI','TXT','LHX','KTOS','BWXT','LDOS','SAIC','CACI','MOOG','CW','HII','AXON','AVAV','VSE','DRS'],
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

function periodRange(period: string): string {
  switch (period) {
    case 'w1':  return '1mo';
    case 'm1':  return '3mo';
    case 'm3':  return '6mo';
    case 'ytd': return 'ytd';
    default:    return '5d';
  }
}

async function fetchStock(symbol: string, period: string): Promise<{ symbol: string; name: string; pct: number | null }> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${periodRange(period)}&interval=1d`;
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
    const top10 = results
      .filter(r => r.pct !== null)
      .sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity))
      .slice(0, 10);

    return new Response(JSON.stringify({ ticker, holdings: top10 }), {
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
