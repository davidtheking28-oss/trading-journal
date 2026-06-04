// Scheduled IBKR Flex pre-fetch. Runs server-side (GitHub Actions) once per
// weekday after IBKR's end-of-day batch, fetches each configured user's Flex
// statement, and stores the raw XML in flex_statement_cache. The app imports
// from that cache on login, so it never hits IBKR live at a bad time (1001).
//
// Mirrors the SendRequest -> poll GetStatement flow from
// supabase/functions/ibkr/index.ts. No XML parsing here — the frontend
// (flexParseXML) remains the single source of truth for parsing.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';

// console.log('::error::...') surfaces the message in the run's Annotations.
const fail = msg => { console.log('::error::' + msg); process.exit(1); };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`env: SUPABASE_URL=${SUPABASE_URL ? 'set' : 'MISSING'} SERVICE_KEY=${SERVICE_KEY ? 'set(' + SERVICE_KEY.length + ' chars)' : 'MISSING'}`);
if (!SUPABASE_URL || !SERVICE_KEY) {
  fail('Missing GitHub secret: ' + (!SUPABASE_URL ? 'SUPABASE_URL ' : '') + (!SERVICE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : ''));
}

const IBKR_BASE = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService';
const UA = { 'User-Agent': 'trading-journal/2.0' };
const RETRYABLE = new Set(['1001', '1004', '1005', '1006', '1007', '1008', '1009', '1018', '1019', '1021']);

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };

async function fetchStatement(token, qid) {
  // Step 1: SendRequest — retry temporary errors with backoff
  const SEND_DELAYS = [0, 6000, 12000, 20000];
  let refCode = '', sendCode = '', sendErr = 'unknown';
  for (let i = 0; i < SEND_DELAYS.length; i++) {
    if (SEND_DELAYS[i]) await sleep(SEND_DELAYS[i]);
    const r = await fetch(`${IBKR_BASE}.SendRequest?t=${token}&q=${qid}&v=3`, { headers: UA });
    const xml = await r.text();
    refCode = tag(xml, 'ReferenceCode');
    if (refCode && tag(xml, 'Status') !== 'Fail') break;
    refCode = '';
    sendCode = tag(xml, 'ErrorCode');
    sendErr  = tag(xml, 'ErrorMessage') || 'unknown';
    if (!RETRYABLE.has(sendCode)) throw new Error(`send failed: ${sendErr} [${sendCode}]`);
  }
  if (!refCode) throw new Error(`send failed after retries: ${sendErr} [${sendCode}]`);

  // Step 2: poll GetStatement. This runs server-side in the background where no
  // user is waiting, so give a generous ~12-minute budget — a heavy full-year
  // (365-day) statement for an active account can take several minutes to build.
  const DELAYS = [3000, 5000, 5000, 8000, 8000, 10000, 12000, 15000, 15000, 20000, 20000, 25000, 25000,
                  30000, 30000, 30000, 40000, 40000, 40000, 40000, 45000, 45000, 45000, 45000];
  let getCode = '', getErr = 'unknown';
  for (let i = 0; i < DELAYS.length; i++) {
    await sleep(DELAYS[i]);
    const r = await fetch(`${IBKR_BASE}.GetStatement?t=${token}&q=${encodeURIComponent(refCode)}&v=3`, { headers: UA });
    const xml = await r.text();
    if (tag(xml, 'Status') !== 'Fail') return { xml, refCode };
    getCode = tag(xml, 'ErrorCode');
    getErr  = tag(xml, 'ErrorMessage') || 'unknown';
    if (!RETRYABLE.has(getCode)) throw new Error(`get failed: ${getErr} [${getCode}]`);
  }
  throw new Error(`statement not ready in time: ${getErr} [${getCode}]`);
}

async function main() {
  const { data: rows, error } = await sb
    .from('user_settings')
    .select('user_id, flex_token, flex_query_id')
    .not('flex_token', 'is', null);
  if (error) fail('user_settings query failed: ' + error.message + ' (check the SERVICE_ROLE key is correct)');

  const targets = (rows || []).filter(u =>
    /^[a-zA-Z0-9]{6,64}$/.test(u.flex_token || '') && /^\d{1,15}$/.test(u.flex_query_id || ''));
  console.log(`IBKR sync: ${targets.length} user(s) with valid config`);

  const CONC = 4; // tokens are independent — safe to run a few in parallel
  let ok = 0, fail = 0;
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(async u => {
      const who = u.user_id.slice(0, 8);
      try {
        const { xml, refCode } = await fetchStatement(u.flex_token, u.flex_query_id);
        const { error: upErr } = await sb.from('flex_statement_cache').upsert({
          user_id: u.user_id, xml, ref_code: refCode,
          fetched_at: new Date().toISOString(), imported_at: null,
        });
        if (upErr) throw new Error('cache upsert: ' + upErr.message);
        ok++;
        console.log(`  ✓ ${who} — ${(xml.match(/<Trade /g) || []).length} trade rows`);
      } catch (e) {
        fail++;
        console.log(`  ✗ ${who} — ${e.message}`);
      }
    }));
  }
  console.log(`Done: ${ok} ok, ${fail} failed`);
}

main().catch(e => { console.log('::error::' + (e?.message || e)); process.exit(1); });
