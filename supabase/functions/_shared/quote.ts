// Live quote resolution with a fallback source.
//
// Measured 2026-08-31 against a valid Finnhub key: MD requested 8 times, two
// seconds apart (0.5 req/s against a 60/min allowance, so nowhere near a rate
// limit) returned HTTP 503 "error code: 1200" — a Cloudflare-level failure on
// Finnhub's side — five times out of eight. Other symbols failed the same way
// in the same run, so it is not symbol-specific.
//
// A single failed call used to mean the live P&L card rendered "no quotes
// available" for the whole refresh, and while the US market is closed the
// caller's own 15-minute throttle then held that state. One flaky upstream
// must not be the only thing standing between the user and a price, so an
// unresolved symbol retries, then falls back to Yahoo — the same free,
// keyless chart endpoint theme-tracker and fear-greed already depend on.

const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
};

export type Quote = { c: number } | null;

export type Fetcher = typeof fetch;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// A quote is only usable if it carries a positive current price. Finnhub
// answers an unknown symbol with a 200 and `c: 0`, which is not a price — the
// client's own `if (!price) return` already treats it as missing, so treating
// it as missing here too is what lets the fallback actually run.
function priceOf(body: unknown): number | null {
  const c = (body as { c?: unknown } | null)?.c;
  return typeof c === 'number' && c > 0 ? c : null;
}

export async function finnhubQuote(sym: string, apiKey: string, f: Fetcher = fetch): Promise<number | null> {
  return await withTimeout(5000, async signal => {
    const r = await f(
      `https://finnhub.io/api/v1/quote?token=${encodeURIComponent(apiKey)}&symbol=${encodeURIComponent(sym)}`,
      { headers: { 'User-Agent': 'trading-journal/2.0' }, signal },
    );
    if (!r.ok) return null;
    return priceOf(await r.json());
  });
}

// Yahoo spells a share class with a dash where Finnhub (and the journal's own
// rows) use a dot: BRK.B is BRK-B there. Without this the fallback silently
// misses exactly the symbols it exists to cover.
export function mapSymbol(sym: string): string {
  return sym.replace(/\./g, '-');
}

export async function yahooQuote(sym: string, f: Fetcher = fetch): Promise<number | null> {
  sym = mapSymbol(sym);
  for (const host of YF_HOSTS) {
    const price = await withTimeout(5000, async signal => {
      const r = await f(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`,
        { headers: YF_HEADERS, signal });
      if (!r.ok) return null;
      const json = await r.json();
      const p = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return typeof p === 'number' && p > 0 ? p : null;
    });
    if (price !== null) return price;
  }
  return null;
}

// Finnhub first (it is the configured source and honours the user's own key),
// retried once because the failures are transient, then Yahoo. Returns the
// client's existing `{ c }` shape so nothing downstream has to change.
export async function resolveQuote(
  sym: string,
  apiKey: string,
  deps: { finnhub?: typeof finnhubQuote; yahoo?: typeof yahooQuote } = {},
): Promise<Quote> {
  const finnhub = deps.finnhub ?? finnhubQuote;
  const yahoo = deps.yahoo ?? yahooQuote;

  for (let attempt = 0; attempt < 2; attempt++) {
    const price = await finnhub(sym, apiKey);
    if (price !== null) return { c: price };
  }
  const fallback = await yahoo(sym);
  return fallback !== null ? { c: fallback } : null;
}
