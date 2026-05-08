import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const windowStart = new Date(Date.now() - 60_000).toISOString();
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
  supabase.from('ai_requests').insert({ user_id: user.id }).then(() => {});

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker || !/^[A-Z0-9]{1,10}$/.test(ticker)) {
    return new Response(JSON.stringify({ error: 'Invalid ticker' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('fmp_key')
    .eq('user_id', user.id)
    .single();

  const fmpKey = (settings?.fmp_key && /^[A-Za-z0-9]{10,40}$/.test(settings.fmp_key))
    ? settings.fmp_key
    : (Deno.env.get('FMP_API_KEY') ?? '');

  if (!fmpKey) {
    return new Response(JSON.stringify({ error: 'No FMP API key configured.' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    // 1. Fetch ETF holdings from FMP
    const holdingsRes = await fetch(
      `https://financialmodelingprep.com/stable/etf-holder?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(fmpKey)}`,
      { headers: { 'User-Agent': 'trading-journal/2.0' } }
    );
    if (!holdingsRes.ok) throw new Error(`etf-holder ${holdingsRes.status}`);

    const holdingsData = await holdingsRes.json();
    if (!Array.isArray(holdingsData) || holdingsData.length === 0) {
      return new Response(JSON.stringify({ holdings: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Top 40 by weight, US-exchange symbols only
    const topSymbols: string[] = holdingsData
      .filter((h: Record<string, unknown>) => typeof h.asset === 'string' && /^[A-Z]{1,5}$/.test(h.asset as string))
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        ((b.weightPercentage as number) || 0) - ((a.weightPercentage as number) || 0)
      )
      .slice(0, 40)
      .map((h: Record<string, unknown>) => h.asset as string);

    if (!topSymbols.length) {
      return new Response(JSON.stringify({ holdings: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // 2. Fetch batch quotes from FMP
    const quotesRes = await fetch(
      `https://financialmodelingprep.com/stable/quote?symbol=${topSymbols.join(',')}&apikey=${encodeURIComponent(fmpKey)}`,
      { headers: { 'User-Agent': 'trading-journal/2.0' } }
    );
    if (!quotesRes.ok) throw new Error(`quote ${quotesRes.status}`);

    const quotesData = await quotesRes.json();
    if (!Array.isArray(quotesData)) {
      return new Response(JSON.stringify({ holdings: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Sort by absolute % change, return top 10
    const results = quotesData
      .map((q: Record<string, unknown>) => ({
        symbol: q.symbol as string,
        name:   (q.name as string) || (q.symbol as string),
        pct:    typeof q.changesPercentage === 'number' ? q.changesPercentage as number : null,
      }))
      .filter(r => r.pct !== null)
      .sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!))
      .slice(0, 10);

    return new Response(JSON.stringify({ ticker, holdings: results }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' },
    });
  } catch (e) {
    console.error('[sector-holdings] error:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
