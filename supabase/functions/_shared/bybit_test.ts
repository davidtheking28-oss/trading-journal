// Guards the /v5/execution/list lookup window. Bybit rejects the whole call
// when startTime reaches 2 years back, and 730 days IS exactly 2 years — so the
// full-history backfill the `bybit` function asks for died on its very last
// window with "Can't query order earlier than 2 years, please check your params:
// startTime or endTime!", after ~104 successful round-trips. The failure is
// end-of-run and total: every execution already fetched is thrown away with it.
//
// Run: deno test supabase/functions/_shared/bybit_test.ts
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { computeBybitTrades, computeBybitOpen, computeBybitSync, openPositionRow } from './bybit.ts';

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

// computeBybitOpen — the currently-open lot per symbol, which computeBybitTrades
// (closed trades only) had been silently discarding. `days:5` keeps every
// execution inside fetchExecutions' single most-recent 7-day window, so one
// stubbed page is the whole answer — no pagination to simulate here.
const HOUR_MS = 60 * 60 * 1000;
function exec(overrides: Record<string, string>): Record<string, string> {
  return {
    symbol: 'BTCUSDT', side: 'Buy', execQty: '1', execPrice: '70000',
    execFee: '0.5', execTime: String(Date.now() - HOUR_MS), closedSize: '0',
    execId: 'e' + Math.random(),
    ...overrides,
  };
}
async function withExecs<T>(execs: Record<string, string>[], fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  let answered = false;
  globalThis.fetch = ((url: string | URL | Request) => {
    const body = !answered ? { retCode: 0, result: { list: execs, nextPageCursor: '' } }
                           : { retCode: 0, result: { list: [], nextPageCursor: '' } };
    answered = true;
    return Promise.resolve(new Response(JSON.stringify(body)));
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test('a lone open lot is surfaced with the right entry/qty, not discarded', async () => {
  const open = await withExecs(
    [exec({ execQty: '2', execPrice: '70000' })],
    () => computeBybitOpen('k', 's', 5),
  );
  assertEquals(open.length, 1);
  assertEquals(open[0].symbol, 'BTC');
  assertEquals(open[0].ls, 'L');
  assertEquals(open[0].shares, 2);
  assertEquals(open[0].entryPrice, 70000);
  assertEquals(open[0].bybit_id, 'open:BTC');
});

Deno.test('two fills average-weight into one open entry', async () => {
  const open = await withExecs(
    [
      exec({ execTime: String(Date.now() - 2 * HOUR_MS), execQty: '1', execPrice: '70000' }),
      exec({ execTime: String(Date.now() - HOUR_MS), execQty: '3', execPrice: '74000' }),
    ],
    () => computeBybitOpen('k', 's', 5),
  );
  assertEquals(open.length, 1);
  assertEquals(open[0].shares, 4);
  // (1*70000 + 3*74000) / 4 = 73000
  assertEquals(open[0].entryPrice, 73000);
});

Deno.test('a partial close leaves the correct remainder as the open row', async () => {
  const open = await withExecs(
    [
      exec({ execTime: String(Date.now() - 2 * HOUR_MS), execQty: '4', execPrice: '70000' }),
      exec({ execTime: String(Date.now() - HOUR_MS), side: 'Sell', execQty: '1', execPrice: '75000', closedSize: '1' }),
    ],
    () => computeBybitOpen('k', 's', 5),
  );
  assertEquals(open.length, 1);
  assertEquals(open[0].shares, 3);
  assertEquals(open[0].entryPrice, 70000);
});

Deno.test('a fully closed position leaves no open row', async () => {
  const open = await withExecs(
    [
      exec({ execTime: String(Date.now() - 2 * HOUR_MS), execQty: '1', execPrice: '70000' }),
      exec({ execTime: String(Date.now() - HOUR_MS), side: 'Sell', execQty: '1', execPrice: '75000', closedSize: '1' }),
    ],
    () => computeBybitOpen('k', 's', 5),
  );
  assertEquals(open.length, 0);
});

Deno.test('computeBybitTrades on the same data still returns only the closed leg', async () => {
  const trades = await withExecs(
    [
      exec({ execTime: String(Date.now() - 2 * HOUR_MS), execQty: '4', execPrice: '70000' }),
      exec({ execTime: String(Date.now() - HOUR_MS), side: 'Sell', execQty: '1', execPrice: '75000', closedSize: '1' }),
    ],
    () => computeBybitTrades('k', 's', 5),
  );
  assertEquals(trades.length, 1);
  assertEquals(trades[0].shares, 1);
  assertEquals(trades[0].bybit_id.startsWith('open:'), false);
});

Deno.test('openPositionRow sets close_date to null, not the table default', () => {
  const row = openPositionRow('u1', {
    type: 'crypto', ls: 'L', symbol: 'ETH', entryDate: '2026-09-09',
    entryPrice: 4000, shares: 0.22, commission: 0, bybit_id: 'open:ETH',
  });
  assertEquals(row.close_date, null);
});

Deno.test('execution pagination follows a cursor even after a short page', async () => {
  const realFetch = globalThis.fetch;
  const cursors: string[] = [];
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = new URL(String(url));
    assertEquals(u.searchParams.get('limit'), '100');
    const cursor = u.searchParams.get('cursor') || '';
    cursors.push(cursor);
    return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: {
      list: [exec({ execId: cursor ? 'second' : 'first' })], nextPageCursor: cursor ? '' : 'page-two',
    } })));
  }) as typeof fetch;
  try {
    const rows = await computeBybitOpen('k', 's', 5);
    assertEquals(rows[0].shares, 2);
    assertEquals(cursors, ['', 'page-two']);
  } finally { globalThis.fetch = realFetch; }
});

