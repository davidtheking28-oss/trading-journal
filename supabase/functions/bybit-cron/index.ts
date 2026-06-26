// Server-side Bybit sync, triggered by pg_cron (via pg_net) so trades import even
// when the app is closed — parity with ibkr-cron. Computes closed trades from the
// recent execution window and inserts only new ones (dedup by the closing execId),
// never overwriting a user's manual edits.
//
// Auth: same shared secret as ibkr-cron (x-cron-key vs app_secrets.cron_secret).
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { computeBybitTrades } from '../_shared/bybit.ts';

const RECENT_DAYS = 9; // a couple of 7-day windows — plenty for a 30-min cadence

Deno.serve(async (req: Request) => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const secret = (await sb.from('app_secrets').select('value').eq('key', 'cron_secret').single()).data;
  if (!secret || req.headers.get('x-cron-key') !== secret.value) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { data: rows } = await sb
    .from('user_settings')
    .select('user_id, bybit_api_key, bybit_api_secret')
    .not('bybit_api_key', 'is', null);
  const targets = (rows ?? []).filter((u: any) => u.bybit_api_key && u.bybit_api_secret);

  const CONC = 4;
  let ok = 0, fail = 0;
  const errs: string[] = [];
  const logRows: any[] = [];
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(async (u: any) => {
      const who = u.user_id.slice(0, 8);
      try {
        const trades = await computeBybitTrades(u.bybit_api_key, u.bybit_api_secret, RECENT_DAYS);
        if (trades.length) {
          const tradeRows = trades.map((t) => ({
            user_id: u.user_id, type: 'crypto', entry_date: t.entryDate, ls: t.ls,
            symbol: t.symbol, entry_price: t.entryPrice, shares: t.shares, stop: t.stop,
            targets: t.t, close_date: t.closeDate, closed_shares: null, exit_price: t.exitPrice,
            ecn: 0, commission: t.commission, deleted: false, bybit_id: t.bybit_id,
          }));
          // Insert-if-absent on the closing execId: never overwrites manual edits,
          // never resurrects deleted trades (their bybit_id row already exists).
          const { error: upErr } = await sb.from('trades').upsert(tradeRows, { onConflict: 'user_id,bybit_id', ignoreDuplicates: true });
          if (upErr) throw new Error('trades upsert: ' + upErr.message);
        }
        ok++;
        logRows.push({ user_id: u.user_id, broker: 'bybit', mode: 'sync', status: 'ok' });
        console.log(`  ok ${who} bybit — ${trades.length} trades`);
      } catch (e) {
        fail++;
        const msg = (e as Error).message;
        const code = (msg.match(/\[(\d+)\]/) || [])[1] ?? null;
        logRows.push({ user_id: u.user_id, broker: 'bybit', mode: 'sync', status: 'fail', error_code: code, error_msg: msg });
        errs.push(`${who}: ${msg}`);
        console.log(`  x ${who} — ${msg}`);
      }
    }));
  }
  if (logRows.length) {
    const { error: lErr } = await sb.from('flex_sync_log').insert(logRows);
    if (lErr) console.log('sync log insert failed: ' + lErr.message);
  }
  console.log(`Done [bybit]: ${ok} ok, ${fail} failed`);
  return new Response(JSON.stringify({ done: true, ok, fail, errs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
