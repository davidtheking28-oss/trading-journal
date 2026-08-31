import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { mapSymbol, resolveQuote } from './quote.ts';

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