Deno.test('repeated executions do not double quantities or fees', async () => {
  const fill = exec({ execId: 'same-fill', execQty: '2', execFee: '1' });
  const rows = await withExecs([fill, fill], () => computeBybitOpen('k', 's', 5));
  assertEquals(rows[0].shares, 2);
  assertEquals(rows[0].commission, 1);
});

Deno.test('a malformed successful payload fails rather than appearing empty', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ retCode: 0 })))) as typeof fetch;
  try { await assertRejects(() => computeBybitOpen('k', 's', 5), Error, 'execution response'); }
  finally { globalThis.fetch = realFetch; }
});

Deno.test('cron extends its history for a position opened before the recent window', async () => {
  const realFetch = globalThis.fetch;
  const fill = exec({ execId: 'old-open', execTime: String(Date.now() - 70 * DAY_MS) });
  let historyCalls = 0;
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = new URL(String(url));
    let list: unknown[];
    if (u.pathname === '/v5/position/list') {
      list = [{ symbol: 'BTCUSDT', size: '1', side: 'Buy', positionIdx: 0 }];
    } else {
      historyCalls++;
      const start = Number(u.searchParams.get('startTime')), end = Number(u.searchParams.get('endTime'));
      list = Number(fill.execTime) >= start && Number(fill.execTime) <= end ? [fill] : [];
    }
    return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list, nextPageCursor: '' } })));
  }) as typeof fetch;
  try {
    const result = await computeBybitSync('k', 's', 45);
    assertEquals(result.open.length, 1);
    assertEquals(result.open[0].shares, 1);
    assert(historyCalls > 100);
  } finally { globalThis.fetch = realFetch; }
});

Deno.test('cron refuses an unreconciled open position instead of returning an empty list', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: {
    list: new URL(String(url)).pathname === '/v5/position/list' ? [{ symbol: 'BTCUSDT', size: '1', side: 'Buy', positionIdx: 0 }] : [], nextPageCursor: '',
  } })))) as typeof fetch;
  try { await assertRejects(() => computeBybitSync('k', 's', 45), Error, 'could not be reconciled'); }
  finally { globalThis.fetch = realFetch; }
});

Deno.test('repeating pagination cursors fail instead of looping forever', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: [], nextPageCursor: 'same' } })))) as typeof fetch;
  try { await assertRejects(() => computeBybitOpen('k', 's', 5), Error, 'repeated cursor'); }
  finally { globalThis.fetch = realFetch; }
});

Deno.test('HTTP errors are not interpreted as a successful empty account', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: 503 }))) as typeof fetch;
  try { await assertRejects(() => computeBybitOpen('k', 's', 5), Error, 'HTTP 503'); }
  finally { globalThis.fetch = realFetch; }
});

Deno.test('partial closes prorate entry fees without losing the remaining fees', async () => {
  const rows = await withExecs([
    exec({ execId: 'entry', execTime: String(Date.now() - 3 * HOUR_MS), execQty: '4', execFee: '4' }),
    exec({ execId: 'close-1', execTime: String(Date.now() - 2 * HOUR_MS), side: 'Sell', execQty: '1', closedSize: '1', execPrice: '75000', execFee: '1' }),
    exec({ execId: 'close-2', side: 'Sell', execQty: '3', closedSize: '3', execPrice: '76000', execFee: '3' }),
  ], () => computeBybitTrades('k', 's', 5));
  assertEquals(rows.map(r => r.commission), [2, 6]);
  assertEquals(rows.map(r => r.pnl), [4998, 17994]);
});

Deno.test('a recent orphan close cannot be reported as a successful cron sync', async () => {
  const realFetch = globalThis.fetch;
  const fill = exec({ execId: 'orphan', side: 'Sell', closedSize: '1' });
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = new URL(String(url));
    const inWindow = u.pathname === '/v5/execution/list' && Number(fill.execTime) >= Number(u.searchParams.get('startTime')) && Number(fill.execTime) <= Number(u.searchParams.get('endTime'));
    return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: inWindow ? [fill] : [], nextPageCursor: '' } })));
  }) as typeof fetch;
  try { await assertRejects(() => computeBybitSync('k', 's', 45), Error, 'missing its entry history'); }
  finally { globalThis.fetch = realFetch; }
});

Deno.test('a small partial position is retained instead of rounded to fully closed', async () => {
  const rows = await withExecs([
    exec({ execId: 'small-entry', execTime: String(Date.now() - 2 * HOUR_MS), execQty: '0.0002' }),
    exec({ execId: 'small-close', side: 'Sell', execQty: '0.00015', closedSize: '0.00015' }),
  ], () => computeBybitOpen('k', 's', 5));
  assertEquals(rows.length, 1);
  assert(Math.abs(rows[0].shares - 0.00005) < 1e-12);
});

Deno.test('a small reversal keeps its new position and fee allocation', async () => {
  const rows = await withExecs([
    exec({ execId: 'flip-entry', execTime: String(Date.now() - 2 * HOUR_MS), execQty: '0.0001', execFee: '0' }),
    exec({ execId: 'flip-close', side: 'Sell', execQty: '0.00015', closedSize: '0.0001', execFee: '0.03' }),
  ], () => computeBybitOpen('k', 's', 5));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].ls, 'S');
  assert(Math.abs(rows[0].shares - 0.00005) < 1e-12);
  assertEquals(rows[0].commission, 0.01);
});
