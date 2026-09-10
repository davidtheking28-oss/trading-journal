// Shared Bybit compute used by both the live `bybit` function (full-history
// backfill on connect) and `bybit-cron` (recent window, server-side). Fetches
// Linear (USDT perp) executions across 7-day windows (Bybit caps each
// /v5/execution/list call to a 7-day range) and folds them into closed-trade
// objects via FIFO. Each trade carries `bybit_id` = the closing execution's
// execId for stable dedup.
const BYBIT_BASE = 'https://api.bybit.com';
const encoder = new TextEncoder();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Bybit rejects /v5/execution/list outright when startTime reaches 2 years back
// ("Can't query order earlier than 2 years, please check your params"). 730 days
// IS exactly 2 years, so asking for it always fails — Bybit evaluates the limit
// on its own clock, which is later than ours by at least the request latency.
// Hold the floor a few days inside the limit for every caller.
const MAX_LOOKBACK_MS = 725 * 24 * 60 * 60 * 1000;

// Calendar date in the trader's local (Israel) timezone. This server has no
// per-user timezone, and Date.toISOString() renders in UTC — which silently
// rolls a late-night Israel trade (00:00-02:xx local, still the previous day
// in UTC) back onto the wrong journal day.
const IL_TZ_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
function localDateStr(ms: number): string {
  return IL_TZ_FMT.format(new Date(ms)); // en-CA formats as yyyy-mm-dd
}

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

// A lot still open when the window ends — no exitPrice/closeDate/pnl, since
// none of those exist yet. bybit_id is 'open:'+symbol rather than an
// execution id: unlike a closed trade (immutable once it happens), this
// row's shares/entryPrice legitimately change on every cron run as more
// fills land, so it needs a stable, reconstructable UPDATE key instead of an
// insert-once one. One row per symbol — matches the one-way-mode assumption
// already established for this sync (see bybit_two_year_limit memory note).
export interface BybitOpenPosition {
  type: 'crypto'; ls: 'L' | 'S'; symbol: string; entryDate: string;
  entryPrice: number; shares: number; commission: number; bybit_id: string;
}

// close_date defaults to ''::text on the trades table, not NULL — every
// other open-row path (manual entry, IBKR) leaves it NULL, and
// data_health_check()'s close_before_entry check only excludes NULL, not ''.
// An open row that skips this field takes the '' default, which then sorts
// before entry_date as a string and trips that check as a false positive.
export function openPositionRow(userId: string, p: BybitOpenPosition) {
  return {
    user_id: userId, type: 'crypto', entry_date: p.entryDate, ls: p.ls,
    symbol: p.symbol, entry_price: p.entryPrice, shares: p.shares,
    closed_shares: 0, commission: p.commission, ecn: 0, deleted: false,
    bybit_id: p.bybit_id, close_date: null,
  };
}

