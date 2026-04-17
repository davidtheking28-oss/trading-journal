import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Create client with user's JWT so RLS works correctly
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Rate limit: max 10 requests per minute per user (shared key protection)
  const now = Date.now();
  const windowStart = new Date(now - 60_000).toISOString();
  const { count: recentCount } = await supabase
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', windowStart);

  if ((recentCount ?? 0) >= 10) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
      { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // Log this request (fire and forget)
  supabase.from('ai_requests').insert({ user_id: user.id }).then(() => {});

  const reqUrl  = new URL(req.url);
  const keyType = reqUrl.searchParams.get('key') ?? 'default';

  // Fetch the user's Groq key(s) from user_settings
  const { data: settings } = await supabase
    .from('user_settings')
    .select('groq_api_key, groq_inv_key')
    .eq('user_id', user.id)
    .single();

  // Investment advisor uses groq_inv_key; all others use groq_api_key → shared fallback
  const userKey = keyType === 'inv'
    ? (settings?.groq_inv_key?.startsWith('gsk_') ? settings.groq_inv_key : null)
    : (settings?.groq_api_key?.startsWith('gsk_') ? settings.groq_api_key : null);
  const apiKey = userKey ?? (Deno.env.get('GROQ_API_KEY') ?? '');

  if (!apiKey || !apiKey.startsWith('gsk_')) {
    return new Response(
      JSON.stringify({ error: 'No Groq API key configured.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS });
  }

  const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText, { status: upstream.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
});
