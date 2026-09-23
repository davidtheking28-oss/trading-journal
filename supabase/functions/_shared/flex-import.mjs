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

export async function _flexImportInner(trades, ctx) {
  const { db, _sb, _currentUser, _tradeToRow, _rowToTrade, _isDeletedImport, _dedupeTrades } = ctx;
  let imported = 0, updated = 0;
  const newlyImported = [];
  const toInsert = [];
  const toUpdate = [];

  const sameEntry = (x, t) =>
    x.symbol === t.symbol && x.entryDate === t.entryDate &&
    Math.abs((x.entryPrice || 0) - (t.entryPrice || 0)) < 0.01 &&
    Math.abs((x.shares || 0) - (t.shares || 0)) < 0.01;

  // A hand-entered trade records the whole position at a rounded price, while
  // the broker reports each fill separately — AIR went in manually as 14 shares
  // @84.08 and came back from IBKR as 1 @84.77 plus 12 @84.90. The exact match
  // above cannot see that, so seven manual trades were re-imported alongside
  // their broker copies and counted twice. Only used against untagged rows, and
  // only to skip the insert, never to overwrite the manual entry.
  // GROY (2026-08-10): manual entry recorded 110 shares, the real fill was 113 —
  // just past the old "broker qty never exceeds manual" guard, so it re-imported.
  // ANAB same day: manual date was off by one (51.46 vs the broker's 51.15 the
  // day before) — an exact date match missed it too. Both widened below: date
  // within a day, and share count within 5% either direction (the original
  // qty-no-larger check stays as a fallback for bigger scale-ins).
  const looksLikeSameManualTrade = (x, t) =>
    !x.ibkr_id && !x.bybit_id &&
    x.symbol === t.symbol &&
    Math.abs(new Date(x.entryDate+'T00:00:00') - new Date(t.entryDate+'T00:00:00')) <= 86400000 &&
    (x.entryPrice || 0) > 0 &&
    // 4%: the widest gap among the seven confirmed duplicates was QS at 3.3%,
    // where the hand-typed entry price was simply imprecise. Wide enough to be
    // a judgement call, so it is deliberately fenced in — same symbol, same
    // day (±1), target untagged by any broker, and the share count close to
    // the recorded position. It only ever skips an insert.
    Math.abs((x.entryPrice || 0) - (t.entryPrice || 0)) / (x.entryPrice || 1) < 0.04 &&
    ((t.shares || 0) <= (x.shares || 0) + 0.01 ||
     Math.abs((t.shares || 0) - (x.shares || 0)) <= Math.max(0.01, (x.shares || 0) * 0.05));

  trades.forEach(t => {
    const arr = t.type === 'crypto' ? db.crypto : db.stocks;

    // Orphan close — an execution closing a position opened before the Flex
    // window. Matched only against an open position of the same side
    // (_closeLs), and preferring an exact share-count match when several are
    // open, so a long and a short in the same symbol can't cross-match.
    if (t._orphanClose) {
      // Candidates used to be filtered on `!x.exitPrice`, so a position closed
      // by two separate orphan executions only ever received the first: setting
      // exitPrice on it excluded that row from the second, which then found
      // nothing and was dropped. ONDS (id 50, account 6f73a6c3) hit exactly
      // this and had to be finished by hand. Match on remaining volume instead,
      // and append the extra close as a partial leg.
      const room = x => (x.shares || 0) - (x.closedShares || 0);
      const candidates = arr.filter(x => !x.deleted && x.symbol === t.symbol
        && room(x) > 0.01 && (!t._closeLs || x.ls === t._closeLs));
      const open = candidates.find(x => Math.abs(room(x) - (t.closedShares || 0)) < 0.01) || candidates[0];
      // The account's rolling Flex window keeps re-including old closes on
      // every resync (no per-close id to dedupe against when the account has
      // no Trade ID column), so without this an unattended re-sync silently
      // re-applies the same execution and double-counts closedShares — found
      // 2026-09-17 on dcb5bdba: a 2-share close from weeks earlier came back
      // around and became 2+2=4 instead of staying 2. IBKR's own dateTime
      // (to the second) is unique per execution even without a tradeID, so
      // it doubles as the idempotency key here.
      if (open && t._exitDt && open.lastCloseDt === t._exitDt) return;
      // The candidates[0] fallback can land on a position with less room than
      // the volume being closed. Writing that produces closed_shares > shares
      // and overstates P&L, so skip instead.
      if (open && (t.closedShares || 0) <= room(open) + 0.01) {
        const prev = { exitPrice: open.exitPrice, closeDate: open.closeDate,
                       closedShares: open.closedShares, t: open.t, lastCloseDt: open.lastCloseDt };
        // calcPL prices the remainder (closedShares - sum(t[].shares)) at
        // exitPrice, so an exit already on the row has to be pinned down as an
        // explicit leg before exitPrice is repointed at this execution —
        // otherwise the earlier close silently reprices to the newer one.
        const legs = Array.isArray(open.t) ? open.t.slice() : [];
        if (open.exitPrice && (open.closedShares || 0) > 0) {
          const booked = legs.reduce((a, g) => a + (+g.shares || 0), 0);
          const rem = (open.closedShares || 0) - booked;
          if (rem > 0.01) legs.push({ shares: rem, price: open.exitPrice });
        }
        open.t            = legs;
        open.exitPrice    = t.exitPrice;
        open.closedShares = (open.closedShares || 0) + (t.closedShares || 0);
        open.lastCloseDt  = t._exitDt || open.lastCloseDt;
        // close_date marks the row fully closed — a still-partial position
        // (room left after this close) must not carry one, or it reads as
        // closed while still holding shares (the 2026-08-27 half_closed_row
        // fix: only closedShares >= shares gets a close_date).
        const fullyClosed = open.closedShares >= (open.shares || 0) - 0.01;
        open.closeDate    = fullyClosed ? t.closeDate : null;
        toUpdate.push({ row: open, prev, patch: {
          exit_price:    t.exitPrice        || null,
          close_date:    open.closeDate     || null,
          closed_shares: open.closedShares  || null,
          targets:       legs,
          last_close_dt: open.lastCloseDt   || null,
        } });
        updated++;
      }
      return;
    }

    // A same-direction-blind fill closing (or reversing) a position that this
    // statement never saw opened. flexParseXML has no visibility outside the
    // one XML it's parsing, so a fill with no openCloseIndicator that leaves
    // leftover volume gets read as opening a brand-new position — correct when
    // nothing else is open, wrong when a position in the opposite direction
    // already is. A brokerage account can never hold both a long and a short
    // in the same symbol at once, so that collision is never a coincidence:
    // it is that position closing. Confirmed 2026-08-31 — the IBKR "Trade
    // Confirmation" feed (period="Today", polled every 30 min) carries no
    // openCloseIndicator at all, so a same-day SELL against a long opened on
    // an earlier day — invisible to that day-scoped statement — read as a
    // fresh short instead of closing the long, which then sat open forever
    // while a phantom short appeared beside it.
    if (!t._orphanClose && !t.exitPrice && !arr.some(x => !x.deleted && x.ibkr_id === t.ibkr_id)) {
      const room = x => (x.shares || 0) - (x.closedShares || 0);
      const isOpposite = x => x.symbol === t.symbol && x.ls !== t.ls && room(x) > 0.01;
      // The journal first, then this same batch. _flexSyncFromCache parses the
      // activity statement AND the confirm feed into ONE array and imports them
      // in a single call, so on a first sync — a new user, an empty journal —
      // the open position and the fill that closes it are batch-mates and
      // neither is persisted yet. Matching only against saved rows inserts both.
      const saved   = arr.find(x => !x.deleted && isOpposite(x));
      const pending = saved ? null : toInsert.find(x => x.type === t.type && isOpposite(x));
      const opposite = saved || pending;
      if (opposite) {
        const openShares = t.shares;
        const closeQty = Math.min(room(opposite), openShares);
        const prev = { exitPrice: opposite.exitPrice, closeDate: opposite.closeDate,
                       closedShares: opposite.closedShares, t: opposite.t };
        const legs = Array.isArray(opposite.t) ? opposite.t.slice() : [];
        if (opposite.exitPrice && (opposite.closedShares || 0) > 0) {
          const booked = legs.reduce((a, g) => a + (+g.shares || 0), 0);
          const rem = (opposite.closedShares || 0) - booked;
          if (rem > 0.01) legs.push({ shares: rem, price: opposite.exitPrice });
        }
        opposite.t            = legs;
        opposite.exitPrice    = t.entryPrice;
        opposite.closedShares = (opposite.closedShares || 0) + closeQty;
        // Same rule as the orphan-close branch above: a cover that only takes
        // part of the position leaves shares still held, and a close_date on a
        // row that still holds stock hides it from every open-position view
        // (isOpenPosition) while reading as closed everywhere else.
        opposite.closeDate    = opposite.closedShares >= (opposite.shares || 0) - 0.01 ? t.entryDate : null;
        // A pending row has not been written yet, so it just goes in already
        // closed — queueing an update against a row with no id would target
        // `.eq('id', undefined)` and silently match nothing.
        if (saved) {
          toUpdate.push({ row: opposite, prev, patch: {
            exit_price:    t.entryPrice,
            close_date:    opposite.closeDate,
            closed_shares: opposite.closedShares,
            targets:       legs,
          } });
          updated++;
        }
        const leftover = openShares - closeQty;
        if (leftover <= 0.01) return; // fully absorbed by the existing position — no new row
        // Reversal: volume beyond what the existing position could hold really
        // does open a new position in this direction — carries on below as t.
        t = { ...t, shares: leftover, commission: t.commission * (leftover / openShares) };
      }
    }

    // Find an already-imported copy of this trade. By IBKR's unique execution id
    // first (idempotent — re-syncs never duplicate, and scale-in lots stay
    // separate because each has its own id); else by entry (manual trades, or
    // trades imported before tagging — those get the id backfilled).
    let existing = null;
    if (t.ibkr_id) {
      existing = arr.find(x => !x.deleted && x.ibkr_id === t.ibkr_id)
              || arr.find(x => !x.deleted && !x.ibkr_id && sameEntry(x, t))
              || arr.find(x => !x.deleted && looksLikeSameManualTrade(x, t));
    } else {
      existing = arr.find(x => !x.deleted && sameEntry(x, t));
    }

    if (existing) {
      // Same trade already in the journal → update it in place (corrects the
      // exit on re-sync, backfills the id), never insert a second copy.
      let changed = false;
      const patch = {};
      const prev = { ibkr_id: existing.ibkr_id, exitPrice: existing.exitPrice, closeDate: existing.closeDate,
                     closedShares: existing.closedShares, t: existing.t, commission: existing.commission };
      if (t.ibkr_id && existing.ibkr_id !== t.ibkr_id) { existing.ibkr_id = t.ibkr_id; patch.ibkr_id = t.ibkr_id; changed = true; }
      // The parsed exit only describes THIS row when both describe the same
      // position. flexParseXML merges SMART-router fills that the journal may
      // still hold as separate rows, so the merged trade carries the whole
      // order's exit volume while the row holds one fragment's shares —
      // copying only the exit half writes closed_shares > shares and directly
      // overstates P&L ((exit-entry)*closedShares). This wrote 65 such rows
      // across two accounts before it was caught. Entry-side fields are never
      // synced here (a hand-entered position matched via looksLikeSameManualTrade
      // must keep the user's own numbers), so when the sizes disagree the only
      // safe move is to leave the row alone — consolidating a fragmented group
      // is a separate, deliberate operation.
      const sameSize = Math.abs((existing.shares || 0) - (t.shares || 0)) < 0.01;
      if (sameSize && t.exitPrice && (Math.abs((existing.exitPrice || 0) - t.exitPrice) > 1e-9
          || Math.abs((existing.closedShares || 0) - (t.closedShares || 0)) > 1e-9)) {
        existing.exitPrice    = t.exitPrice;
        existing.closeDate    = t.closeDate;
        existing.closedShares = t.closedShares;
        existing.t            = t.t || [];
        existing.commission   = t.commission;
        patch.exit_price    = t.exitPrice   || null;
        patch.close_date    = t.closeDate   || null;
        patch.closed_shares = t.closedShares|| null;
        patch.targets       = t.t || [];
        patch.commission    = t.commission  || 0;
        changed = true;
      }
      if (changed) { toUpdate.push({ row: existing, prev, patch }); updated++; }
      return;
    }

    // New trade — honor user deletions (don't re-import something deleted).
    if (_isDeletedImport(t)) return;
    // Untagged fills (Flex query without the Trade ID column) are only matched
    // against the journal, so two identical fills in the same statement both got
    // queued and both got inserted. _dedupeTrades can't clean that up later —
    // it only removes an untagged row that matches a tagged one.
    if (!t.ibkr_id && toInsert.some(x => x.type === t.type && sameEntry(x, t))) return;
    toInsert.push(t);
  });

  let updateFailed = 0;
  for (const { row: trade, prev, patch } of toUpdate) {
    // Write only the fields this sync actually changed. _tradeToRow builds a
    // FULL row, so persisting it here re-wrote every column from the in-memory
    // copy — silently reverting any change made since the journal was loaded
    // (another device, another tab, a server-side correction). That is how a
    // correctly merged trade came back with its old pre-merge shares/entry
    // price while its exit fields stayed current.
    const { error } = await _sb.from('trades').update(patch).eq('id', trade.id).eq('user_id', _currentUser.id);
    if (error) {
      // The journal already showed the position as closed at the new exit price
      // and recomputed P&L from it. Put the old values back rather than lie.
      Object.assign(trade, prev);
      updated--; updateFailed++;
      console.error('[flex update]', error);
    }
  }
  let insertFailed = 0;
  for (const t of toInsert) {
    const row = _tradeToRow({ ...t, deleted: false });
    const { data: inserted, error: insErr } = await _sb.from('trades').insert(row).select().single();
    if (insErr) { insertFailed++; console.error('[flex insert]', insErr); continue; }
    const newTrade = _rowToTrade(inserted);
    const arr = t.type === 'crypto' ? db.crypto : db.stocks;
    arr.push(newTrade);
    imported++;
    if (!t.exitPrice) newlyImported.push(newTrade);
  }
  await _dedupeTrades(); // sweep any leftover duplicates right after importing

  return { imported, updated, newlyImported, insertFailed, updateFailed };
}

// Runs the real import logic against an in-memory, no-op "database" so the
// result can be inspected without writing anything — used by ibkr-import in
// shadow mode. Reuses _flexImportInner itself rather than re-implementing
// its matching rules, so shadow mode can never drift from what a real
// import would do.
export async function computeShadowDiff(trades, existingTrades) {
  const db = { stocks: existingTrades.map(t => ({ ...t })), crypto: [] };
  const noopChain = () => ({
    update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    insert: row => ({ select: () => ({ single: () => Promise.resolve({ data: { ...row, id: `shadow-${row.ibkr_id}` }, error: null }) }) }),
  });
  const result = await _flexImportInner(trades, {
    db, _sb: { from: noopChain }, _currentUser: { id: 'shadow' },
    _tradeToRow: t => ({ ...t }), _rowToTrade: row => ({ ...row }),
    _isDeletedImport: () => false, _dedupeTrades: async () => {},
  });
  return result; // { imported, updated, newlyImported, insertFailed }
}
