// Telegram alert when an investment reaches its stop (8% under entry). Run by
// pg_cron every 10 minutes through the US session. Only the owner's holdings are
// checked, because telegram_chat_id is the owner's chat. Each symbol messages
// once and is re-armed when its price is back above the stop (stop_alert_state).
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { yahooQuote } from '../_shared/quote.ts';
import { buildStopMessage, planStopAlerts } from '../_shared/stop_alert.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: secrets } = await sb.from('app_secrets').select('key,value')
    .in('key', ['cron_secret', 'telegram_bot_token', 'telegram_chat_id', 'telegram_owner_user_id']);
  const sec = Object.fromEntries((secrets ?? []).map(r => [r.key, r.value]));
  if (!sec.cron_secret || req.headers.get('x-cron-key') !== sec.cron_secret) return json({ error: 'unauthorized' }, 401);
  if (!sec.telegram_bot_token || !sec.telegram_chat_id || !sec.telegram_owner_user_id) return json({ sent: 0, reason: 'telegram not configured' });
  const owner = sec.telegram_owner_user_id;

  const { data: holdings } = await sb.from('investment_holdings')
    .select('symbol,entry_price').eq('user_id', owner).gt('entry_price', 0);
  const rows = (holdings ?? []).map(h => ({ symbol: String(h.symbol).trim().toUpperCase(), entry_price: Number(h.entry_price) }))
    .filter(h => h.symbol);
  if (!rows.length) return json({ checked: 0 });

  const symbols = [...new Set(rows.map(h => h.symbol))];
  const prices = new Map<string, number>();
  await Promise.all(symbols.map(async s => { const p = await yahooQuote(s); if (p !== null) prices.set(s, p); }));

  const { data: st } = await sb.from('stop_alert_state').select('symbol').eq('user_id', owner);
  const alerted = new Set((st ?? []).map(r => r.symbol as string));
  const { fire, rearm } = planStopAlerts(rows, prices, alerted);

  if (rearm.length) await sb.from('stop_alert_state').delete().eq('user_id', owner).in('symbol', rearm);
  if (!fire.length) return json({ checked: symbols.length, quoted: prices.size, fired: 0, rearmed: rearm.length });

  const r = await fetch(`https://api.telegram.org/bot${sec.telegram_bot_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: sec.telegram_chat_id, text: buildStopMessage(fire) }),
  });
  if (!r.ok) return json({ fired: 0, error: 'telegram ' + r.status }, 502);
  await sb.from('stop_alert_state').upsert(fire.map(f => ({ user_id: owner, symbol: f.symbol })));
  return json({ checked: symbols.length, quoted: prices.size, fired: fire.length, rearmed: rearm.length });
});
