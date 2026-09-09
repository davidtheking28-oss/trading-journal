// Guards the /v5/execution/list lookup window. Bybit rejects the whole call
// when startTime reaches 2 years back, and 730 days IS exactly 2 years — so the
// full-history backfill the `bybit` function asks for died on its very last
// window with "Can't query order earlier than 2 years, please check your params:
// startTime or endTime!", after ~104 successful round-trips. The failure is
// end-of-run and total: every execution already fetched is thrown away with it.
//
// Run: deno test supabase/functions/_shared/bybit_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { computeBybitTrades } from './bybit.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Captures every startTime the window loop asks Bybit for, and answers each
// call with an empty page so the loop runs to completion.
async function collectStartTimes(days: number): Promise<number[]> {
  const seen: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = new URL(String(url));
    seen.push(Number(u.searchParams.get('startTime')));
    return Promise.resolve(
      new Response(JSON.stringify({ retCode: 0, result: { list: [], nextPageCursor: '' } })),
    );
  }) as typeof fetch;
  try {
    await computeBybitTrades('k', 's', days);
  } finally {
    globalThis.fetch = realFetch;
  }
  return seen;
}

Deno.test('a 730-day backfill never asks for a startTime at or past 2 years', async () => {
  const before = Date.now();
  const starts = await collectStartTimes(730);
  assert(starts.length > 100, `expected the loop to page back over ~2 years, got ${starts.length} windows`);

  // Bybit measures the limit on its own clock, which is later than ours by at
  // least the request latency — so landing exactly on the boundary still fails.
  const twoYearsAgo = new Date(before);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const oldest = Math.min(...starts);
  assert(
    oldest > twoYearsAgo.getTime(),
    `oldest startTime ${new Date(oldest).toISOString()} is at/past Bybit's 2-year cutoff ` +
      `${twoYearsAgo.toISOString()} — Bybit rejects the call`,
  );
  assert(
    oldest - twoYearsAgo.getTime() > 2 * DAY_MS,
    'the floor sits within 2 days of the cutoff — too tight to survive clock skew',
  );
});

Deno.test('a short window is left exactly as asked', async () => {
  const before = Date.now();
  const starts = await collectStartTimes(30);
  const oldest = Math.min(...starts);
  // The clamp must only ever bite at the 2-year end, never shorten a cron window.
  assertEquals(Math.round((before - oldest) / DAY_MS), 30);
});
