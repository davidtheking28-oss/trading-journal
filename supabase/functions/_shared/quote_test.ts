import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { mapSymbol, resolveQuote, yahooHistoricalClose } from './quote.ts';

// The failure this guards is silent: drop the retry or the fallback and the
// endpoint still answers, it just answers `null` for a symbol that has a
// perfectly good price — which the client renders as "no quotes available".

Deno.test('a working Finnhub answer is used as-is, with no fallback call', async () => {
  let yahooCalls = 0;
  const q = await resolveQuote('MD', 'key', {
    finnhub: () => Promise.resolve(26.61),
    yahoo: () => { yahooCalls++; return Promise.resolve(99); },
  });
  assertEquals(q, { c: 26.61 });
  assertEquals(yahooCalls, 0);
});

Deno.test('a transient Finnhub failure is retried before giving up on it', async () => {
  let calls = 0;
  const q = await resolveQuote('MD', 'key', {
    finnhub: () => Promise.resolve(++calls === 1 ? null : 26.61),
    yahoo: () => Promise.resolve(99),
  });
  assertEquals(q, { c: 26.61 });
  assertEquals(calls, 2);
});

Deno.test('Yahoo covers the symbol when Finnhub keeps failing', async () => {
  let finnhubCalls = 0;
  const q = await resolveQuote('MD', 'key', {
    finnhub: () => { finnhubCalls++; return Promise.resolve(null); },
    yahoo: () => Promise.resolve(26.61),
  });
  assertEquals(q, { c: 26.61 });
  // Retried, not hammered — the fallback is what covers a sustained outage.
  assertEquals(finnhubCalls, 2);
});

Deno.test('a share class keeps Yahoo spelling so the fallback can find it', () => {
  assertEquals(mapSymbol('BRK.B'), 'BRK-B');
  assertEquals(mapSymbol('MD'), 'MD');
});

Deno.test('both sources down reports null rather than inventing a price', async () => {
  const q = await resolveQuote('MD', 'key', {
    finnhub: () => Promise.resolve(null),
    yahoo: () => Promise.resolve(null),
  });
  assertEquals(q, null);
});

// yahooHistoricalClose — "what was this month's own close", not a live price.
// Bars are daily, ascending, Aug 27-31 2026 -> closes 10,11,12,13,14.
const DAY_S = 24 * 60 * 60;
function chartFetch(bars: { t: string; c: number }[]): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          chart: {
            result: [{
              timestamp: bars.map(b => Math.floor(new Date(b.t + 'T16:00:00Z').getTime() / 1000)),
              indicators: { quote: [{ close: bars.map(b => b.c) }] },
            }],
          },
        }),
      ),
    )) as typeof fetch;
}
const AUG_BARS = [
  { t: '2026-08-27', c: 10 }, { t: '2026-08-28', c: 11 }, { t: '2026-08-29', c: 12 },
  { t: '2026-08-30', c: 13 }, { t: '2026-08-31', c: 14 },
];

Deno.test('yahooHistoricalClose picks the last bar at or before the target date', async () => {
  const price = await yahooHistoricalClose('AAPL', '2026-08-29', chartFetch(AUG_BARS));
  assertEquals(price, 12);
});

Deno.test('yahooHistoricalClose ignores bars after the target date', async () => {
  // 08-29 has an exact bar (12); 08-30/08-31's later closes must not leak in.
  const price = await yahooHistoricalClose('AAPL', '2026-08-29', chartFetch(AUG_BARS));
  assertEquals(price, 12);
  const dayBefore = await yahooHistoricalClose('AAPL', '2026-08-28', chartFetch(AUG_BARS));
  assertEquals(dayBefore, 11);
});

Deno.test('yahooHistoricalClose returns the newest bar when the target is after all of them', async () => {
  const price = await yahooHistoricalClose('AAPL', '2026-09-15', chartFetch(AUG_BARS));
  assertEquals(price, 14);
});

Deno.test('yahooHistoricalClose returns null when every bar is after the target', async () => {
  const price = await yahooHistoricalClose('AAPL', '2026-08-01', chartFetch(AUG_BARS));
  assertEquals(price, null);
});

Deno.test('yahooHistoricalClose returns null on an unparseable date rather than guessing', async () => {
  const price = await yahooHistoricalClose('AAPL', 'not-a-date', chartFetch(AUG_BARS));
  assertEquals(price, null);
});
