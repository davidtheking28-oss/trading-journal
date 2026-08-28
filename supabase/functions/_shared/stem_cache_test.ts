import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { partitionByAge, pruneMap, type StemMap } from './stem_cache.ts';

const NOW = 1_700_000_000_000;
const TTL = 15 * 60_000;
const MAX = 24 * 60 * 60_000;
const at = (minsAgo: number, r = 1) => ({ r, ts: NOW - minsAgo * 60_000 });

Deno.test('a warm symbol is neither refetched nor refreshed', () => {
  const map: StemMap = { AAPL: at(5) };
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW),
    { missing: [], stale: [], fresh: ['AAPL'] });
});

Deno.test('a symbol past the TTL is served stale and refreshed in the background', () => {
  const map: StemMap = { AAPL: at(30) };
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW),
    { missing: [], stale: ['AAPL'], fresh: [] });
});

Deno.test('a symbol past the staleness bound is refetched in the foreground', () => {
  const map: StemMap = { AAPL: at(48 * 60) };
  assertEquals(partitionByAge(map, ['AAPL'], TTL, MAX, NOW),
    { missing: ['AAPL'], stale: [], fresh: [] });
});

Deno.test('an unknown symbol is missing, not fresh', () => {
  assertEquals(partitionByAge({}, ['NVDA'], TTL, MAX, NOW),
    { missing: ['NVDA'], stale: [], fresh: [] });
});

Deno.test('a malformed entry is refetched rather than served as a reading', () => {
  // now - undefined is NaN and every comparison against NaN is false, so a
  // naive age test drops these into `fresh` and serves a value that isn't there.
  const map = { AAPL: { r: 1 }, MSFT: { ts: NOW }, GOOG: null } as unknown as StemMap;
  assertEquals(partitionByAge(map, ['AAPL', 'MSFT', 'GOOG'], TTL, MAX, NOW),
    { missing: ['AAPL', 'MSFT', 'GOOG'], stale: [], fresh: [] });
});

Deno.test('one request splits a mixed focus list three ways', () => {
  const map: StemMap = { A: at(1), B: at(30), C: at(48 * 60) };
  assertEquals(partitionByAge(map, ['A', 'B', 'C', 'D'], TTL, MAX, NOW),
    { missing: ['C', 'D'], stale: ['B'], fresh: ['A'] });
});

Deno.test('a zero return is a real reading, not a falsy miss', () => {
  const map: StemMap = { FLAT: { r: 0, ts: NOW } };
  assertEquals(partitionByAge(map, ['FLAT'], TTL, MAX, NOW).fresh, ['FLAT']);
});

Deno.test('pruning drops only entries past the bound', () => {
  const map: StemMap = { KEEP: at(60), DROP: at(48 * 60) };
  assertEquals(Object.keys(pruneMap(map, MAX, NOW)), ['KEEP']);
});

Deno.test('pruning survives a malformed entry instead of throwing', () => {
  const map = { OK: at(1), BAD: null } as unknown as StemMap;
  assertEquals(Object.keys(pruneMap(map, MAX, NOW)), ['OK']);
});
