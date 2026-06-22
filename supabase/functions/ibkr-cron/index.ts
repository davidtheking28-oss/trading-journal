// Server-side IBKR Flex pre-fetch, triggered by pg_cron (via pg_net) instead of
// GitHub Actions, whose scheduled runs are unreliable. Mirrors the SendRequest ->
// poll GetStatement flow in scripts/ibkr-sync.mjs. Fetches each configured user's
// Flex statement and caches the raw XML in flex_statement_cache; the frontend
// imports from that cache on login, so it never hits IBKR live (no error 1001).
//
// Auth: not user-facing. verify_jwt is disabled; the caller must send a shared
// secret in the x-cron-key header that matches public.app_secrets('cron_secret').
// That table is RLS-locked (no policies), so only the service role and pg_cron
// can read the secret — regular users and anon cannot.
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const IBKR_BASE = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService';
const UA = { 'User-Agent': 'trading-journal/2.0' };
const RETRYABLE = new Set(['1001', '1004', '1005', '1006', '1007', '1008', '1009', '1018', '1019', '1021']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = (xml: string, t: string) => {
  const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`));
  return m ? m[1].trim() : '';
};

async function fetchStatement(token: string, qid: string) {
  // Step 1: SendRequest — retry temporary errors (1001 = IBKR busy) with backoff.
  const SEND_DELAYS = [0, 8000, 16000, 24000];
  let refCode = '', sendCode = '', sendErr = 'unknown';
  for (let i = 0; i < SEND_DELAYS.length; i++) {
    if (SEND_DELAYS[i]) await sleep(SEND_DELAYS[i]);
    const r = await fetch(`${IBKR_BASE}.SendRequest?t=${token}&q=${qid}&v=3`, { headers: UA });
    const xml = await r.text();
    refCode = tag(xml, 'ReferenceCode');
    if (refCode && tag(xml, 'Status') !== 'Fail') break;
    refCode = '';
    sendCode = tag(xml, 'ErrorCode');
    sendErr = tag(xml, 'ErrorMessage') || 'unknown';
    if (!RETRYABLE.has(sendCode)) throw new Error(`send failed: ${sendErr} [${sendCode}]`);
  }
  if (!refCode) throw new Error(`send failed after retries: ${sendErr} [${sendCode}]`);

  // Step 2: poll GetStatement. Edge functions are time-bounded, so the budget is
  // tighter than the GitHub script — statements are normally ready within seconds.
  const DELAYS = [3000, 5000, 7000, 10000, 12000, 15000, 18000];
  let getCode = '', getErr = 'unknown';
  for (let i = 0; i < DELAYS.length; i++) {
    await sleep(DELAYS[i]);
    const r = await fetch(`${IBKR_BASE}.GetStatement?t=${token}&q=${encodeURIComponent(refCode)}&v=3`, { headers: UA });
    const xml = await r.text();
    if (tag(xml, 'Status') !== 'Fail') return { xml, refCode };
    getCode = tag(xml, 'ErrorCode');
    getErr = tag(xml, 'ErrorMessage') || 'unknown';
    if (!RETRYABLE.has(getCode)) throw new Error(`get failed: ${getErr} [${getCode}]`);
  }
  throw new Error(`statement not ready in time: ${getErr} [${getCode}]`);
}

async function runSync(sb: ReturnType<typeof createClient>, mode: string) {
  const tok = (t: string) => /^[a-zA-Z0-9]{6,64}$/.test(t || '');
  const qid = (q: string) => /^\d{1,15}$/.test(q || '');

  const { data: rows, error } = await sb
    .from('user_settings')
    .select('user_id, flex_token, flex_query_id, flex_confirm_query_id')
    .not('flex_token', 'is', null);
  if (error) { console.log('user_settings query failed: ' + error.message); return { ok: 0, fail: 0, errs: [] }; }

  // full → Activity query (365-day history); confirm → Trade Confirmation. One
  // statement per invocation bounds the Edge function's runtime; the two cron
  // cadences cover both tracks independently.
  const queryOf = (u: any) => mode === 'confirm' ? u.flex_confirm_query_id : u.flex_query_id;
  const targets = (rows || []).filter((u: any) => tok(u.flex_token) && qid(queryOf(u)));

  // Group users by the IBKR query they pull. A Flex query ID is globally unique
  // in IBKR, so users sharing one are pulling the same account — fetch it ONCE
  // and fan the XML out to all of them. This halves IBKR load and avoids the 1018
  // "too many requests" that double-pulling the same account triggers.
  const groups = new Map<string, any[]>();
  for (const u of targets) {
    const q = queryOf(u);
    const arr = groups.get(q);
    if (arr) arr.push(u); else groups.set(q, [u]);
  }
  console.log(`IBKR sync [${mode}]: ${targets.length} user(s), ${groups.size} unique query(ies)`);

  const rows6 = (xml: string) => (xml.match(/<Trade |<TradeConfirm /g) || []).length;
  const CONC = 4;
  let ok = 0, fail = 0;
  const errs: string[] = [];
  const entries = [...groups.entries()];
  for (let i = 0; i < entries.length; i += CONC) {
    await Promise.all(entries.slice(i, i + CONC).map(async ([q, users]) => {
      const who = users.map((u: any) => u.user_id.slice(0, 8)).join(',');
      try {
        // Try members' tokens until one resolves the statement — they are separate
        // tokens for the same IBKR account, so any valid one returns the same data.
        let xml = '', refCode = '', lastErr: Error | null = null;
        for (const u of users) {
          try { ({ xml, refCode } = await fetchStatement(u.flex_token, q)); break; }
          catch (e) { lastErr = e as Error; }
        }
        if (!xml) throw lastErr ?? new Error('no token resolved the statement');

        const now = new Date().toISOString();
        const patch = mode === 'full'
          ? { xml, ref_code: refCode, fetched_at: now, imported_at: null }
          : { xml_confirm: xml, confirm_fetched_at: now, confirm_imported_at: null };
        for (const u of users) {
          const { error: upErr } = await sb.from('flex_statement_cache').upsert({ user_id: u.user_id, ...patch });
          if (upErr) throw new Error('cache upsert: ' + upErr.message);
        }
        ok += users.length;
        console.log(`  ok ${who} ${mode} (q${q}) — ${rows6(xml)} rows`);
      } catch (e) {
        fail += users.length;
        errs.push(`${who}: ${(e as Error).message}`);
        console.log(`  x ${who} — ${(e as Error).message}`);
      }
    }));
  }
  console.log(`Done [${mode}]: ${ok} ok, ${fail} failed`);
  return { ok, fail, errs };
}

Deno.serve(async (req: Request) => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: secret } = await sb.from('app_secrets').select('value').eq('key', 'cron_secret').single();
  if (!secret || req.headers.get('x-cron-key') !== secret.value) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'confirm' ? 'confirm' : 'full';

  // Run synchronously: the IBKR poll must finish before the response so the work
  // is never cut short. The caller (pg_cron via pg_net) uses a long timeout to
  // keep the connection open until the fetch completes.
  const summary = await runSync(sb, mode);
  return new Response(JSON.stringify({ done: true, mode, ...summary }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
