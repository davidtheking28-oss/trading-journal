// Shared Bybit compute used by both the live `bybit` function (full-history
// backfill on connect) and `bybit-cron` (recent window, server-side). Fetches
// Linear (USDT perp) executions across 7-day windows (Bybit caps each
// /v5/execution/list call to a 7-day range) and folds them into closed-trade
// objects via FIFO. Each trade carries `bybit_id` = the closing execution's
// execId for stable dedup.
const BYBIT_BASE = 'https://api.bybit.com';
const encoder = new TextEncoder();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function bybitGet(apiKey: string, apiSecret: string, path: string, params: Record<string, string>) {
  const queryString = new URLSearchParams(params).toString();
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signature = await hmacSha256(apiSecret, timestamp + apiKey + recvWindow + queryString);
  const res = await fetch(`${BYBIT_BASE}${path}?${queryString}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });
  return res.json();
}

interface ExecEntry { qty: number; price: number; fee: number; time: number; }
interface OpenPos { side: 'Long' | 'Short'; entries: ExecEntry[]; }

export interface BybitTrade {
  type: 'crypto'; ls: 'L' | 'S'; symbol: string; entryDate: string; closeDate: string;
  entryPrice: number; exitPrice: number; shares: number; commission: number; pnl: number;
  stop: null; t: never[]; bybit_id: string;
}

// Fetch every Linear Trade execution in the last `days`, paging backward in
// 7-day windows (3 cursor pages each). Throws on a Bybit API error.
async function fetchExecutions(apiKey: string, apiSecret: string, days: number): Promise<Record<string, string>[]> {
  const all: Record<string, string>[] = [];
  const now = Date.now();
  const oldest = now - days * 24 * 60 * 60 * 1000;
  for (let winEnd = now; winEnd > oldest; winEnd -= WEEK_MS) {
    const winStart = Math.max(winEnd - WEEK_MS, oldest);
    let cursor = '';
    for (let page = 0; page < 3; page++) {
      const params: Record<string, string> = {
        category: 'linear', limit: '200', execType: 'Trade',
        startTime: String(winStart), endTime: String(winEnd),
      };
      if (cursor) params.cursor = cursor;
      const json = await bybitGet(apiKey, apiSecret, '/v5/execution/list', params);
      if (json.retCode !== 0) throw new Error(json.retMsg || `Bybit error ${json.retCode}`);
      const list: Record<string, string>[] = json.result?.list ?? [];
      all.push(...list);
      cursor = json.result?.nextPageCursor ?? '';
      if (!cursor || list.length < 200) break;
    }
  }
  return all;
}

export async function computeBybitTrades(apiKey: string, apiSecret: string, days: number): Promise<BybitTrade[]> {
  const allExecs = await fetchExecutions(apiKey, apiSecret, days);
  // Sort ascending so we can process FIFO
  allExecs.sort((a, b) => parseInt(a.execTime) - parseInt(b.execTime));

  const openPositions = new Map<string, OpenPos>();
  const trades: BybitTrade[] = [];

  for (const exec of allExecs) {
    const symbol = exec.symbol;
    const side = exec.side;
    const qty = parseFloat(exec.execQty);
    const price = parseFloat(exec.execPrice);
    const fee = parseFloat(exec.execFee || '0');
    const time = parseInt(exec.execTime);
    const closedSize = parseFloat(exec.closedSize || '0');

    if (closedSize === 0) {
      const ls: 'Long' | 'Short' = side === 'Buy' ? 'Long' : 'Short';
      if (!openPositions.has(symbol)) openPositions.set(symbol, { side: ls, entries: [] });
      openPositions.get(symbol)!.entries.push({ qty, price, fee, time });
    } else {
      const pos = openPositions.get(symbol);
      let entryTime: number, avgEntry: number, entryFees: number, ls: 'Long' | 'Short';

      if (pos) {
        ls = pos.side;
        entryTime = pos.entries[0].time;
        const totalQty = pos.entries.reduce((s, e) => s + e.qty, 0);
        avgEntry = pos.entries.reduce((s, e) => s + e.price * e.qty, 0) / totalQty;
        entryFees = pos.entries.reduce((s, e) => s + e.fee, 0);
        const remaining = totalQty - closedSize;
        if (remaining <= 0.0001) openPositions.delete(symbol);
        else pos.entries = [{ qty: remaining, price: avgEntry, fee: 0, time: pos.entries[0].time }];
      } else {
        ls = side === 'Sell' ? 'Long' : 'Short';
        entryTime = time;
        avgEntry = price;
        entryFees = 0;
      }

      const commission = Math.round((entryFees + fee) * 10000) / 10000;
      const ep = Math.round(avgEntry * 100) / 100;
      const xp = Math.round(price * 100) / 100;
      const pnl = ls === 'Long'
        ? Math.round((xp - ep) * closedSize * 100) / 100 - commission
        : Math.round((ep - xp) * closedSize * 100) / 100 - commission;

      trades.push({
        type: 'crypto', ls: ls === 'Long' ? 'L' : 'S',
        symbol: symbol.replace(/USDT$|USD$|BUSD$/, ''),
        entryDate: new Date(entryTime).toISOString().split('T')[0],
        closeDate: new Date(time).toISOString().split('T')[0],
        entryPrice: ep, exitPrice: xp, shares: closedSize, commission, pnl,
        stop: null, t: [], bybit_id: exec.execId,
      });
    }
  }
  return trades;
}
