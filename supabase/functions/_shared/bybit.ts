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
    signal: AbortSignal.timeout(20000),
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
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
  const seenExecutions = new Set<string>();
  const now = Date.now();
  const oldest = Math.max(now - days * 24 * 60 * 60 * 1000, now - MAX_LOOKBACK_MS);
  for (let winEnd = now; winEnd > oldest; winEnd -= WEEK_MS) {
    const winStart = Math.max(winEnd - WEEK_MS, oldest);
    let cursor = '';
    const seenCursors = new Set<string>();
    while (true) {
      const params: Record<string, string> = {
        category: 'linear', limit: '100', execType: 'Trade',
        startTime: String(winStart), endTime: String(winEnd),
      };
      if (cursor) params.cursor = cursor;
      const json = await bybitGet(apiKey, apiSecret, '/v5/execution/list', params);
      if (json.retCode !== 0) throw new Error(json.retMsg || `Bybit error ${json.retCode}`);
      if (!Array.isArray(json.result?.list)) throw new Error('Invalid Bybit execution response');
      const list: Record<string, string>[] = json.result.list;
      for (const execution of list) {
        if (!execution.execId) throw new Error('Invalid Bybit execution response: missing execution ID');
        if (seenExecutions.has(execution.execId)) continue;
        seenExecutions.add(execution.execId);
        all.push(execution);
      }
      cursor = json.result?.nextPageCursor ?? '';
      if (!cursor) break;
      if (typeof cursor !== 'string' || seenCursors.has(cursor)) throw new Error('Invalid Bybit execution response: repeated cursor');
      seenCursors.add(cursor);
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
  Promise<{ trades: BybitTrade[]; openPositions: Map<string, OpenPos>; incomplete: boolean; latestIncomplete: number }> {
  const allExecs = await fetchExecutions(apiKey, apiSecret, days);
  // Sort ascending so we can process FIFO
  allExecs.sort((a, b) => parseInt(a.execTime) - parseInt(b.execTime));

  const openPositions = new Map<string, OpenPos>();
  const trades: BybitTrade[] = [];
  let incomplete = false;
  let latestIncomplete = 0;

  for (const exec of allExecs) {
    const symbol = exec.symbol;
    const side = exec.side;
    const qty = parseFloat(exec.execQty);
    const price = parseFloat(exec.execPrice);
    const fee = parseFloat(exec.execFee || '0');
    const time = parseInt(exec.execTime);
    const closedSize = parseFloat(exec.closedSize || '0');
    if (!symbol.endsWith('USDT') || !['Buy', 'Sell'].includes(side) ||
      ![qty, price, fee, time, closedSize].every(Number.isFinite) || qty <= 0 || price <= 0 ||
      closedSize < 0 || closedSize > qty) throw new Error('Unsupported or invalid Bybit execution');

    if (closedSize === 0) {
      const ls: 'Long' | 'Short' = side === 'Buy' ? 'Long' : 'Short';
      if (openPositions.has(symbol) && openPositions.get(symbol)!.side !== ls) {
        throw new Error('Bybit hedge mode is not supported; use one-way USDT positions');
      }
      if (!openPositions.has(symbol)) openPositions.set(symbol, { side: ls, entries: [] });
      openPositions.get(symbol)!.entries.push({ qty, price, fee, time });
    } else {
      const pos = openPositions.get(symbol);
      const opened = qty - closedSize;
      const qtyTolerance = Math.max(1e-12, qty * 1e-9);
      // A flip's execution fee covers both the close and the newly opened
      // leg — split it by quantity so neither side is charged the full fee
      // (the close used to eat 100% of it while the new leg got fee:0).
      const closeFeeShare = opened > qtyTolerance ? fee * (closedSize / qty) : fee;
      const openFeeShare = fee - closeFeeShare;

      if (pos) {
        const ls = pos.side;
        if ((ls === 'Long' && side !== 'Sell') || (ls === 'Short' && side !== 'Buy')) {
          throw new Error('Bybit hedge mode is not supported; use one-way USDT positions');
        }
        const entryTime = pos.entries[0].time;
        const totalQty = pos.entries.reduce((s, e) => s + e.qty, 0);
        if (closedSize > totalQty + Math.max(1e-12, totalQty * 1e-9)) {
          incomplete = true;
          latestIncomplete = Math.max(latestIncomplete, time);
          openPositions.delete(symbol);
          continue;
        }
        const avgEntry = pos.entries.reduce((s, e) => s + e.price * e.qty, 0) / totalQty;
        const totalEntryFees = pos.entries.reduce((s, e) => s + e.fee, 0);
        // Prorate accumulated entry fees by the fraction of the position being
        // closed now, carrying the rest forward — collapsing to fee:0 here
        // used to dump 100% of the entry fee onto the first partial close and
        // leave later partial closes of the same lot with none.
        const entryFeeShare = totalEntryFees * (Math.min(closedSize, totalQty) / totalQty);
        const remaining = totalQty - closedSize;
        if (remaining <= Math.max(1e-12, totalQty * 1e-9)) openPositions.delete(symbol);
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
      else { incomplete = true; latestIncomplete = Math.max(latestIncomplete, time); }
      // else: this execution closes a position whose opening leg isn't in
      // the fetched window (e.g. bybit-cron's short lookback vs. a longer
      // swing hold). We have no real entry price to compute P&L from here —
      // skip rather than fabricate entryPrice = exitPrice (silent zero P&L).

      if (opened > qtyTolerance) {
        const newSide: 'Long' | 'Short' = side === 'Buy' ? 'Long' : 'Short';
        openPositions.set(symbol, { side: newSide, entries: [{ qty: opened, price, fee: openFeeShare, time }] });
      }
    }
  }
  return { trades, openPositions, incomplete, latestIncomplete };
}

// Validate the reconstruction against actual open positions before cron writes
// or removes placeholders. A short history is not evidence that a holding closed.
export async function computeBybitSync(apiKey: string, apiSecret: string, days: number):
  Promise<{ trades: BybitTrade[]; open: BybitOpenPosition[] }> {
  const actual = new Map<string, { shares: number; ls: string }>();
  let cursor = '';
  const cursors = new Set<string>();
  do {
    const params: Record<string, string> = { category: 'linear', settleCoin: 'USDT', limit: '200' };
    if (cursor) params.cursor = cursor;
    const json = await bybitGet(apiKey, apiSecret, '/v5/position/list', params);
    if (json.retCode !== 0) throw new Error(json.retMsg || 'Bybit position request failed');
    if (!Array.isArray(json.result?.list)) throw new Error('Invalid Bybit position response');
    for (const p of json.result.list) {
      const shares = Number(p.size);
      if (!Number.isFinite(shares) || shares < 0) throw new Error('Invalid Bybit position size');
      if (!shares) continue;
      if (Number(p.positionIdx) !== 0 || !String(p.symbol).endsWith('USDT') || !['Buy', 'Sell'].includes(p.side)) {
        throw new Error('Bybit hedge mode is not supported; use one-way USDT positions');
      }
      actual.set(p.symbol.replace(/USDT$/, ''), { shares, ls: p.side === 'Buy' ? 'L' : 'S' });
    }
    cursor = json.result.nextPageCursor || '';
    if (cursor && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('Invalid Bybit position cursor');
    cursors.add(cursor);
  } while (cursor);
  const matches = (open: BybitOpenPosition[]) => open.length === actual.size && open.every(p => {
    const a = actual.get(p.symbol);
    return a && a.ls === p.ls && Math.abs(a.shares - p.shares) <= Math.max(1e-12, a.shares * 1e-9);
  });
  let result = await _runBybitFifo(apiKey, apiSecret, days);
  let open = _openPositionsToRows(result.openPositions);
  if (result.incomplete || !matches(open)) {
    result = await _runBybitFifo(apiKey, apiSecret, 725);
    open = _openPositionsToRows(result.openPositions);
  }
  if (!matches(open)) throw new Error('Bybit positions could not be reconciled; no trades were saved. Retry synchronization');
  if (result.latestIncomplete >= Date.now() - days * 24 * 60 * 60 * 1000) {
    throw new Error('Bybit closing execution is missing its entry history; no trades were saved');
  }
  return { trades: result.trades, open };
}

function _openPositionsToRows(openPositions: Map<string, OpenPos>): BybitOpenPosition[] {
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

export async function computeBybitTrades(apiKey: string, apiSecret: string, days: number): Promise<BybitTrade[]> {
  return (await _runBybitFifo(apiKey, apiSecret, days)).trades;
}

// bybit-cron only — computeBybitTrades (the manual "Sync" button's full-
// history backfill) stays closed-trades-only on purpose, see bybit_test.ts's
// header comment and CLAUDE.md.
export async function computeBybitOpen(apiKey: string, apiSecret: string, days: number): Promise<BybitOpenPosition[]> {
  const { openPositions } = await _runBybitFifo(apiKey, apiSecret, days);
  return _openPositionsToRows(openPositions);
}

// bybit-cron calls for both trades AND open positions on every run — calling
// computeBybitTrades then computeBybitOpen separately ran _runBybitFifo (and
// so fetchExecutions, the actual network cost) twice per user per tick
// despite the comment on _runBybitFifo saying a second exported function
// "must not mean a second network fetch". This is the one-fetch version for
// a caller that needs both results.
export async function computeBybitTradesAndOpen(apiKey: string, apiSecret: string, days: number):
  Promise<{ trades: BybitTrade[]; open: BybitOpenPosition[] }> {
  const { trades, openPositions } = await _runBybitFifo(apiKey, apiSecret, days);
  return { trades, open: _openPositionsToRows(openPositions) };
}
