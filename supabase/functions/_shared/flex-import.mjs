// Shared between dashboard.html (browser, <script type="module">) and the
// ibkr-import Edge Function (Deno). No DOM/browser globals may be assumed —
// DOMParser is injected so the browser can pass its native one and Deno can
// pass npm:@xmldom/xmldom's.
export function flexParseXML(xml, DOMParserImpl = globalThis.DOMParser) {
  const parser = new DOMParserImpl();
  const doc = parser.parseFromString(xml, 'text/xml');
  const tradeEls = [...doc.querySelectorAll('Trade, TradeConfirm')];

  // Group executions by symbol
  const bySymbol = {};
  tradeEls.forEach(el => {
    // IBKR's Flex report mixes real stock fills with FX conversions (assetCategory
    // "CASH", symbols like USD.ILS/ILS.USD) and other non-equity rows in the same
    // <Trade> stream. Importing those as if they were positions polluted the
    // journal with fake permanently-open "trades" carrying share counts like
    // 3014 or 0.0478 — inflating trade counts and any stats derived from them.
    const assetCat = (el.getAttribute('assetCategory') || '').toUpperCase();
    if (assetCat && assetCat !== 'STK') return;
    const sym   = el.getAttribute('symbol') || '';
    // The category test fails open: Flex only emits assetCategory when "Asset
    // Class" is selected in the query, and the Trade Confirmation query is
    // configured separately from the Activity one. Without this second test a
    // query missing that column re-imports USD.ILS as a 3014-share position —
    // the original bug, arriving through a different door. A six-letter pair
    // with a dot is never a ticker.
    if (/^[A-Z]{3}\.[A-Z]{3}$/.test(sym.toUpperCase())) return;
    const dt    = el.getAttribute('dateTime') || '';
    const side  = (el.getAttribute('buySell') || '').toUpperCase();
    const qty   = Math.abs(+el.getAttribute('quantity') || 0);
    const price = +el.getAttribute('tradePrice') || +el.getAttribute('price') || 0;
    const comm  = Math.abs(+el.getAttribute('ibCommission') || +el.getAttribute('commission') || 0);
    const tid   = el.getAttribute('tradeID') || el.getAttribute('ibExecID') || ''; // IBKR's unique execution id
    // IBKR reports whether an execution opens or closes a position when the
    // Flex query includes the "Open/Close Indicator" column — authoritative
    // when present, since it removes any guesswork around shorts.
    const ocRaw = (el.getAttribute('openCloseIndicator') || '').toUpperCase();
    const oc    = ocRaw === 'O' ? 'O' : ocRaw === 'C' ? 'C' : null;
    // IBKR's own order id, when the Flex query includes "IB Order ID". When
    // present it's the authoritative key for merging SMART-router fragments
    // (see below); not every account has this column configured yet, so the
    // merge falls back to the time/price heuristic when it's missing.
    const orderId = el.getAttribute('ibOrderID') || null;
    if (!sym || !dt || !side || !qty || !price) return;

    // Parse date: yyyyMMdd;HHmmss
    const datePart = dt.split(';')[0] || '';
    const date = datePart.length === 8
      ? `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)}`
      : '';
    if (!date) return;

    const timePart = dt.split(';')[1] || '';
    const sec = date && timePart.length === 6
      ? Date.UTC(+datePart.slice(0,4), +datePart.slice(4,6)-1, +datePart.slice(6,8), +timePart.slice(0,2), +timePart.slice(2,4), +timePart.slice(4,6)) / 1000
      : 0;

    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push({ date, price, qty, comm, dt, sec, tid, side, oc, orderId });
  });

  const trades = [];
  const r6 = n => Math.round(n * 1e6) / 1e6;
  Object.entries(bySymbol).forEach(([symbol, execsIn]) => {
    // IBKR cannot report a crypto fill — this entire import path is Flex/Trade
    // Confirmation data. Running the crypto-detection heuristic here anyway
    // misclassified 71 real IBKR stock fills (MSTU, MSTZ and others — leveraged
    // ETF tickers absent from the loaded stock-symbol list) as crypto, filing
    // them under the wrong tab and wrong array entirely.
    const type = 'stock';

    // Single chronological execution stream, side-aware: a BUY first covers
    // any open short lots (FIFO) before opening a new long lot; a SELL first
    // closes any open long lots (FIFO) before opening a new short lot. When
    // the Flex report includes openCloseIndicator that signal is trusted
    // directly instead of inferred from queue state. Leftover close volume
    // with nothing open in-window is a pre-window position (orphan close),
    // tagged with the side it closes so the importer only matches an open
    // position of that same direction.
    const sorted = [...execsIn].sort((a, b) => a.dt.localeCompare(b.dt));

    // IBKR's SMART order router can split a single order into several fills
    // across venues, each arriving as its own <Trade> row with a distinct
    // tradeID even though it's one order. Left unmerged, one real trade
    // inflates into 3-6 journal rows. When the Flex query includes "IB Order
    // ID" that field is authoritative — merge every fill sharing the same
    // orderId, full stop, no guessing (grouped directly, not just adjacent
    // fills, since same-order fills aren't always consecutive once sorted by
    // time). Fills without an orderId (account hasn't added that column yet)
    // fall back to the old heuristic: consecutive same-side fills within 2s
    // of each other and within 0.5% in price. Either way the merge produces
    // one synthetic execution (qty-weighted average price) before FIFO matching.
    const mergeFills = list => list.slice(1).reduce((acc, ex) => {
      const totalQty = acc.qty + ex.qty;
      acc.price = r6((acc.price * acc.qty + ex.price * ex.qty) / totalQty);
      acc.qty = totalQty;
      acc.comm = r6(acc.comm + ex.comm);
      acc.sec = Math.max(acc.sec, ex.sec);
      return acc;
    }, { ...list[0] });

    // Keyed on side and open/close as well as the order id, exactly as the
    // heuristic path below already partitions. One IBKR order can legitimately
    // carry fills of both kinds: selling 100 against a 60-share long reports a
    // "C" fill for 60 and an "O" fill for 40 under one ibOrderID. Grouping on
    // the id alone welded those into a single 100-share close, which lost the
    // new 40-share short and emitted a phantom orphan-close that then hunted
    // for any open long in the symbol to stamp an exit onto. The two merge
    // paths disagreed on the same statement — and the authoritative one was
    // the one that was wrong.
    const byOrderId = {};
    const noOrderId = [];
    for (const ex of sorted) {
      if (ex.orderId) (byOrderId[`${ex.orderId}|${ex.side}|${ex.oc || ''}`] ||= []).push(ex);
      else noOrderId.push(ex);
    }

    const heuristicMerged = [];
    for (const ex of noOrderId) {
      const prev = heuristicMerged[heuristicMerged.length - 1];
      // `prev.sec && ex.sec`: a dateTime with no time part parses to sec 0, so
      // the ≤2s test — the whole basis of this heuristic — passes for every
      // fill on the day and the merge collapses to "same price, same day".
      // Two deliberate entries at 10.00 and 10.01 became one 200-share
      // position. With no clock there is nothing to be proximate about, so the
      // safe answer is not to merge.
      if (prev && prev.side === ex.side && (prev.oc || null) === (ex.oc || null)
          && prev.sec && ex.sec
          && (ex.sec - prev.sec) <= 2 && Math.abs(ex.price - prev.price) <= prev.price * 0.005) {
        const totalQty = prev.qty + ex.qty;
        prev.price = r6((prev.price * prev.qty + ex.price * ex.qty) / totalQty);
        prev.qty = totalQty;
        prev.comm = r6(prev.comm + ex.comm);
        prev.sec = ex.sec;
        continue;
      }
      heuristicMerged.push({ ...ex });
    }

    const execs = [...Object.values(byOrderId).map(mergeFills), ...heuristicMerged]
      .sort((a, b) => a.dt.localeCompare(b.dt));

    let longLots = [], shortLots = [];
    const finalize = (lot, ls) => {
      const trade = {
        symbol, type, ls,
        entryDate:  lot.date,
        entryPrice: lot.price,
        shares:     lot.qty,
        commission: r6(lot.comm + lot.exits.reduce((s, e) => s + e.comm, 0)),
        stop: 0, ecn: 0,
        entryReason: '', marketCond: '', processScore: 0,
        notes_keep: '', notes_improve: '',
      };
      if (lot.tid) trade.ibkr_id = lot.tid; // IBKR's unique entry-execution id
      if (lot.exits.length) {
        const last = lot.exits[lot.exits.length - 1];
        trade.exitPrice    = last.price;
        trade.closeDate    = last.date;
        trade.closedShares = lot.exits.reduce((s, e) => s + e.qty, 0); // total closed
        if (lot.exits.length > 1) trade.t = lot.exits.slice(0, -1).map(e => ({ price: e.price, shares: e.qty }));
      }
      trades.push(trade);
    };
    const openLot = (ex, queue) => queue.push({ qty: ex.qty, remaining: ex.qty, price: ex.price, comm: ex.comm, date: ex.date, dt: ex.dt, tid: ex.tid, exits: [] });
    const closeAgainst = (ex, queue, ls) => {
      let q = ex.qty;
      while (q > 1e-9 && queue.length) {
        const lot = queue[0];
        const take = Math.min(lot.remaining, q);
        lot.exits.push({ price: ex.price, qty: take, date: ex.date, dt: ex.dt, comm: ex.comm * (take / ex.qty) });
        lot.remaining -= take;
        q -= take;
        if (lot.remaining <= 1e-9) { queue.shift(); finalize(lot, ls); }
      }
      return q; // leftover, unmatched within this window
    };

    for (const ex of execs) {
      if (ex.side === 'BUY') {
        // openCloseIndicator, when present, is authoritative
        if (ex.oc === 'O') { openLot(ex, longLots); continue; }
        if (ex.oc === 'C') {
          const left = closeAgainst(ex, shortLots, 'S');
          if (left > 1e-9) trades.push({ symbol, type, _orphanClose: true, _closeLs: 'S',
            exitPrice: ex.price, closeDate: ex.date, closedShares: left,
            commission: r6(ex.comm * (left / ex.qty)), _exitDt: ex.dt, ...(ex.tid ? { ibkr_id: ex.tid } : {}) });
          continue;
        }
        // No indicator — infer: cover open shorts first, excess opens a new long.
        const left = closeAgainst(ex, shortLots, 'S');
        if (left > 1e-9) openLot({ ...ex, qty: left, comm: ex.comm * (left / ex.qty) }, longLots);
        continue;
      }
      // SELL
      if (ex.oc === 'O') { openLot(ex, shortLots); continue; }
      if (ex.oc === 'C') {
        const left = closeAgainst(ex, longLots, 'L');
        if (left > 1e-9) trades.push({ symbol, type, _orphanClose: true, _closeLs: 'L',
          exitPrice: ex.price, closeDate: ex.date, closedShares: left,
          commission: r6(ex.comm * (left / ex.qty)), _exitDt: ex.dt, ...(ex.tid ? { ibkr_id: ex.tid } : {}) });
        continue;
      }
      // No indicator — infer: close open longs first, excess opens a new short.
      const left = closeAgainst(ex, longLots, 'L');
      if (left > 1e-9) openLot({ ...ex, qty: left, comm: ex.comm * (left / ex.qty) }, shortLots);
    }
    longLots.forEach(lot => finalize(lot, 'L'));   // leftover open / partially-closed longs
    shortLots.forEach(lot => finalize(lot, 'S'));  // leftover open / partially-closed shorts
  });

  return trades;
}
