import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url = new URL(req.url);
    const ticker = url.searchParams.get('ticker')?.toUpperCase();
    if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Fetch top holdings for the ETF
    const summaryUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=topHoldings`;
    const summaryRes = await fetch(summaryUrl, { headers: YF_HEADERS });
    if (!summaryRes.ok) throw new Error(`HTTP ${summaryRes.status}`);
    const summaryJson = await summaryRes.json();

    const holdings = summaryJson?.quoteSummary?.result?.[0]?.topHoldings?.holdings ?? [];
    if (!holdings.length) return new Response(JSON.stringify({ holdings: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    const symbols = holdings.slice(0, 10).map((h: { symbol: string }) => h.symbol).join(',');

    // Fetch quotes for all holdings in one call
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
    const quoteRes = await fetch(quoteUrl, { headers: YF_HEADERS });
    if (!quoteRes.ok) throw new Error(`quote HTTP ${quoteRes.status}`);
    const quoteJson = await quoteRes.json();

    const quotes: Record<string, { pct: number; name: string }> = {};
    for (const q of quoteJson?.quoteResponse?.result ?? []) {
      quotes[q.symbol] = {
        pct: q.regularMarketChangePercent ?? null,
        name: q.shortName || q.longName || q.symbol,
      };
    }

    const result = holdings.slice(0, 10).map((h: { symbol: string; holdingName: string; holdingPercent: { raw: number } }) => ({
      symbol: h.symbol,
      name: quotes[h.symbol]?.name || h.holdingName || h.symbol,
      weight: h.holdingPercent?.raw ?? null,
      pct: quotes[h.symbol]?.pct ?? null,
    }));

    return new Response(JSON.stringify({ ticker, holdings: result }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
