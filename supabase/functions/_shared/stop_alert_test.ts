import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { isStopHit, planStopAlerts, stopPrice } from './stop_alert.ts';

Deno.test('the stop is 8% under the entry price', () => {
  assertEquals(stopPrice(100), 92);
});

Deno.test('no entry price means no stop, never a hit', () => {
  assertEquals(stopPrice(0), null);
  assertEquals(stopPrice(null), null);
  assertEquals(isStopHit(1, 0), false);
});

Deno.test('a price exactly at the stop counts, one cent above does not', () => {
  assertEquals(isStopHit(92, 100), true);
  assertEquals(isStopHit(92.01, 100), false);
  assertEquals(isStopHit(50, 100), true);
});

Deno.test('a missing or zero quote is not a hit', () => {
  assertEquals(isStopHit(0, 100), false);
  assertEquals(isStopHit(null, 100), false);
});

Deno.test('a symbol at the stop fires once, and stays quiet while already alerted', () => {
  const h = [{ symbol: 'AAA', entry_price: 100 }];
  const p = new Map([['AAA', 90]]);
  assertEquals(planStopAlerts(h, p, new Set()).fire.map(f => f.symbol), ['AAA']);
  assertEquals(planStopAlerts(h, p, new Set(['AAA'])).fire, []);
});

Deno.test('recovery above the stop re-arms the symbol', () => {
  const h = [{ symbol: 'AAA', entry_price: 100 }];
  assertEquals(planStopAlerts(h, new Map([['AAA', 95]]), new Set(['AAA'])).rearm, ['AAA']);
});

Deno.test('a failed quote neither fires nor re-arms', () => {
  const h = [{ symbol: 'AAA', entry_price: 100 }];
  const r = planStopAlerts(h, new Map(), new Set(['AAA']));
  assertEquals(r.fire, []);
  assertEquals(r.rearm, []);
});

Deno.test('two lots of one symbol: the higher stop decides, one message', () => {
  const h = [{ symbol: 'AAA', entry_price: 100 }, { symbol: 'AAA', entry_price: 80 }];
  const r = planStopAlerts(h, new Map([['AAA', 90]]), new Set());
  assertEquals(r.fire.length, 1);
  assertEquals(r.fire[0].stop, 92);
});
