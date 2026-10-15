import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { lastSessionBoundaryMs } from './market_session.ts';

const utc = (s: string) => Date.parse(s + 'Z');

Deno.test('before the open, the boundary is the previous close', () => {
  assertEquals(lastSessionBoundaryMs(utc('2026-10-15T12:49:00')), utc('2026-10-14T20:15:00'));
});

Deno.test('after the open it is the open itself', () => {
  assertEquals(lastSessionBoundaryMs(utc('2026-10-15T17:33:00')), utc('2026-10-15T13:32:00'));
});

Deno.test('the first two minutes after 9:30 ET still count as before the open', () => {
  assertEquals(lastSessionBoundaryMs(utc('2026-10-15T13:31:00')), utc('2026-10-14T20:15:00'));
});

Deno.test('after the close it is the close', () => {
  assertEquals(lastSessionBoundaryMs(utc('2026-10-15T22:00:00')), utc('2026-10-15T20:15:00'));
});

Deno.test('all weekend long it is Friday close', () => {
  assertEquals(lastSessionBoundaryMs(utc('2026-10-17T15:00:00')), utc('2026-10-16T20:15:00'));
  assertEquals(lastSessionBoundaryMs(utc('2026-10-18T23:00:00')), utc('2026-10-16T20:15:00'));
});

Deno.test('Monday before the open still points at Friday close', () => {
  assertEquals(lastSessionBoundaryMs(utc('2026-10-19T11:00:00')), utc('2026-10-16T20:15:00'));
});
