import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { partitionByAge, pruneMap, type SymCacheMap } from './sym_cache.ts';

const NOW = 1_700_000_000_000;
const TTL = 15 * 60_000;
const MAX = 24 * 60 * 60_000;
const isNum = (v: number) => typeof v === 'number';
const at = (minsAgo: number, r = 1) => ({ r, ts: NOW - minsAgo * 60_000 });

Deno.test('a warm symbol is neither refetched nor refreshed', () => {
  const map: SymCacheMap<number> = { AAPL: at(5) };
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW, isNum),
    { missing: [], stale: [], fresh: ['AAPL'] });
});

Deno.test('a symbol past the TTL is served stale and refreshed in the background', () => {
  const map: SymCacheMap<number> = { AAPL: at(30) };
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW, isNum),
    { missing: [], stale: ['AAPL'], fresh: [] });
});

Deno.test('a symbol past the staleness bound is refetched in the foreground', () => {
  const map: SymCacheMap<number> = { AAPL: at(48 * 60) };
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW, isNum),
    { missing: ['AAPL'], stale: [], fresh: [] });
});

Deno.test('an unknown symbol is missing, not fresh', () => {
  assertEquals(partitionByAge({}, ['NVDA'], TTL, MAX, NOW, isNum),
    { missing: ['NVDA'], stale: [], fresh: [] });
});

Deno.test('a malformed entry is refetched rather than served as a reading', () => {
  // now - undefined is NaN and every comparison against NaN is false, so a
  // naive age test drops these into `fresh` and serves a value that isn't there.
  const map = { AAPL: { r: 1 }, MSFT: { ts: NOW }, GOOG: null } as unknown as SymCacheMap<number>;
  assertEquals(partitionByAge(map, ['AAPL', 'MSFT', 'GOOG'], TTL, MAX, NOW, isNum),
    { missing: ['AAPL', 'MSFT', 'GOOG'], stale: [], fresh: [] });
});

Deno.test('a strict isValid rejects a value the generic default would accept', () => {
  // The default only rejects undefined/null. A garbage string would pass that,
  // so a caller with a real shape in mind (like personal-stem's number) must
  // pass its own isValid - this is what proves that override actually matters.
  const map = { AAPL: { r: 'not-a-number', ts: NOW } } as unknown as SymCacheMap<number>;
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW, isNum).missing, ['AAPL']);
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW).missing, []);
});

Deno.test('one request splits a mixed focus list three ways', () => {
  const map: SymCacheMap<number> = { A: at(1), B: at(30), C: at(48 * 60) };
  assertEquals(partitionByAge(map, ['A', 'B', 'C', 'D'], TTL, MAX, NOW, isNum),
    { missing: ['C', 'D'], stale: ['B'], fresh: ['A'] });
});

Deno.test('a zero return is a real reading, not a falsy miss', () => {
  const map: SymCacheMap<number> = { FLAT: { r: 0, ts: NOW } };
  assertEquals(partitionByAge(map, ['FLAT'], TTL, MAX, NOW, isNum).fresh, ['FLAT']);
});

Deno.test('an array-shaped entry (ohlc candles) is validated by its own predicate', () => {
  const isCandles = (v: number[]) => Array.isArray(v) && v.length > 0;
  const map: SymCacheMap<number[]> = { AAPL: { r: [1, 2, 3], ts: NOW }, EMPTY: { r: [], ts: NOW } };
  assertEquals(partitionByAge(map, ['AAPL', 'EMPTY', 'MSFT'], TTL, MAX, NOW, isCandles),
    { missing: ['EMPTY', 'MSFT'], stale: [], fresh: ['AAPL'] });
});

Deno.test('pruning drops only entries past the bound', () => {
  const map: SymCacheMap<number> = { KEEP: at(60), DROP: at(48 * 60) };
  assertEquals(Object.keys(pruneMap(map, MAX, NOW)), ['KEEP']);
});

Deno.test('pruning survives a malformed entry instead of throwing', () => {
  const map = { OK: at(1), BAD: null } as unknown as SymCacheMap<number>;
  assertEquals(Object.keys(pruneMap(map, MAX, NOW)), ['OK']);
});
