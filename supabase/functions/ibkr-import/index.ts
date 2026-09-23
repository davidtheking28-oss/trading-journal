// Shadow-mode server-side IBKR import (Phase 2 of the IBKR server-import
// migration — see docs/superpowers/specs/2026-09-23-ibkr-server-import-design.md).
// Reads whatever ibkr-cron has already fetched into flex_statement_cache,
// runs the SAME parse+match logic the browser uses (via the shared module),
// and LOGS any discrepancy to flex_import_shadow_log. It never writes to
// `trades` — see the source-level guard test in _shared/flex-import_test.ts
// that fails the build if that ever changes before Phase 4 is approved.
//
// Auth: same shared-secret pattern as ibkr-cron (x-cron-key header checked
// against public.app_secrets('cron_secret')), not a bearer service-role
// token — matches every other cron-triggered function in this project.
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { DOMParser as RealDOMParser } from 'jsr:@b-fuze/deno-dom';
import { flexParseXML, computeShadowDiff } from '../_shared/flex-import.mjs';

// flexParseXML hardcodes the 'text/xml' argument to parseFromString (it's the
// browser's own native DOMParser call, unchanged since this logic was
// extracted into the shared module) — deno-dom rejects that mode outright
// ("unimplemented"), but its 'text/html' mode parses this simple
// attribute-only Flex XML fine and does support querySelectorAll, which
// npm:@xmldom/xmldom (the plan's first guess) doesn't implement at all.
class DenoFlexDOMParser {
  parseFromString(xml: string, _mime: string) {
    return new RealDOMParser().parseFromString(xml, 'text/html');
  }
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

  // stale_since / confirm_stale_since is exactly what flex_fetched_not_imported
  // (data_health_check_core, 2026-09-17) already keys off — an account that
  // goes stale mid-life still shows here even though fetched_at keeps moving,
  // which a naive "imported_at is null" test misses (see CLAUDE.md 2026-09-17).
  const { data: rows, error } = await sb
    .from('flex_statement_cache')
    .select('user_id, xml, xml_confirm, stale_since, confirm_stale_since')
    .or('stale_since.not.is.null,confirm_stale_since.not.is.null');
  if (error) {
    await sb.from('client_errors').insert({
      kind: 'ibkr_import_cache_read', message: error.message, app: 'ibkr-import',
    });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let checked = 0, flagged = 0;
  for (const row of rows ?? []) {
    checked++;
    try {
      const trades = [
        ...(row.xml ? flexParseXML(row.xml, DenoFlexDOMParser) : []),
        ...(row.xml_confirm ? flexParseXML(row.xml_confirm, DenoFlexDOMParser) : []),
      ];
      if (!trades.length) continue;

      const { data: existing, error: exErr } = await sb
        .from('trades')
        .select('*')
        .eq('user_id', row.user_id)
        .eq('deleted', false);
      if (exErr) throw new Error('trades read: ' + exErr.message);

      const plan = await computeShadowDiff(trades, existing ?? []);
      if (plan.imported > 0 || plan.updated > 0) {
        flagged++;
        // One row per account-level diff is enough to trigger a manual look in
        // Phase 3 — refine to per-trade granularity there if this proves too
        // coarse to act on (see the plan's Task 3 note).
        const { error: logErr } = await sb.from('flex_import_shadow_log').upsert({
          user_id: row.user_id,
          ibkr_id: trades[0]?.ibkr_id ?? 'unknown',
          kind: plan.imported > 0 ? 'missing' : 'mismatched',
          expected: plan,
          actual: null,
        }, { onConflict: 'user_id,ibkr_id,kind' });
        if (logErr) throw new Error('shadow log write: ' + logErr.message);
      }
    } catch (e) {
      await sb.from('client_errors').insert({
        kind: 'ibkr_import_parse', message: (e as Error).message,
        app: 'ibkr-import', user_id: row.user_id,
      });
    }
  }

  return new Response(JSON.stringify({ done: true, checked, flagged }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
