// Daily IBKR sync health alert. Triggered once a day by pg_cron (via pg_net),
// after the daily full run. Flags any user who had sync runs in the last 26h but
// NOT a single success — i.e. their broker sync is stuck — and sends one Telegram
// message listing them. No-ops quietly if there's nothing to report or if the
// Telegram credentials aren't configured yet.
//
// Auth: same shared secret as ibkr-cron (x-cron-key vs app_secrets.cron_secret).
// Telegram bot token + chat id also live in app_secrets (RLS-locked), so no Edge
// function secrets need to be set out of band.
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const STUCK_WINDOW_H = 26; // a daily-refreshed track is stuck if no success in ~a day

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

  const since = new Date(Date.now() - STUCK_WINDOW_H * 3600 * 1000).toISOString();
  const { data: logs } = await sb
    .from('flex_sync_log')
    .select('user_id, status, error_msg, run_at')
    .gte('run_at', since);

  type G = { ok: number; fail: number; lastErr: string | null; lastErrAt: number };
  const byUser = new Map<string, G>();
  for (const r of logs ?? []) {
    const g = byUser.get(r.user_id) ?? { ok: 0, fail: 0, lastErr: null, lastErrAt: 0 };
    if (r.status === 'ok') g.ok++;
    else {
      g.fail++;
      const t = new Date(r.run_at).getTime();
      if (t > g.lastErrAt) { g.lastErrAt = t; g.lastErr = r.error_msg; }
    }
    byUser.set(r.user_id, g);
  }
  const stuck = [...byUser.entries()].filter(([, g]) => g.ok === 0 && g.fail > 0);
  if (!stuck.length) return new Response(JSON.stringify({ stuck: 0 }), { headers: { 'Content-Type': 'application/json' } });

  const tok = (await sb.from('app_secrets').select('value').eq('key', 'telegram_bot_token').single()).data;
  const chat = (await sb.from('app_secrets').select('value').eq('key', 'telegram_chat_id').single()).data;
  if (!tok || !chat) {
    console.log(`telegram not configured; ${stuck.length} user(s) stuck`);
    return new Response(JSON.stringify({ stuck: stuck.length, sent: false }), { headers: { 'Content-Type': 'application/json' } });
  }

  const lines: string[] = [];
  for (const [uid, g] of stuck) {
    let email = uid.slice(0, 8);
    try { email = (await sb.auth.admin.getUserById(uid)).data.user?.email ?? email; } catch (_) { /* keep id prefix */ }
    lines.push(`• ${email} — ${g.fail} fail(s), last: ${g.lastErr ?? 'unknown'}`);
  }
  const text = `⚠️ IBKR sync stuck (no success in ${STUCK_WINDOW_H}h):\n${lines.join('\n')}`;

  const r = await fetch(`https://api.telegram.org/bot${tok.value}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat.value, text, disable_web_page_preview: true }),
  });
  const sent = r.ok;
  if (!sent) console.log('telegram send failed: ' + (await r.text()));
  return new Response(JSON.stringify({ stuck: stuck.length, sent }), { headers: { 'Content-Type': 'application/json' } });
});
