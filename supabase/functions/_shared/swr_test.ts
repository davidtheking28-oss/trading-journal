// Guards the stale-while-revalidate contract. The failure this protects against
// is silent: flip a comparison or drop the waitUntil and everything still works,
// it just goes back to paying the cold fetch in the foreground on every visit —
// which is precisely the state this replaced.
//
// Run: deno test supabase/functions/_shared/swr_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { serveCached } from './swr.ts';

const waited: Promise<unknown>[] = [];
(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => waited.push(p) };

function fakeAdmin(refreshedAt: string | null) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: () => Promise.resolve({
          data: refreshedAt ? { payload: { v: 'CACHED' }, refreshed_at: refreshedAt } : null,
        }),
      };
    },
  };
}
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const TTL = 5 * 60_000;
const MAX = 6 * 60 * 60_000;
const fresh = async () => ({ v: 'FRESH' });

Deno.test('a fresh row is served without refreshing at all', async () => {
  let calls = 0;
  const r = await serveCached(fakeAdmin(ago(60_000)), 'k', TTL, MAX, async () => { calls++; return { v: 'FRESH' }; });
  assertEquals(r, { payload: { v: 'CACHED' }, stale: false });
  assertEquals(calls, 0);
});

Deno.test('a stale row is returned immediately and refreshed behind the response', async () => {
  waited.length = 0;
  // The refresh is held open until after serveCached has returned. If the
  // implementation ever awaits it, this test deadlocks rather than passing —
  // which is the only honest way to assert "the caller did not wait".
  let release!: (v: { v: string }) => void;
  const held = new Promise<{ v: string }>((res) => { release = res; });
  let finished = false;

  const r = await serveCached(fakeAdmin(ago(30 * 60_000)), 'k', TTL, MAX, () => held);

  assertEquals(r, { payload: { v: 'CACHED' }, stale: true });
  assertEquals(finished, false);
  assertEquals(waited.length, 1);

  release({ v: 'FRESH' });
  await Promise.all(waited);
  finished = true;
  assertEquals(finished, true);
});

Deno.test('past the staleness bound it blocks on a real fetch', async () => {
  const r = await serveCached(fakeAdmin(ago(9 * 60 * 60_000)), 'k', TTL, MAX, fresh);
  assertEquals(r, { payload: { v: 'FRESH' }, stale: false });
});

Deno.test('a missing row blocks on a real fetch', async () => {
  const r = await serveCached(fakeAdmin(null), 'k', TTL, MAX, fresh);
  assertEquals(r, { payload: { v: 'FRESH' }, stale: false });
});

Deno.test('a background refresh that throws still leaves the caller a payload', async () => {
  waited.length = 0;
  const r = await serveCached(fakeAdmin(ago(30 * 60_000)), 'k', TTL, MAX, async (): Promise<{ v: string } | null> => { throw new Error('upstream down'); });
  assertEquals(r, { payload: { v: 'CACHED' }, stale: true });
  await Promise.all(waited);
});

Deno.test('no row and a failed fetch yields null so the caller can error', async () => {
  const r = await serveCached<{ v: string }>(fakeAdmin(null), 'k', TTL, MAX, async () => null);
  assertEquals(r, { payload: null, stale: false });
});
