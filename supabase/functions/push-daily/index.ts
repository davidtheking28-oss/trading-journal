import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';
const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
async function getVapid() {
  const { data } = await admin.from('app_secrets').select('value').eq('key', 'vapid_keys').maybeSingle();
  if (data?.value) {
    return await webpush.importVapidKeys(JSON.parse(data.value), {
      extractable: false
    });
  }
  const keys = await webpush.generateVapidKeys({
    extractable: true
  });
  const exported = await webpush.exportVapidKeys(keys);
  await admin.from('app_secrets').insert({
    key: 'vapid_keys',
    value: JSON.stringify(exported)
  });
  return keys;
}
function ilDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Jerusalem'
  });
}
const fmt = (n)=>'₪' + Math.round(n).toLocaleString('he-IL');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  const url = new URL(req.url);
  const vapidKeys = await getVapid();
  if (url.searchParams.get('action') === 'vapid') {
    const publicKey = await webpush.exportApplicationServerKey(vapidKeys);
    return new Response(JSON.stringify({
      publicKey
    }), {
      headers: {
        ...CORS,
        'Content-Type': 'application/json'
      }
    });
  }
  const { data: secretRow } = await admin.from('app_secrets').select('value').eq('key', 'push_cron_secret').maybeSingle();
  if (!secretRow || req.headers.get('x-cron-secret') !== secretRow.value) {
    return new Response(JSON.stringify({
      error: 'forbidden'
    }), {
      status: 403,
      headers: CORS
    });
  }
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: 'mailto:davidtheking27@gmail.com',
    vapidKeys
  });
  const { data: subs } = await admin.from('push_subscriptions').select('*');
  if (!subs?.length) return new Response(JSON.stringify({
    sent: 0
  }), {
    headers: CORS
  });
  const { data: households } = await admin.from('households').select('owner_id,member_id');
  const ownerOf = new Map();
  households?.forEach((h)=>{
    if (h.member_id) ownerOf.set(h.member_id, h.owner_id);
  });
  const byUser = new Map();
  subs.forEach((s)=>{
    const arr = byUser.get(s.user_id) || [];
    arr.push(s);
    byUser.set(s.user_id, arr);
  });
  const today = ilDate(0);
  const tomorrow = ilDate(1);
  const ym = today.slice(0, 7);
  const isFirstOfMonth = today.slice(8) === '01';
  let sent = 0;
  for (const [userId, userSubs] of byUser){
    const dataId = ownerOf.get(userId) || userId;
    const { data: bd } = await admin.from('budget_data').select('transactions,budgets,subscriptions,settings').eq('user_id', dataId).maybeSingle();
    if (!bd) continue;
    const tx = bd.transactions || [];
    const prefs = {
      daily: true,
      budget: true,
      renewals: true,
      monthly: true,
      ...userSubs[0].prefs || {}
    };
    const notifications = [];
    if (prefs.daily) {
      const hasToday = tx.some((t)=>t.type === 'expense' && t.date === today);
      if (!hasToday) {
        notifications.push({
          kind: 'daily',
          key: today,
          title: 'תזכורת יומית 📝',
          body: 'עוד לא נרשמו הוצאות היום — 10 שניות וזה מעודכן'
        });
      }
    }
    if (prefs.budget && bd.budgets) {
      const spent = {};
      tx.forEach((t)=>{
        if (t.type === 'expense' && t.date?.startsWith(ym)) spent[t.cat] = (spent[t.cat] || 0) + t.amount;
      });
      for (const [cat, limit] of Object.entries(bd.budgets)){
        if (!limit || !spent[cat]) continue;
        const pct = spent[cat] / limit * 100;
        if (pct >= 100) {
          notifications.push({
            kind: 'budget',
            key: `${ym}:${cat}:100`,
            title: 'חריגה מתקציב ⚠️',
            body: `הוצאת ${fmt(spent[cat])} על ${cat} — מעבר לתקציב של ${fmt(limit)}`
          });
        } else if (pct >= 90) {
          notifications.push({
            kind: 'budget',
            key: `${ym}:${cat}:90`,
            title: 'מתקרבים לתקרה 📊',
            body: `נוצלו ${Math.round(pct)}% מתקציב ${cat} (${fmt(spent[cat])} מתוך ${fmt(limit)})`
          });
        }
      }
    }
    if (prefs.renewals && bd.subscriptions) {
      for (const s of bd.subscriptions){
        if (s.active && s.nextDate === tomorrow) {
          notifications.push({
            kind: 'renew',
            key: `${s.id}:${s.nextDate}`,
            title: 'חידוש מנוי מחר 🔄',
            body: `${s.name} יתחדש מחר ב-${fmt(s.amount)}`
          });
        }
      }
    }
    if (prefs.monthly && isFirstOfMonth) {
      const prev = new Date(new Date(today).getTime() - 86400000);
      const prevYm = prev.toISOString().slice(0, 7);
      const inc = tx.filter((t)=>t.type === 'income' && t.date?.startsWith(prevYm)).reduce((s, t)=>s + t.amount, 0);
      const exp = tx.filter((t)=>t.type === 'expense' && t.date?.startsWith(prevYm)).reduce((s, t)=>s + t.amount, 0);
      const incomeTotal = inc || Number((bd.settings?.incomeSources || []).reduce((s, i)=>s + (parseFloat(i.amount) || 0), 0));
      const bal = incomeTotal - exp;
      notifications.push({
        kind: 'monthly',
        key: prevYm,
        title: 'סיכום החודש 🗓️',
        body: bal >= 0 ? `הוצאות ${fmt(exp)}, נשארו ${fmt(bal)} — כל הכבוד!` : `הוצאות ${fmt(exp)} — חריגה של ${fmt(-bal)} מההכנסות`
      });
    }
    for (const n of notifications){
      const { data: logged } = await admin.from('push_log').insert({
        user_id: userId,
        kind: n.kind,
        key: n.key
      }).select().maybeSingle();
      if (!logged) continue;
      for (const sub of userSubs){
        try {
          const subscriber = appServer.subscribe({
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          });
          await subscriber.pushTextMessage(JSON.stringify({
            title: n.title,
            body: n.body,
            url: './'
          }), {});
          sent++;
        } catch (err) {
          const status = err?.response?.status;
          if (status === 404 || status === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        }
      }
    }
  }
  return new Response(JSON.stringify({
    sent
  }), {
    headers: {
      ...CORS,
      'Content-Type': 'application/json'
    }
  });
});
