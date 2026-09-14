// Run: deno test supabase/functions/sector-holdings/calc_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { calcPct, calcYtd } from './calc.ts';

Deno.test('calcPct: measures from exactly daysBack sessions ago', () => {
  const closes = [100, 105, 110, 121];
  // last=121, daysBack=2 -> idx = 3-2 = 1 -> base=105
  assertEquals(calcPct(closes, 2), (121 - 105) / 105 * 100);
});

Deno.test('calcPct: not enough history returns null instead of a wrong window', () => {
  const closes = [100, 105];
  assertEquals(calcPct(closes, 5), null);
});

Deno.test('calcPct: a zero base returns null instead of Infinity', () => {
  const closes = [0, 105];
  assertEquals(calcPct(closes, 1), null);
});

Deno.test('calcYtd: measures from the last close before the first bar of the year', () => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
  const timestamps = [yearStart - 86400, yearStart + 86400, yearStart + 2 * 86400];
  const closes = [90, 100, 110];
  // ytdIdx=1 (first bar >= yearStart), base = closes[0] = 90
  assertEquals(calcYtd(closes, timestamps), (110 - 90) / 90 * 100);
});

Deno.test('calcYtd: no bar in the current year yet returns null', () => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
  const timestamps = [yearStart - 3 * 86400, yearStart - 2 * 86400];
  const closes = [90, 95];
  assertEquals(calcYtd(closes, timestamps), null);
});

Deno.test('calcYtd: the very first bar available already falls on/after year start', () => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
  const timestamps = [yearStart, yearStart + 86400];
  const closes = [100, 120];
  // ytdIdx=0 -> base falls back to closes[0] itself (no earlier bar to diff against)
  assertEquals(calcYtd(closes, timestamps), (120 - 100) / 100 * 100);
});