// Fetch every Linear Trade execution in the last `days`, paging backward in
// 7-day windows and following the cursor within each window until Bybit
// reports no more pages — no fixed page cap, so a very active window can't
// silently lose executions past an arbitrary limit. Throws on a Bybit API error.
async function fetchExecutions(apiKey: string, apiSecret: string, days: number): Promise<Record<string, string>[]> {
  const all: Record<string, string>[] = [];
  const now = Date.now();
  const oldest = Math.max(now - days * 24 * 60 * 60 * 1000, now - MAX_LOOKBACK_MS);
  for (let winEnd = now; winEnd > oldest; winEnd -= WEEK_MS) {
    const winStart = Math.max(winEnd - WEEK_MS, oldest);
    let cursor = '';
    while (true) {
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

// Total account equity in USD, for the broker-derived portfolio-size feature.
// UNIFIED covers every account type Bybit currently issues; totalEquity is
// already USD-denominated across all held coins.
export async function fetchBybitEquity(apiKey: string, apiSecret: string): Promise<number | null> {
  const json = await bybitGet(apiKey, apiSecret, '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
  if (json.retCode !== 0) return null;
  const eq = parseFloat(json.result?.list?.[0]?.totalEquity ?? '');
  return Number.isFinite(eq) ? eq : null;
}

// Shared FIFO core for both exported functions below — a second exported
// function to also surface open positions must not mean a second network
// fetch or a second copy of this matching logic.
async function _runBybitFifo(apiKey: string, apiSecret: string, days: number):
  Promise<{ trades: BybitTrade[]; openPositions: Map<string, OpenPos> }> {
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
      const opened = qty - closedSize;
      // A flip's execution fee covers both the close and the newly opened
      // leg — split it by quantity so neither side is charged the full fee
      // (the close used to eat 100% of it while the new leg got fee:0).
      const closeFeeShare = opened > 0.0001 ? fee * (closedSize / qty) : fee;
      const openFeeShare = fee - closeFeeShare;

      if (pos) {
        const ls = pos.side;
        const entryTime = pos.entries[0].time;
        const totalQty = pos.entries.reduce((s, e) => s + e.qty, 0);
        const avgEntry = pos.entries.reduce((s, e) => s + e.price * e.qty, 0) / totalQty;
        const totalEntryFees = pos.entries.reduce((s, e) => s + e.fee, 0);
        // Prorate accumulated entry fees by the fraction of the position being
        // closed now, carrying the rest forward — collapsing to fee:0 here
        // used to dump 100% of the entry fee onto the first partial close and
        // leave later partial closes of the same lot with none.
        const entryFeeShare = totalEntryFees * (Math.min(closedSize, totalQty) / totalQty);
        const remaining = totalQty - closedSize;
        if (remaining <= 0.0001) openPositions.delete(symbol);
        else pos.entries = [{ qty: remaining, price: avgEntry, fee: totalEntryFees - entryFeeShare, time: pos.entries[0].time }];

        const commission = Math.round((entryFeeShare + closeFeeShare) * 10000) / 10000;
        const ep = avgEntry;
        const xp = price;
        const gross = ls === 'Long' ? (xp - ep) * closedSize : (ep - xp) * closedSize;
        const pnl = Math.round((gross - commission) * 10000) / 10000;

        trades.push({
          type: 'crypto', ls: ls === 'Long' ? 'L' : 'S',
          symbol: symbol.replace(/USDT$|USD$|BUSD$/, ''),
          entryDate: localDateStr(entryTime),
          closeDate: localDateStr(time),
          entryPrice: ep, exitPrice: xp, shares: closedSize, commission, pnl,
          stop: null, t: [], bybit_id: exec.execId,
        });
      }
      // else: this execution closes a position whose opening leg isn't in
      // the fetched window (e.g. bybit-cron's short lookback vs. a longer
      // swing hold). We have no real entry price to compute P&L from here —
      // skip rather than fabricate entryPrice = exitPrice (silent zero P&L).

      if (opened > 0.0001) {
        const newSide: 'Long' | 'Short' = side === 'Buy' ? 'Long' : 'Short';
        openPositions.set(symbol, { side: newSide, entries: [{ qty: opened, price, fee: openFeeShare, time }] });
      }
    }
  }
  return { trades, openPositions };
}

export async function computeBybitTrades(apiKey: string, apiSecret: string, days: number): Promise<BybitTrade[]> {
  return (await _runBybitFifo(apiKey, apiSecret, days)).trades;
}

// bybit-cron only — computeBybitTrades (the manual "Sync" button's full-
// history backfill) stays closed-trades-only on purpose, see bybit_test.ts's
// header comment and CLAUDE.md.
export async function computeBybitOpen(apiKey: string, apiSecret: string, days: number): Promise<BybitOpenPosition[]> {
  const { openPositions } = await _runBybitFifo(apiKey, apiSecret, days);
  return [...openPositions.entries()].map(([symbol, pos]) => {
    const totalQty = pos.entries.reduce((s, e) => s + e.qty, 0);
    const entryPrice = pos.entries.reduce((s, e) => s + e.price * e.qty, 0) / totalQty;
    const commission = Math.round(pos.entries.reduce((s, e) => s + e.fee, 0) * 10000) / 10000;
    const cleanSymbol = symbol.replace(/USDT$|USD$|BUSD$/, '');
    return {
      type: 'crypto', ls: pos.side === 'Long' ? 'L' : 'S',
      symbol: cleanSymbol,
      entryDate: localDateStr(pos.entries[0].time),
      entryPrice, shares: totalQty, commission,
      bybit_id: 'open:' + cleanSymbol,
    };
  });
}
