import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://davidtheking28-oss.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SEC  = 'https://data.sec.gov';
const UA   = { 'User-Agent': 'trading-journal/2.0 davidtheking27@gmail.com', 'Accept': 'application/json' };
const JSON_HDRS = { ...CORS, 'Content-Type': 'application/json' };

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HDRS });

  const url    = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase().trim();
  if (!symbol || !/^[A-Z]{1,10}$/.test(symbol)) {
    return new Response(JSON.stringify({ error: 'Invalid symbol' }), { status: 400, headers: JSON_HDRS });
  }

  // 1. Resolve ticker → CIK
  const tickersRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA });
  if (!tickersRes.ok) return new Response(JSON.stringify({ error: 'SEC unavailable' }), { status: 502, headers: JSON_HDRS });

  const tickersData = await tickersRes.json() as Record<string, { cik_str: number; ticker: string; title: string }>;
  const entry = Object.values(tickersData).find(e => e.ticker === symbol);
  if (!entry) return new Response(JSON.stringify({ error: `${symbol} not found in SEC EDGAR` }), { status: 404, headers: JSON_HDRS });

  const cik = String(entry.cik_str).padStart(10, '0');

  // 2. Get latest filing dates from submissions
  const subRes  = await fetch(`${SEC}/submissions/CIK${cik}.json`, { headers: UA });
  const sub     = subRes.ok ? await subRes.json() : null;
  const recent  = sub?.filings?.recent ?? {};
  const forms   = recent.form          ?? [];
  const periods = recent.reportDate    ?? [];
  const fDates  = recent.filingDate    ?? [];
  const accNums = recent.accessionNumber ?? [];
  const items8K = recent.items         ?? [];

  const findLatestIdx = (formType: string) => {
    let bestIdx = -1;
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] === formType && fDates[i]) {
        if (bestIdx === -1 || fDates[i] > fDates[bestIdx]) bestIdx = i;
      }
    }
    return bestIdx;
  };

  const idxQ = findLatestIdx('10-Q');
  const idxK = findLatestIdx('10-K');
  const latest10Q    = idxQ >= 0 ? { period: periods[idxQ], filed: fDates[idxQ] } : null;
  const latest10K    = idxK >= 0 ? { period: periods[idxK], filed: fDates[idxK] } : null;
  const latestFiling = (latest10Q?.period ?? '') > (latest10K?.period ?? '') ? latest10Q : latest10K;
  const latestForm   = (latest10Q?.period ?? '') > (latest10K?.period ?? '') ? '10-Q' : '10-K';

  // 8-K: only earnings press releases (item 2.02 = Results of Operations)
  let latest8K: { filed: string; text: string } | null = null;
  let idx8K = -1;
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '8-K' && fDates[i] && String(items8K[i] ?? '').includes('2.02')) {
      if (idx8K === -1 || fDates[i] > fDates[idx8K]) idx8K = i;
    }
  }
  if (idx8K >= 0 && accNums[idx8K]) {
    try {
      const acc     = accNums[idx8K].replace(/-/g, '');
      const idxUrl  = `https://www.sec.gov/Archives/edgar/data/${entry.cik_str}/${acc}/index.json`;
      const idxRes  = await fetch(idxUrl, { headers: UA });
      if (idxRes.ok) {
        const idxJson = await idxRes.json() as { directory?: { item?: { name: string; type: string }[] } };
        const items   = idxJson.directory?.item ?? [];
        // Only use EX-99.1 (earnings press release) — never fall back to 8-K cover page (XBRL/boilerplate noise)
        const doc = items.find(f => f.type === 'EX-99.1' && /\.(htm|html)$/i.test(f.name))
                 ?? items.find(f => /ex-?99\.?1/i.test(f.name) && /\.(htm|html)$/i.test(f.name));
        if (doc) {
          const docUrl = `https://www.sec.gov/Archives/edgar/data/${entry.cik_str}/${acc}/${doc.name}`;
          const docRes = await fetch(docUrl, { headers: { ...UA, 'Accept': 'text/html' } });
          if (docRes.ok) {
            let raw = await docRes.text();
            // Strip SGML/EDGAR envelope before the actual HTML
            raw = raw.replace(/^[\s\S]*?(<html|<!DOCTYPE)/i, (_, tag) => tag);
            // Strip inline XBRL hidden section (contains raw fact data, not human text)
            raw = raw.replace(/<ix:hidden[^>]*>[\s\S]*?<\/ix:hidden>/gi, '');
            // Strip remaining ix: XBRL tags (keep their text content)
            raw = raw.replace(/<\/?ix:[^>]+>/gi, '');
            const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const bodyHtml  = bodyMatch ? bodyMatch[1] : raw;
            const text = bodyHtml
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/\s{2,}/g, ' ').trim()
              .slice(0, 3000);
            latest8K = { filed: fDates[idx8K], text };
          }
        }
      }
    } catch(e) { console.warn('[edgar] 8-K fetch failed:', e); }
  }

  // 3. Fetch key XBRL concepts in parallel
  const CONCEPTS = [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
    'NetIncomeLoss',
    'ProfitLoss',
    'GrossProfit',
    'OperatingIncomeLoss',
    'CostOfRevenue',
    'Assets',
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'LongTermDebt',
    'LongTermDebtNoncurrent',
    'NetCashProvidedByUsedInOperatingActivities',
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'DepreciationAndAmortization',
    'AssetsCurrent',
    'LiabilitiesCurrent',
  ];

  const conceptResults = await Promise.allSettled(
    CONCEPTS.map(c =>
      fetch(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${c}.json`, { headers: UA })
        .then(r => r.ok ? r.json() : null)
        .then(d => ({ concept: c, units: d?.units?.USD ?? [] }))
    )
  );

  const byName: Record<string, any[]> = {};
  for (const r of conceptResults) {
    if (r.status === 'fulfilled' && r.value) byName[r.value.concept] = r.value.units;
  }

  const getLatest = (concepts: string[], form = latestForm) => {
    for (const c of concepts) {
      const arr = byName[c] ?? [];
      const match = arr
        .filter(d => d.form === form && d.end && d.val != null)
        .sort((a, b) => b.end.localeCompare(a.end))[0];
      if (match) return { concept: c, val: match.val, period: match.end, form: match.form };
    }
    return null;
  };

  const REV_C = ['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','SalesRevenueNet'];
  const NI_C  = ['NetIncomeLoss','ProfitLoss'];

  const revenue    = getLatest(REV_C);
  const netIncome  = getLatest(NI_C);
  const grossProfit = getLatest(['GrossProfit']);
  const opIncome   = getLatest(['OperatingIncomeLoss']);
  const assets     = getLatest(['Assets']);
  const equity     = getLatest(['StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']);
  const ltDebt     = getLatest(['LongTermDebt','LongTermDebtNoncurrent']);
  const opCF       = getLatest(['NetCashProvidedByUsedInOperatingActivities']);
  const capex      = getLatest(['PaymentsToAcquirePropertyPlantAndEquipment']);
  const da         = getLatest(['DepreciationAndAmortization']);
  const currAssets = getLatest(['AssetsCurrent']);
  const currLiab   = getLatest(['LiabilitiesCurrent']);

  // Filter to single-quarter entries only (60–105 days) to exclude YTD cumulative values
  const isQuarterOnly = (d: any) => {
    if (!d.start || !d.end) return false;
    const days = (new Date(d.end).getTime() - new Date(d.start).getTime()) / 86400000;
    return days >= 60 && days <= 105;
  };

  // Revenue TTM (sum of 4 most recent quarters)
  let revenueTTM: number | null = null;
  const revConcept = revenue?.concept ?? REV_C[0];
  const allQ = (byName[revConcept] ?? [])
    .filter(d => d.form === '10-Q' && d.val != null && isQuarterOnly(d))
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 4);
  if (allQ.length === 4) revenueTTM = allQ.reduce((s, d) => s + d.val, 0);

  // Revenue history (last 8 quarters for trend)
  const revenueHistory = (byName[revConcept] ?? [])
    .filter(d => d.form === '10-Q' && d.val != null && isQuarterOnly(d))
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 8)
    .map(d => ({ period: d.end, val: d.val }));

  // Net income history (last 8 quarters)
  const niConcept = netIncome?.concept ?? NI_C[0];
  const netIncomeHistory = (byName[niConcept] ?? [])
    .filter(d => d.form === '10-Q' && d.val != null && isQuarterOnly(d))
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 8)
    .map(d => ({ period: d.end, val: d.val }));

  return new Response(JSON.stringify({
    cik:              entry.cik_str,
    name:             entry.title,
    symbol,
    source:           'SEC EDGAR (direct)',
    latest10Q,
    latest10K,
    latestFiling,
    latestForm,
    latest8K,
    revenue,
    netIncome,
    grossProfit,
    opIncome,
    assets,
    equity,
    ltDebt,
    opCF,
    capex,
    da,
    currAssets,
    currLiab,
    revenueTTM,
    revenueHistory,
    netIncomeHistory,
  }), { status: 200, headers: JSON_HDRS });
});
