// Regression suite for the calculation and import logic in dashboard.html.
//
// Every case here corresponds to a bug that reached production. Run with:
//   node --test tests/
//
// Two kinds of check:
//   • behavioural — the function is extracted and actually run
//   • guard       — the function's source is asserted to still contain a
//                   specific safety condition. Used where the code is welded to
//                   the DOM or Supabase and cannot be run headless; it cannot
//                   prove the behaviour, only that the guard was not deleted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { load, extractFunction, SOURCE } from './harness.mjs';

const { flexParseXML } = load('flexParseXML');
const { calcPL, calcTotal } = load('calcPL', 'calcTotal');
const { isClosed } = load('isClosed');
const { calcRisk } = load('calcRisk');
const { tradeDays } = load('tradeDays');
const { calcStopRisk } = load('calcStopRisk');
const { stats } = load('calcPL', 'calcTotal', 'isClosed', 'stats');
const { calcDrawdownSeries } = load('calcPL', 'calcTotal', 'isClosed', 'calcDrawdownSeries');
const { calcRHistogram } = load('calcPL', 'calcTotal', 'isClosed', 'calcStopRisk', 'R_HIST_BUCKETS', 'calcRHistogram');

const fill = (o = {}) => ({
  symbol: 'TST', tradeID: '1', dateTime: '20260806;100000', quantity: '100',
  tradePrice: '10', ibCommission: '-1', buySell: 'BUY', assetCategory: 'STK', ...o,
});
const xmlOf = (...fills) =>
  '<FlexQueryResponse>' +
  fills.map(f => '<Trade ' + Object.entries(f).map(([k, v]) => `${k}="${v}"`).join(' ') + ' />').join('') +
  '</FlexQueryResponse>';

describe('flexParseXML — SMART-router fill consolidation', () => {
  test('merges fills sharing an ibOrderID even when far apart in time and price', () => {
    // The time/price heuristic would reject these (10s apart, 5% apart); the
    // order id is authoritative and must win.
    const out = flexParseXML(xmlOf(
      fill({ tradeID: '1', ibOrderID: '777', quantity: '100', tradePrice: '10.00' }),
      fill({ tradeID: '2', ibOrderID: '777', quantity: '50', tradePrice: '10.50', dateTime: '20260806;100010' }),
    ));
    assert.equal(out.length, 1, 'one order must produce one trade');
    assert.equal(out[0].shares, 150);
    assert.equal(out[0].entryPrice, 10.166667, 'qty-weighted average price');
  });

  test('does not double-count the first fill of a merged group', () => {
    // The merge reducer was seeded with {...list[0]} while still iterating from
    // index 0, so the first fill was added to itself: 150 shares became 250.
    const out = flexParseXML(xmlOf(
      fill({ tradeID: '1', ibOrderID: '5', quantity: '100', tradePrice: '10' }),
      fill({ tradeID: '2', ibOrderID: '5', quantity: '50', tradePrice: '10' }),
    ));
    assert.equal(out[0].shares, 150, 'must be 100+50, not 100+100+50');
    assert.equal(out[0].commission, 2, 'commission must not be double-counted either');
  });

  test('falls back to the time/price heuristic when no order id is present', () => {
    const out = flexParseXML(xmlOf(
      fill({ tradeID: '1', quantity: '400', tradePrice: '14.7437', dateTime: '20260806;094219' }),
      fill({ tradeID: '2', quantity: '100', tradePrice: '14.74', dateTime: '20260806;094219' }),
    ));
    assert.equal(out.length, 1);
    assert.equal(out[0].shares, 500);
  });

  test('does not merge fills that are far apart when no order id ties them', () => {
    const out = flexParseXML(xmlOf(
      fill({ tradeID: '1', quantity: '100', tradePrice: '10', dateTime: '20260806;100000' }),
      fill({ tradeID: '2', quantity: '100', tradePrice: '10', dateTime: '20260806;103000' }),
    ));
    assert.equal(out.length, 2, 'half an hour apart is two separate entries');
  });

  test('an order id never merges fills belonging to different orders', () => {
    const out = flexParseXML(xmlOf(
      fill({ tradeID: '1', ibOrderID: 'A', quantity: '100', tradePrice: '10' }),
      fill({ tradeID: '2', ibOrderID: 'B', quantity: '100', tradePrice: '10' }),
    ));
    assert.equal(out.length, 2);
  });
});

describe('flexParseXML — classification and filtering', () => {
  test('IBKR fills are always stock, never crypto', () => {
    // symIsCrypto() used to run here and misfiled leveraged-ETF tickers such as
    // MSTU/MSTZ under the crypto tab. IBKR cannot report a crypto fill at all.
    for (const symbol of ['MSTU', 'MSTZ', 'BTC', 'ETH', 'XRP']) {
      const out = flexParseXML(xmlOf(fill({ symbol })));
      assert.equal(out[0].type, 'stock', `${symbol} must import as stock`);
    }
  });

  test('currency conversions are excluded', () => {
    // assetCategory CASH rows (USD.ILS) were imported as permanently-open
    // positions with share counts like 3014, inflating every derived stat.
    const out = flexParseXML(xmlOf(
      fill({ symbol: 'USD.ILS', assetCategory: 'CASH', quantity: '3014' }),
      fill({ symbol: 'AAPL', tradeID: '2', assetCategory: 'STK' }),
    ));
    assert.equal(out.length, 1);
    assert.equal(out[0].symbol, 'AAPL');
  });

  test('a closed position never reports closing more than it opened', () => {
    // closed_shares > shares overstates P&L directly, since P&L is measured
    // over closedShares.
    const out = flexParseXML(xmlOf(
      fill({ tradeID: '1', ibOrderID: '1', quantity: '600', buySell: 'BUY' }),
      fill({ tradeID: '2', ibOrderID: '2', quantity: '600', buySell: 'SELL', tradePrice: '11', dateTime: '20260806;110000' }),
    ));
    for (const t of out) {
      if (t.closedShares) assert.ok(t.closedShares <= t.shares + 1e-9,
        `closedShares ${t.closedShares} exceeds shares ${t.shares}`);
    }
  });
});

describe('P&L', () => {
  const cases = [
    ['long, full close',      { ls: 'L', entryPrice: 10, shares: 100, closedShares: 100, exitPrice: 12, commission: 5, ecn: 0, t: [] }, (12 - 10) * 100 - 5],
    ['short, full close',     { ls: 'S', entryPrice: 10, shares: 100, closedShares: 100, exitPrice: 8, commission: 5, ecn: 0, t: [] }, (10 - 8) * 100 - 5],
    ['long, partial close',   { ls: 'L', entryPrice: 10, shares: 100, closedShares: 40, exitPrice: 11, commission: 2, ecn: 0, t: [] }, (11 - 10) * 40 - 2],
    ['long, target + runner', { ls: 'L', entryPrice: 10, shares: 100, closedShares: 100, exitPrice: 12, commission: 5, ecn: 0, t: [{ shares: 40, price: 11 }] }, (11 - 10) * 40 + (12 - 10) * 60 - 5],
    ['short, target + runner',{ ls: 'S', entryPrice: 10, shares: 100, closedShares: 100, exitPrice: 8, commission: 5, ecn: 0, t: [{ shares: 40, price: 9 }] }, (10 - 9) * 40 + (10 - 8) * 60 - 5],
    ['still open',            { ls: 'L', entryPrice: 10, shares: 100, closedShares: null, exitPrice: null, commission: 1, ecn: 0, t: [] }, -1],
    ['ecn fee deducted',      { ls: 'L', entryPrice: 10, shares: 100, closedShares: 100, exitPrice: 11, commission: 5, ecn: 3, t: [] }, (11 - 10) * 100 - 3 - 5],
  ];
  for (const [name, tr, expected] of cases) {
    test(name, () => assert.equal(+calcTotal(tr).toFixed(6), +expected.toFixed(6)));
  }

  test('closedShares is the TOTAL closed volume, partials included', () => {
    // Written the other way round (closedShares = final leg only) the runner is
    // silently dropped from P&L, because calcPL derives it as
    // closedShares - sum(partials).
    const total = { ls: 'L', entryPrice: 10, shares: 100, closedShares: 100, exitPrice: 12, commission: 0, ecn: 0, t: [{ shares: 40, price: 11 }] };
    assert.equal(calcPL(total), (11 - 10) * 40 + (12 - 10) * 60);
  });

  test('empty and malformed trades do not throw', () => {
    for (const fn of [calcPL, calcTotal, calcRisk, tradeDays, calcStopRisk]) {
      assert.doesNotThrow(() => fn({}));
    }
    assert.equal(isClosed({}), false);
  });

  test('calcStopRisk falls back to the exit price when no stop is set', () => {
    const tr = { entryPrice: 10, exitPrice: 12, closedShares: 100, commission: 1 };
    assert.equal(calcStopRisk(tr), (12 - 10) * 100);
  });

  test('calcStopRisk still prefers a real stop over the exit price', () => {
    const tr = { entryPrice: 10, stop: 9, exitPrice: 12, closedShares: 100, commission: 1 };
    assert.equal(calcStopRisk(tr), (10 - 9) * 100);
  });

  test('calcDrawdownSeries: monotonically rising equity has zero drawdown throughout', () => {
    const trades = [
      { ls: 'L', entryPrice: 10, shares: 10, closedShares: 10, exitPrice: 12, commission: 0, ecn: 0, t: [], entryDate: '2026-01-01', closeDate: '2026-01-02' },
      { ls: 'L', entryPrice: 10, shares: 10, closedShares: 10, exitPrice: 13, commission: 0, ecn: 0, t: [], entryDate: '2026-01-03', closeDate: '2026-01-04' },
    ];
    const { points, maxDrawdown, current } = calcDrawdownSeries(trades);
    assert.equal(points.length, 2);
    assert.equal(maxDrawdown, 0);
    assert.equal(current, 0);
  });

  test('calcDrawdownSeries: a single big loss after a gain is the max drawdown, denominated on deployed capital', () => {
    const trades = [
      { ls: 'L', entryPrice: 10, shares: 10, closedShares: 10, exitPrice: 20, commission: 0, ecn: 0, t: [], entryDate: '2026-01-01', closeDate: '2026-01-02' }, // +100
      { ls: 'L', entryPrice: 10, shares: 10, closedShares: 10, exitPrice: 5,  commission: 0, ecn: 0, t: [], entryDate: '2026-01-03', closeDate: '2026-01-04' }, // -50
    ];
    const { maxDrawdown, current, pctMode } = calcDrawdownSeries(trades);
    // base = deployed capital = 10*10 + 10*10 = 200 (NOT the running peak of
    // P&L, which crosses arbitrarily close to zero and blew up to -18982% on
    // real seed data — verified live). peak 100, equity 50 -> (50-100)/200 = -25%
    assert.equal(pctMode, true);
    assert.equal(+maxDrawdown.toFixed(2), -25);
    assert.equal(+current.toFixed(2), -25);
  });

  test('calcDrawdownSeries: zero deployed capital falls back to $ terms', () => {
    // entryPrice 0 (e.g. a data gap) means no capital base to denominate a
    // percent against — the only real zero-base case, unlike "never went
    // net-positive" which still has a real capital base and a real percent.
    const trades = [
      { ls: 'S', entryPrice: 0, shares: 10, closedShares: 10, exitPrice: 8, commission: 0, ecn: 0, t: [], entryDate: '2026-01-01', closeDate: '2026-01-02' }, // (0-8)*10 = -80 ($ terms)
    ];
    const { pctMode, points } = calcDrawdownSeries(trades);
    assert.equal(pctMode, false);
    assert.equal(points[0].drawdown, -80); // peak 0, equity -80 -> falls back to $ (equity - peak)
  });

  test('calcDrawdownSeries: no closed trades returns an empty series, not a fabricated one', () => {
    const { points, maxDrawdown, current } = calcDrawdownSeries([]);
    assert.deepEqual(points, []);
    assert.equal(maxDrawdown, 0);
    assert.equal(current, 0);
  });

  test('calcRHistogram: only trades with a measurable stop-risk are counted', () => {
    const withStop = { ls: 'L', entryPrice: 10, stop: 9, shares: 10, closedShares: 10, exitPrice: 12, commission: 0, ecn: 0, t: [] }; // R = 20/10 = +2
    // calcStopRisk falls back to the exit price when no stop is set, so this is
    // still measurable — the real exclusion case is fee-dominated risk (calcStopRisk
    // returns 0 when the planned risk is smaller than the trade's own commission).
    const feeDominated = { ls: 'L', entryPrice: 10, shares: 1, closedShares: 1, exitPrice: 10.001, commission: 5, ecn: 0, t: [] };
    const { buckets, counted } = calcRHistogram([withStop, feeDominated]);
    assert.equal(counted, 1);
    const hit = buckets.find(b => b.label === '1R..2R');
    assert.equal(hit.count, 1);
  });

  test('calcRHistogram: a loss beyond -2R lands in the tail bucket, not zero-bucketed', () => {
    const tr = { ls: 'L', entryPrice: 10, stop: 9, shares: 10, closedShares: 10, exitPrice: 1, commission: 0, ecn: 0, t: [] }; // R = -90/10 = -9
    const { buckets, counted } = calcRHistogram([tr]);
    assert.equal(counted, 1);
    assert.equal(buckets.find(b => b.label === '<-2R').count, 1);
  });

  test('calcRHistogram: exactly on a bucket boundary goes to the lower bucket (<=)', () => {
    // R exactly = 1.0 -> falls in '0R..1R' (max:1, r<=1)
    const tr = { ls: 'L', entryPrice: 10, stop: 9, shares: 10, closedShares: 10, exitPrice: 11, commission: 0, ecn: 0, t: [] }; // R = 10/10 = 1
    const { buckets } = calcRHistogram([tr]);
    assert.equal(buckets.find(b => b.label === '0R..1R').count, 1);
    assert.equal(buckets.find(b => b.label === '1R..2R').count, 0);
  });

  test('stats over an empty journal is all zeros', () => {
    const s = stats([]);
    assert.deepEqual(
      { total: s.total, wins: s.wins, losses: s.losses, wr: s.wr, nClosed: s.nClosed },
      { total: 0, wins: 0, losses: 0, wr: 0, nClosed: 0 },
    );
  });

  test('open positions are excluded from realised P&L', () => {
    const open = { ls: 'L', entryPrice: 10, shares: 100, commission: 2, ecn: 0, t: [] };
    const closed = { ls: 'L', entryPrice: 10, shares: 100, closedShares: 100, exitPrice: 11, closeDate: '2026-01-02', commission: 1, ecn: 0, t: [] };
    const s = stats([open, closed]);
    assert.equal(s.nClosed, 1);
    assert.equal(s.total, (11 - 10) * 100 - 1, 'the open position\'s commission must not leak in');
  });
});

describe('guards that cannot be exercised headless', () => {
  const importSrc = extractFunction('_flexImportInner');
  const dedupeSrc = extractFunction('deduplicateDB');
  const autoDedupeSrc = extractFunction('_dedupeTrades');
  const csvSrc = extractFunction('biParseRows');

  test('sync updates write only changed fields, never a rebuilt full row', () => {
    // _tradeToRow builds every column from the in-memory copy, so persisting it
    // re-wrote shares/entry_price from whatever was loaded at page open —
    // reverting changes made since (another device, a server-side correction).
    assert.match(importSrc, /\.update\(patch\)/,
      'the update must persist the patch object');
    assert.doesNotMatch(importSrc, /\.update\(_tradeToRow\(/,
      'persisting a full rebuilt row reintroduces the lost-update bug');
  });

  test('the exit half is not copied onto a row of a different size', () => {
    // A merged order's exit volume landing on a single fragment's row is what
    // produced closed_shares > shares across 65 live rows.
    assert.match(importSrc, /const sameSize\s*=/, 'sameSize guard missing');
    assert.match(importSrc, /if\s*\(\s*sameSize\s*&&/, 'sameSize guard computed but not applied');
  });

  test('orphan-close never closes more shares than the row holds', () => {
    assert.match(importSrc, /t\.closedShares\s*\|\|\s*0\)\s*<=\s*room\(open\)/,
      'the candidates[0] fallback must be size-guarded');
  });

  test('a second orphan close can still reach a partly-closed row', () => {
    // Candidates were filtered on `!x.exitPrice`, so applying the first orphan
    // close excluded that row from the second, which was then dropped with no
    // warning. ONDS (id 50) had to be completed by hand because of this.
    assert.doesNotMatch(importSrc, /!x\.exitPrice && \(!t\._closeLs/,
      'excluding any row that already carries an exit drops the second close');
    assert.match(importSrc, /const room = x =>/, 'candidates must be matched on remaining volume');
    assert.match(importSrc, /open\.closedShares = \(open\.closedShares \|\| 0\) \+ \(t\.closedShares \|\| 0\)/,
      'closed volume must accumulate, not overwrite');
    // calcPL prices (closedShares - sum(t[].shares)) at exitPrice, so repointing
    // exitPrice without booking the previous exit as a leg silently reprices it.
    assert.match(importSrc, /legs\.push\(\{ shares: rem, price: open\.exitPrice \}\)/,
      'the existing exit must be pinned as a partial leg before exitPrice moves');
  });

  test('"clean duplicates" never removes a broker-tagged row', () => {
    // Grouping on symbol+date+price alone saw 73 real SMART-router fills as
    // duplicates and offered to delete them permanently.
    assert.match(dedupeSrc, /filter\(t\s*=>\s*!brokerId\(t\)\)/,
      'only untagged rows may be removed');
    assert.match(dedupeSrc, /Math\.round\(\(t\.shares\|\|0\)\*1000\)/,
      'share count must be part of the duplicate identity key');
  });

  test('the automatic dedup only removes provable duplicates', () => {
    // Runs on every login with no confirmation, so its rules must stay strict:
    // same broker id, or an untagged row matching a tagged one on the FULL
    // fingerprint (entry and exit).
    assert.match(autoDedupeSrc, /seenId\.has\(bid\(t\)\)/);
    assert.match(autoDedupeSrc, /taggedFp\.has\(fp\(t\)\)/);
    assert.match(autoDedupeSrc, /t\.exitPrice\|\|0\)\*1000\)/,
      'the fingerprint must include the exit, or distinct trades collide');
  });

  test('CSV import records closedShares on a closed position', () => {
    // renderMonthlyTracker selects on closedShares > 0, so leaving it null made
    // CSV-imported months render empty while every other stat counted them.
    assert.match(csvSrc, /closedShares:\s*exitPrice\s*>\s*0\s*\?\s*shares\s*:\s*null/);
  });
});

// ── A no-indicator fill that collides with an already-open opposite position
// must close it, not open a phantom second position ─────────────────────────
// MD, 2026-08-31: IBKR's Trade Confirmation feed (period="Today", no
// openCloseIndicator) reported a same-day SELL with no visibility of the long
// opened a week earlier in a different statement. flexParseXML, parsing that
// feed alone, read it as a fresh short. A brokerage account can never hold a
// long and a short in the same symbol at once, so _flexImportInner now closes
// the existing opposite-direction row instead of inserting a new one.
describe('_flexImportInner — a no-indicator fill against an open opposite position', () => {
  function run(trades, { existing = [] } = {}) {
    const src = 'async ' + extractFunction('_flexImportInner');
    const updates = [];
    const inserts = [];
    let nextId = 100;
    const db = { stocks: existing.map(t => ({ ...t })), crypto: [] };
    const chain = table => ({
      update: patch => ({
        eq: () => ({ eq: () => { updates.push({ table, patch }); return Promise.resolve({ error: null }); } }),
      }),
      insert: row => ({
        select: () => ({
          single: () => { const withId = { ...row, id: nextId++ }; inserts.push(withId); return Promise.resolve({ data: withId, error: null }); },
        }),
      }),
    });
    const scope = {
      db,
      _sb: { from: chain },
      _currentUser: { id: 'u1' },
      _tradeToRow: t => ({ ...t }),
      _rowToTrade: row => ({ ...row }),
      _isDeletedImport: () => false,
      _dedupeTrades: async () => {},
      initFilters: () => {}, renderTable: () => {}, renderOverview: () => {}, renderStatistics: () => {},
      toast: () => {},
      document: { getElementById: () => null },
    };
    const names = Object.keys(scope);
    const factory = new Function(...names, `${src}\nreturn _flexImportInner;`);
    return { run: () => factory(...names.map(n => scope[n]))(trades), db, updates, inserts };
  }

  const openLong = { symbol: 'MD', type: 'stock', ls: 'L', shares: 30, closedShares: 0,
    entryPrice: 26.71, entryDate: '2026-08-24', commission: 2.5, ibkr_id: '1554942974', deleted: false };
  const confirmSell = { symbol: 'MD', type: 'stock', ls: 'S', shares: 30,
    entryPrice: 25.9, entryDate: '2026-08-31', commission: 2.5, ibkr_id: '1562656936' };

  test('closes the existing long instead of inserting a new short', async () => {
    const h = run([confirmSell], { existing: [openLong] });
    await h.run();
    assert.equal(h.inserts.length, 0, 'a full close must not also insert a new row');
    assert.equal(h.updates.length, 1);
    assert.equal(h.updates[0].patch.exit_price, 25.9);
    assert.equal(h.updates[0].patch.closed_shares, 30);
    assert.equal(h.db.stocks[0].exitPrice, 25.9, 'the in-memory row must reflect the close too');
  });

  test('excess volume beyond the open position reverses into a new position', async () => {
    const smallLong = { ...openLong, shares: 20, closedShares: 0 };
    const h = run([{ ...confirmSell, shares: 30 }], { existing: [smallLong] });
    await h.run();
    assert.equal(h.updates[0].patch.closed_shares, 20, 'only the room that was open gets closed');
    assert.equal(h.inserts.length, 1, 'the 10-share excess opens a real new position');
    assert.equal(h.inserts[0].shares, 10);
    assert.equal(h.inserts[0].ls, 'S');
  });

  test('a fresh position with nothing open in the opposite direction still inserts normally', async () => {
    const h = run([confirmSell], { existing: [] });
    await h.run();
    assert.equal(h.updates.length, 0);
    assert.equal(h.inserts.length, 1, 'no opposite position exists — this really is a new trade');
    assert.equal(h.inserts[0].shares, 30);
  });

  test('a re-sync of an already-applied close does not re-fire', async () => {
    const closedLong = { ...openLong, closedShares: 30, exitPrice: 25.9, closeDate: '2026-08-31' };
    const alreadyImportedShort = { symbol: 'MD', type: 'stock', ls: 'S', shares: 30, closedShares: 0,
      entryPrice: 25.9, entryDate: '2026-08-31', commission: 2.5, ibkr_id: '1562656936', deleted: false };
    const h = run([confirmSell], { existing: [closedLong, alreadyImportedShort] });
    await h.run();
    assert.equal(h.inserts.length, 0, 'the short from the first sync must not be duplicated');
    assert.equal(h.updates.length, 0, 'an already-closed row must not be re-closed');
  });

  // The mirror case. flexParseXML's BUY branch is the same shape as its SELL
  // one — cover open shorts, then open a long with whatever is left — so a
  // covering BUY seen only through the confirm feed reads as a fresh LONG
  // beside the short it was actually closing. Nothing about the fix is
  // direction-specific, and these prove it rather than assuming it.
  const openShort = { symbol: 'MD', type: 'stock', ls: 'S', shares: 30, closedShares: 0,
    entryPrice: 25.9, entryDate: '2026-08-31', commission: 2.5, ibkr_id: '1562656936', deleted: false };
  const confirmBuy = { symbol: 'MD', type: 'stock', ls: 'L', shares: 30,
    entryPrice: 24, entryDate: '2026-09-02', commission: 2.5, ibkr_id: '1571000001' };

  test('a covering BUY closes the existing short instead of inserting a new long', async () => {
    const h = run([confirmBuy], { existing: [openShort] });
    await h.run();
    assert.equal(h.inserts.length, 0, 'covering a short must not open a phantom long');
    assert.equal(h.updates.length, 1);
    assert.equal(h.updates[0].patch.exit_price, 24, 'a short exits at the price it was bought back at');
    assert.equal(h.updates[0].patch.closed_shares, 30);
    assert.equal(h.updates[0].patch.close_date, '2026-09-02');
  });

  test('the covered short books a profit, with the sign the right way round', async () => {
    // The whole point of getting the direction right: sold at 25.9, covered at
    // 24 — that is a gain on a short and a loss on a long, and the phantom-row
    // bug hid it as two open positions with no realised P&L at all.
    const h = run([confirmBuy], { existing: [openShort] });
    await h.run();
    const row = h.db.stocks[0];
    assert.equal(row.ls, 'S');
    assert.equal(calcPL(row), (25.9 - 24) * 30, 'a short gains when it covers lower');
    assert.ok(calcPL(row) > 0);
  });

  test('a partial cover closes only what was bought back, and opens nothing', async () => {
    const h = run([{ ...confirmBuy, shares: 10 }], { existing: [openShort] });
    await h.run();
    assert.equal(h.inserts.length, 0);
    assert.equal(h.updates[0].patch.closed_shares, 10, 'the other 20 shares are still short');
    assert.equal(h.db.stocks[0].shares - h.db.stocks[0].closedShares, 20);
  });

  test('buying back more than the short held reverses into a new long', async () => {
    const smallShort = { ...openShort, shares: 20, closedShares: 0 };
    const h = run([confirmBuy], { existing: [smallShort] });
    await h.run();
    assert.equal(h.updates[0].patch.closed_shares, 20, 'the short closes at its own size');
    assert.equal(h.inserts.length, 1);
    assert.equal(h.inserts[0].ls, 'L', 'the excess flips the position long');
    assert.equal(h.inserts[0].shares, 10);
  });

  // The case a new user hits on their very first sync. _flexSyncFromCache parses
  // BOTH statements into one array — `trades.push(...flexParseXML(row.xml))`
  // then `...flexParseXML(row.xml_confirm)` — and hands them to one
  // _flexImportInner call. So the activity statement's open long and the confirm
  // feed's phantom short arrive in the SAME batch, and neither is in the journal
  // yet: matching only against already-persisted rows misses it entirely and
  // both get inserted. An empty journal is exactly the new-user case.
  test('the collision is caught inside one batch, with nothing in the journal yet', async () => {
    const h = run([
      { ...openLong, closedShares: undefined, deleted: undefined },  // from row.xml
      confirmSell,                                                    // from row.xml_confirm
    ], { existing: [] });
    await h.run();
    assert.equal(h.inserts.length, 1, 'only the long may be inserted — the sell closes it, it is not a second position');
    assert.equal(h.inserts[0].ls, 'L');
    assert.equal(h.inserts[0].exitPrice, 25.9, 'the long must go in already closed');
    assert.equal(h.inserts[0].closedShares, 30);
    assert.equal(h.inserts[0].closeDate, '2026-08-31');
  });

  test('a batch-mate collision in the short direction is caught too', async () => {
    const h = run([
      { ...openShort, closedShares: undefined, deleted: undefined },
      confirmBuy,
    ], { existing: [] });
    await h.run();
    assert.equal(h.inserts.length, 1, 'covering a same-batch short must not insert a long');
    assert.equal(h.inserts[0].ls, 'S');
    assert.equal(h.inserts[0].exitPrice, 24);
    assert.equal(h.inserts[0].closedShares, 30);
  });

  // The false positive to avoid. When one statement contains both sides,
  // flexParseXML's own FIFO already resolved it: the long comes out CLOSED
  // (room 0) and the short is a separate open lot. Neither may be touched
  // again here, or a correctly-imported reversal gets closed a second time.
  test('a reversal the statement already resolved is left alone', async () => {
    const closedLong = { ...openLong, closedShares: 30, exitPrice: 25.9, closeDate: '2026-08-31',
      deleted: undefined, ibkr_id: '1554942974' };
    const newShort = { symbol: 'MD', type: 'stock', ls: 'S', shares: 10,
      entryPrice: 25.9, entryDate: '2026-08-31', commission: 1, ibkr_id: '1562656937' };
    const h = run([closedLong, newShort], { existing: [] });
    await h.run();
    assert.equal(h.updates.length, 0, 'a fully-closed row has no room and must not be re-closed');
    assert.equal(h.inserts.length, 2, 'both the closed long and the real short belong in the journal');
    assert.equal(h.inserts[1].ls, 'S');
    assert.equal(h.inserts[1].shares, 10, 'the short keeps its own size');
    assert.equal(h.inserts[1].exitPrice, undefined, 'the new short stays open');
  });

  test('a batch-mate reversal still opens the genuine excess', async () => {
    const h = run([
      { ...openLong, shares: 20, closedShares: undefined, deleted: undefined },
      confirmSell,  // 30 shares against a 20-share long
    ], { existing: [] });
    await h.run();
    assert.equal(h.inserts.length, 2, 'the closed long, plus a real 10-share short');
    assert.equal(h.inserts[0].closedShares, 20);
    assert.equal(h.inserts[1].ls, 'S');
    assert.equal(h.inserts[1].shares, 10);
  });
});

// ── Investments tab ─────────────────────────────────────────────────────────
// invRecalc reads its numbers straight out of the table inputs, so the
// arithmetic was untestable until the accumulation was split into these two
// pure functions. Every case below is a bug that shipped.
const { invAccumulate } = load('invAccumulate');
const { invDonutPcts } = load('invDonutPcts');

const holding = (o = {}) => ({ cat: 'blue', entryShares: 10, entryPrice: 100, currentPrice: 110, ...o });

describe('invAccumulate — portfolio totals', () => {
  test('a holding with no quote is left out of the return denominator', () => {
    // totalCost counted every row while totalUnrealizedPnL only counted rows
    // that had a price, so one failed quote halved the headline return.
    const r = invAccumulate([
      holding(),                          // cost 1000, +100
      holding({ currentPrice: 0 }),       // cost 1000, no quote
    ]);
    assert.equal(r.totalCost, 2000, 'invested total still shows every holding');
    assert.equal(r.totalUnrealizedPnL, 100);
    assert.equal(r.pnlCost, 1000, 'only quoted cost belongs in the % denominator');
    assert.equal(r.totalUnrealizedPnL / r.pnlCost * 100, 10, 'must be +10%, not +5%');
  });

  test('an unquoted holding is valued at cost, not at zero', () => {
    const r = invAccumulate([holding({ currentPrice: 0 })]);
    assert.equal(r.totalCurrentValue, 1000);
  });

  test('with no quotes at all the return is null rather than 0%', () => {
    const r = invAccumulate([holding({ currentPrice: 0 })]);
    assert.equal(r.totalUnrealizedPnL, null, 'null renders as —; 0 would claim a flat portfolio');
    assert.equal(r.pnlCost, 0);
  });

  test('category buckets accumulate cost, and values accumulate separately', () => {
    const r = invAccumulate([holding({ cat: 'blue' }), holding({ cat: 'green', currentPrice: 200 })]);
    assert.equal(r.byCat.blue, 1000);
    assert.equal(r.byCat.green, 1000, 'buckets are cost-based so targets do not move with price');
    assert.equal(r.byCatValue.green, 2000);
  });

  test('a zero-cost row cannot produce a per-row percentage', () => {
    const r = invAccumulate([holding({ entryPrice: 0 })]);
    assert.equal(r.rowData[0].pnlPct, null);
    assert.equal(r.rowData[0].pnlAmt, null);
  });
});

describe('invDonutPcts — allocation slices', () => {
  test('cash never goes negative when cost basis exceeds the portfolio total', () => {
    // 100 - totalAllocated went negative and emitted stroke-dasharray="-8.4 314".
    const p = invDonutPcts({ blue: 1500, green: 0, yellow: 0 }, 1000, 200);
    assert.equal(p.cash, 0);
    assert.ok(p.cash >= 0);
  });

  test('cash is capped by the room the allocations leave', () => {
    const p = invDonutPcts({ blue: 600, green: 0, yellow: 0 }, 1000, 900);
    assert.equal(p.cash, 40, 'not 90 — only 40% of the ring is unallocated');
  });

  test('an empty portfolio yields zeros, not NaN', () => {
    const p = invDonutPcts({ blue: 0, green: 0, yellow: 0, none: 0 }, 0, 0);
    assert.deepEqual(p, { blue: 0, green: 0, yellow: 0, none: 0, cash: 0 });
  });
});

// ── Position sizing calculator ──────────────────────────────────────────────
// Portfolio value (₪ or $) × desired % → converted to USD → floored into whole
// shares, then checked against the category target and available cash. A wrong
// number here is a wrong order, so the failure modes matter as much as the
// happy path.
const { invPositionSize } = load('invPositionSize');

const sizing = (o = {}) => invPositionSize({
  portfolioValue: 50000, portfolioCurrency: '₪', fxRate: 2.95,
  pctOfPortfolio: 10, price: 320, stop: 0,
  portfolioTotalUsd: 20000, catCostUsd: 0, catTargetFrac: 0.6,
  cashUsd: 100000, ...o,
});

describe('invPositionSize — shares from a percentage of the portfolio', () => {
  test('reproduces the reference calculation exactly', () => {
    // 50,000₪ × 10% = 5,000₪ ; ÷ 2.95 = $1,694.92 ; ÷ $320 = 5.29 → 5
    const r = sizing();
    assert.equal(Math.round(r.amountUsd * 100) / 100, 1694.92);
    assert.equal(r.shares, 5);
  });

  test('a dollar portfolio is not converted', () => {
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 1694.92, pctOfPortfolio: 100 });
    assert.equal(r.shares, 5, 'the fx rate must not be applied to a $ portfolio');
  });

  test('shares are floored, never rounded up past the budget', () => {
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 1000, pctOfPortfolio: 100, price: 300 });
    assert.equal(r.shares, 3, '3.33 shares must floor to 3');
    assert.ok(r.shares * 300 <= 1000, 'the order can never exceed the budget');
  });

  test('a fraction above half still rounds DOWN, not to the nearest', () => {
    // $570 at $100 is 5.7 shares. Rounding to nearest buys 6 for $600 — $30 more
    // than the budget allows. Only flooring keeps the order inside it.
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 570, pctOfPortfolio: 100, price: 100 });
    assert.equal(r.shares, 5, '5.7 must floor to 5, never round to 6');
    assert.ok(r.positionUsd <= 570, 'the order must never exceed the budget');
  });

  test('the actual percentage reflects the floored share count', () => {
    // The reference calculator stops at the requested %, hiding the gap the
    // rounding leaves. 5 × $320 = $1,600 of a $20,000 portfolio is 8%, not 10%.
    const r = sizing({ portfolioTotalUsd: 20000 });
    assert.equal(r.positionUsd, 1600);
    assert.equal(r.actualPct, 8);
  });

  test('a missing fx rate yields no share count at all', () => {
    // Guessing a rate here would size a real order off an invented number.
    for (const bad of [0, null, undefined, NaN]) {
      const r = sizing({ fxRate: bad });
      assert.equal(r.shares, null, `rate ${bad} must not produce a quantity`);
      assert.equal(r.error, 'no-fx');
    }
  });

  test('a dollar portfolio still works with no fx rate', () => {
    const r = sizing({ portfolioCurrency: '$', fxRate: null, portfolioValue: 1000, pctOfPortfolio: 100, price: 100 });
    assert.equal(r.shares, 10, 'no conversion is needed, so no rate is needed');
    assert.equal(r.error, null);
  });
});

describe('invPositionSize — the three caps', () => {
  test('flags a buy that overshoots the category target', () => {
    // Blue target 60% of $20,000 = $12,000, already $11,800 deep: $200 of room.
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 10,
                       price: 100, catCostUsd: 11800 });
    assert.equal(r.catRoomUsd, 200);
    assert.equal(r.withinTarget, false);
    assert.equal(r.maxSharesByTarget, 2);
  });

  test('a stop reports what it costs at the sized quantity', () => {
    // stop $80 on a $100 entry risks $20/share; 20 shares is $400, i.e. 2% of a
    // $20,000 portfolio. Reported, not enforced — sizing no longer caps on it.
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 10,
                       price: 100, stop: 80 });
    assert.equal(r.riskUsd, 400);
    assert.equal(r.riskPct, 2);
  });

  test('no stop means no risk figure', () => {
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 10, price: 100 });
    assert.equal(r.riskUsd, null);
    assert.equal(r.riskPct, null);
  });

  test('a stop above the entry price is ignored rather than negated', () => {
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 10,
                       price: 100, stop: 120 });
    assert.equal(r.riskUsd, null, 'a stop above entry is not a -$20/share gain');
  });

  test('cash on hand caps the suggestion', () => {
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 50,
                       price: 100, cashUsd: 450 });
    assert.equal(r.maxSharesByCash, 4);
    assert.equal(r.withinCash, false);
  });

  test('the suggestion is the tighter of the two caps', () => {
    // target room 2000 -> 20 shares, cash 700 -> 7. Cash wins.
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 50,
                       price: 100, stop: 80, catCostUsd: 10000, cashUsd: 700 });
    assert.equal(r.maxSharesByTarget, 20);
    assert.equal(r.maxSharesByCash, 7);
    assert.equal(r.suggestedShares, 7);
  });

  test('a fully allocated category suggests nothing rather than a negative', () => {
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 10,
                       price: 100, catCostUsd: 99999 });
    assert.equal(r.suggestedShares, 0);
    assert.ok(r.maxSharesByTarget >= 0, 'an overfull category must not go negative');
  });
});

describe('invAccumulate / invDonutPcts — uncategorised holdings', () => {
  test('a holding with no category lands in its own bucket, not nowhere', () => {
    // It counts toward totalCost either way, so excluding it from every bucket
    // made real money invisible in the allocation view.
    const r = invAccumulate([holding({ cat: '' }), holding({ cat: 'blue' })]);
    assert.equal(r.byCat.none, 1000);
    assert.equal(r.byCat.blue, 1000);
    assert.equal(r.byCat.none + r.byCat.blue, r.totalCost, 'buckets must account for all cost');
  });

  test('an unknown category string is bucketed rather than dropped', () => {
    const r = invAccumulate([holding({ cat: 'purple' })]);
    assert.equal(r.byCat.none, 1000);
  });

  test('uncategorised cost takes room on the donut', () => {
    const p = invDonutPcts({ blue: 2000, green: 0, yellow: 0, none: 6000 }, 10000, 10000);
    assert.equal(p.none, 60);
    assert.equal(p.cash, 20, 'cash gets only the 20% the allocations leave');
    assert.ok(p.blue + p.green + p.yellow + p.none + p.cash <= 100.0001);
  });

  test('the ring never sums past 100 even when over-allocated', () => {
    const p = invDonutPcts({ blue: 6000, green: 5500, yellow: 0, none: 3000 }, 10000, 5000);
    assert.equal(p.cash, 0);
    assert.ok(p.blue + p.green + p.yellow + p.none >= 100, 'the overflow is real');
  });
});

// ── Scaling into a position in tranches ─────────────────────────────────────
const { invSplitEntries } = load('invSplitEntries');

describe('invSplitEntries — splitting a buy into N entries', () => {
  test('an even split gives every entry the same size', () => {
    const p = invSplitEntries(60, 100, 3);
    assert.deepEqual(p.map(e => e.shares), [20, 20, 20]);
    assert.deepEqual(p.map(e => e.usd), [2000, 2000, 2000]);
  });

  test('the entries always sum back to the total — never more', () => {
    // 62 / 3 = 20.67. Rounding each tranche up would buy 63 shares: one more
    // than the sizing allowed.
    for (const [total, n] of [[62, 3], [10, 3], [7, 4], [100, 7], [5, 5], [1, 3]]) {
      const p = invSplitEntries(total, 50, n);
      assert.equal(p.reduce((s, e) => s + e.shares, 0), total, `${total} split ${n} ways`);
    }
  });

  test('the remainder goes to the earliest entries, largest first', () => {
    const p = invSplitEntries(10, 100, 3);
    assert.deepEqual(p.map(e => e.shares), [4, 3, 3]);
  });

  test('more entries than shares yields no zero-share entries', () => {
    // Asking to split 2 shares into 5 buys cannot produce 5 real orders.
    const p = invSplitEntries(2, 100, 5);
    assert.equal(p.length, 2);
    assert.ok(p.every(e => e.shares > 0));
  });

  test('one entry is the whole position', () => {
    assert.deepEqual(invSplitEntries(37, 10, 1), [{ shares: 37, usd: 370 }]);
  });

  test('zero shares or a nonsense count yields nothing rather than NaN', () => {
    for (const args of [[0, 100, 3], [10, 100, 0], [10, 100, -2], [null, 100, 3]]) {
      const p = invSplitEntries(...args);
      assert.ok(Array.isArray(p) && p.length === 0, `args ${JSON.stringify(args)}`);
    }
  });
});

// ── Reading the typed portfolio total ───────────────────────────────────────
const { invParseTotal } = load('invParseTotal');

describe('invParseTotal — the total is typed, not picked', () => {
  test('thousands separators survive', () => {
    // The field is type="text" so the user can type "32,253". `+"32,253"` is
    // NaN, and NaN||0 is 0 — which blanked every bar, every percent and the
    // free-cash figure on the whole panel.
    assert.equal(invParseTotal('32,253'), 32253);
    assert.equal(invParseTotal('100,000'), 100000);
    assert.equal(invParseTotal('1,234,567'), 1234567);
  });

  test('a plain number is unchanged', () => {
    assert.equal(invParseTotal('32253'), 32253);
    assert.equal(invParseTotal('32253.75'), 32253.75);
    assert.equal(invParseTotal(32253), 32253);
  });

  test('currency marks and spaces are stripped', () => {
    for (const raw of ['$32,253', '₪32,253', ' 32,253 ']) {
      assert.equal(invParseTotal(raw), 32253, raw);
    }
  });

  test('nothing usable reads as zero, never NaN', () => {
    for (const raw of ['', null, undefined, 'abc', '-5', '1.2.3']) {
      const v = invParseTotal(raw);
      assert.ok(Number.isFinite(v) && v >= 0, `${raw} → ${v}`);
    }
  });
});

// ── What the stop costs on each tranche ─────────────────────────────────────
const { invTrancheRisk } = load('invTrancheRisk');

describe('invTrancheRisk — loss at the stop, per entry', () => {
  test('each entry loses its own shares times the stop distance', () => {
    const parts = invSplitEntries(60, 100, 3);
    const risk = invTrancheRisk(parts, 100, 95);
    assert.deepEqual(risk.map(r => r.loss), [100, 100, 100]);
  });

  test('the cumulative loss is what is on the line after each fill', () => {
    // The stop does not wait for the last entry. After two of three tranches
    // are filled, a stop hit costs both of them — showing only the per-tranche
    // number would understate the exposure at every point but the first.
    const parts = invSplitEntries(60, 100, 3);
    const risk = invTrancheRisk(parts, 100, 95);
    assert.deepEqual(risk.map(r => r.cum), [100, 200, 300]);
  });

  test('the total loss matches sizing the whole position at once', () => {
    const parts = invSplitEntries(37, 20, 4);
    const risk = invTrancheRisk(parts, 20, 18);
    assert.equal(risk[risk.length - 1].cum, 37 * 2);
  });

  test('an uneven split charges the bigger first entry more', () => {
    const parts = invSplitEntries(10, 100, 3);   // 4 / 3 / 3
    const risk = invTrancheRisk(parts, 100, 90);
    assert.deepEqual(risk.map(r => r.loss), [40, 30, 30]);
  });

  test('no stop, or a stop at or above entry, states no loss at all', () => {
    const parts = invSplitEntries(60, 100, 3);
    for (const stop of [0, null, undefined, 100, 120, -5]) {
      assert.deepEqual(invTrancheRisk(parts, 100, stop), [], `stop ${stop}`);
    }
  });
});

describe('invPositionSize — hostile price input', () => {
  test('a negative price is refused, not turned into negative shares', () => {
    // min="0" on the input is not enforced. Unguarded this produced shares:-200
    // with a positive $10,000 position, and suggestedShares then exceeded two caps.
    const r = sizing({ portfolioCurrency: '$', portfolioValue: 100000, pctOfPortfolio: 10, price: -50 });
    assert.equal(r.shares, null);
    assert.equal(r.error, 'no-price');
  });

  test('a non-finite price is refused rather than rendering NaN', () => {
    for (const bad of [Infinity, -Infinity, NaN]) {
      const r = sizing({ portfolioCurrency: '$', portfolioValue: 100000, pctOfPortfolio: 10, price: bad });
      assert.equal(r.shares, null, `price ${bad}`);
      assert.equal(r.error, 'no-price');
    }
  });

  test('the suggestion never exceeds any individual cap', () => {
    for (const price of [1, 7.5, 100, 999]) {
      const r = sizing({ portfolioCurrency: '$', portfolioValue: 20000, pctOfPortfolio: 50,
                         price, stop: price * 0.9, catCostUsd: 3000, cashUsd: 5000 });
      for (const cap of ['maxSharesByTarget', 'maxSharesByCash']) {
        if (r[cap] !== null) assert.ok(r.suggestedShares <= r[cap], `${cap} at price ${price}`);
      }
      assert.ok(r.suggestedShares >= 0);
    }
  });
});

describe('allocation basis — invested and cash close at 100%', () => {
  test('value-based buckets plus cash fill the ring exactly', () => {
    // The whole point of moving off cost basis: on cost, a portfolio holding
    // unrealised gains left a slice of the ring belonging to nothing.
    const r = invAccumulate([
      holding({ cat: 'blue',  entryShares: 10, entryPrice: 100, currentPrice: 150 }),
      holding({ cat: 'green', entryShares: 10, entryPrice: 100, currentPrice: 120 }),
    ]);
    const total = 5000;
    const cash = Math.max(0, total - r.totalCurrentValue);
    const p = invDonutPcts(r.byCatValue, total, cash);
    const sum = p.blue + p.green + p.yellow + p.none + p.cash;
    assert.ok(Math.abs(sum - 100) < 1e-9, `ring sums to ${sum}, not 100`);
  });

  test('cost basis is what understated a category that had run up', () => {
    // Guards the reason for the change: 79% by value vs 57.6% by cost was the
    // gap that let the panel invite a buy into an over-weight category.
    const r = invAccumulate([holding({ cat: 'blue', entryShares: 10, entryPrice: 100, currentPrice: 150 })]);
    assert.equal(r.byCat.blue, 1000);
    assert.equal(r.byCatValue.blue, 1500);
    assert.ok(r.byCatValue.blue > r.byCat.blue);
  });
});

// ── Realtime echo suppression ───────────────────────────────────────────────
// Suppression exists so a tab ignores the echo of its own write. It used to be
// one shared window for every table, which meant a trades sync also muted the
// investments and missed handlers: a genuine change from another device that
// landed inside someone else's window was dropped and never reloaded.
const rt = () => load('_rtSuppressUntil', '_rtSuppress', '_rtMuted');
const TABLES = ['trades', 'missed_opportunities', 'investments'];

describe('realtime suppression is per table', () => {
  test('a write mutes its own table', () => {
    for (const t of TABLES) {
      const m = rt();
      m._rtSuppress(t);
      assert.equal(m._rtMuted(t), true, t);
    }
  });

  test('a write never mutes another table', () => {
    for (const written of TABLES) {
      const m = rt();
      m._rtSuppress(written);
      for (const other of TABLES.filter(t => t !== written)) {
        assert.equal(m._rtMuted(other), false,
          `writing ${written} must not mute ${other}`);
      }
    }
  });

  test('nothing is muted before any write', () => {
    const m = rt();
    for (const t of TABLES) assert.equal(m._rtMuted(t), false, t);
  });

  test('the window expires', () => {
    const m = rt();
    m._rtSuppress('trades', -1);
    assert.equal(m._rtMuted('trades'), false, 'an elapsed window no longer mutes');
  });

  test('a longer window is not shortened by a later short one', () => {
    // Two writes in flight: the second must not cut the first one's window
    // short, or the first write's echo arrives unsuppressed and reloads.
    const m = rt();
    m._rtSuppress('trades', 10000);
    m._rtSuppress('trades', 1);
    assert.equal(m._rtMuted('trades'), true);
  });

  test('an unknown table reads as not muted rather than throwing', () => {
    const m = rt();
    assert.equal(m._rtMuted('no_such_table'), false);
  });
});

// ── flexParseXML: the two merge paths must agree ────────────────────────────
// ibOrderID is authoritative when present and the time/price heuristic is the
// fallback, so the same statement has to parse identically either way. Where
// they disagree, one of them is wrong — and it was the authoritative one.
const stripOrderIds = x => x.replace(/ ibOrderID="[^"]*"/g, '');

describe('flexParseXML — order id and heuristic agree', () => {
  // Selling 100 against a 60-share long: IBKR reports one "C" fill for 60 and
  // one "O" fill for 40 under a single ibOrderID.
  const reversal = xmlOf(
    fill({ tradeID: 'p0', ibOrderID: '900', buySell: 'BUY',  quantity: '60', tradePrice: '10',
           dateTime: '20260801;093000', openCloseIndicator: 'O' }),
    fill({ tradeID: 'p1', ibOrderID: '901', buySell: 'SELL', quantity: '60', tradePrice: '11',
           dateTime: '20260801;150000', openCloseIndicator: 'C' }),
    fill({ tradeID: 'p2', ibOrderID: '901', buySell: 'SELL', quantity: '40', tradePrice: '11',
           dateTime: '20260801;150000', openCloseIndicator: 'O' }),
  );

  const shape = out => out.map(t => [t.symbol, t.ls, t.shares, t.entryPrice, t.closedShares || 0, !!t._orphanClose]);

  test('a reversal order opens the new side instead of a phantom close', () => {
    const out = flexParseXML(reversal);
    assert.equal(out.length, 2);
    assert.deepEqual(shape(out), [['TST', 'L', 60, 10, 60, false], ['TST', 'S', 40, 11, 0, false]]);
  });

  test('the order-id path matches the heuristic path exactly', () => {
    assert.deepEqual(shape(flexParseXML(reversal)), shape(flexParseXML(stripOrderIds(reversal))));
  });

  test('opposite sides sharing one order id are not welded together', () => {
    // Grouping on the id alone turned a completed round trip into a single
    // 100-share long at the average of the two prices.
    const out = flexParseXML(xmlOf(
      fill({ tradeID: 'q1', ibOrderID: '5', buySell: 'BUY',  quantity: '50', tradePrice: '10',
             dateTime: '20260801;100000', openCloseIndicator: 'O' }),
      fill({ tradeID: 'q2', ibOrderID: '5', buySell: 'SELL', quantity: '50', tradePrice: '11',
             dateTime: '20260801;100001', openCloseIndicator: 'C' }),
    ));
    assert.equal(out.length, 1);
    assert.equal(out[0].shares, 50, 'a buy and a sell must not merge into 100 shares');
    assert.equal(out[0].exitPrice, 11, 'the round trip must close, not stay open');
  });
});

describe('flexParseXML — rows that are not positions', () => {
  test('an FX pair is rejected even with no assetCategory attribute', () => {
    // Flex only emits assetCategory when "Asset Class" is selected, so the
    // category test fails open and USD.ILS came back as a 3014-share holding.
    const bare = '<FlexQueryResponse><Trade symbol="USD.ILS" dateTime="20260806;100000" ' +
                 'buySell="BUY" quantity="3014" tradePrice="3.31" tradeID="x1" /></FlexQueryResponse>';
    assert.deepEqual(flexParseXML(bare), []);
  });

  test('a real ticker containing a dot still imports', () => {
    assert.equal(flexParseXML(xmlOf(fill({ symbol: 'BRK.B' })))[0].symbol, 'BRK.B');
  });
});

describe('flexParseXML — a dateTime with no time part', () => {
  test('same-day fills at different prices are not merged without a clock', () => {
    // No time part parses to second 0 for every fill, so the <=2s proximity
    // test passes trivially and the merge degrades to "same day, near price".
    const out = flexParseXML(xmlOf(
      fill({ tradeID: 'w1', dateTime: '20260806', quantity: '100', tradePrice: '10.00', openCloseIndicator: 'O' }),
      fill({ tradeID: 'w2', dateTime: '20260806', quantity: '100', tradePrice: '10.01', openCloseIndicator: 'O' }),
    ));
    assert.equal(out.length, 2, 'two deliberate entries must stay two');
  });
});

// ── saveTrade's closed-volume guards ────────────────────────────────────────
// saveTrade is welded to the DOM and Supabase, so these are guard checks: they
// prove the conditions were not deleted, not that the behaviour is right.
describe('saveTrade guards the closed-volume invariants', () => {
  const src = extractFunction('saveTrade');

  test('still rejects closing more than was bought', () => {
    assert.match(src, /\(\+data\.closedShares \|\| 0\) > \(\+data\.shares \|\| 0\)/);
  });

  test('rejects a closed row whose volume is unaccounted for', () => {
    // The mirror of the above, which understates instead of overstating: a row
    // reads as closed everywhere while P&L covers only part of the position.
    assert.match(src, /data\.closeDate && \+data\.exitPrice > 0 && !legShares/);
    assert.match(src, /\(\+data\.closedShares \|\| 0\) < \(\+data\.shares \|\| 0\)/);
  });

  test('rejects partial legs that exceed the closed volume', () => {
    // calcPL derives the final leg as closedShares - sum(legs); a negative
    // result is skipped, so the surplus leg vanishes from P&L.
    assert.match(src, /legShares > \(\+data\.closedShares \|\| \+data\.shares \|\| 0\)/);
  });
});

// ── Open positions must not be counted as results ───────────────────────────
// calcTotal on an open position is -commission. stats() has excluded those
// since it was written; the calendar, the day modal, the overview trend and the
// cumulative chart all summed unfiltered, so opening a position made the month
// slightly negative and the equity curve step down.
describe('aggregations count realised P&L only', () => {
  const open   = { ls:'L', entryDate:'2026-02-03', entryPrice:10, shares:100, closedShares:null, exitPrice:null, commission:2.5, ecn:0, t:[] };
  const closed = { ls:'L', entryDate:'2026-02-04', closeDate:'2026-02-05', entryPrice:10, shares:100, closedShares:100, exitPrice:11, commission:2.5, ecn:0, t:[] };

  test('an open position scores as a loss when counted', () => {
    // The premise of the bug: this is why an unfiltered sum drifts.
    assert.equal(calcTotal(open), -2.5);
    assert.equal(isClosed(open), false);
    assert.equal(isClosed(closed), true);
  });

  test('the calendar sums only closed trades', () => {
    const src = extractFunction('renderCalendar');
    assert.match(src, /const realised = arr => arr\.filter\(isClosed\)/);
    assert.match(src, /realised\(allMonthTrades\)\.reduce/, 'month total');
    assert.match(src, /realised\(dt\)\.reduce/,             'day cell');
    assert.match(src, /realised\(wTrades\)\.reduce/,        'week total');
    assert.match(src, /realised\(allMonthTrades\)\.filter\(t => calcTotal\(t\) > 0\)/, 'win count');
  });

  test('the day modal, the trend and the equity curve filter too', () => {
    assert.match(extractFunction('showCalDayModal'), /all\.filter\(isClosed\)\.reduce/);
    assert.match(extractFunction('renderOverview'),  /trades\.filter\(isClosed\)\.forEach/);
    assert.match(extractFunction('renderCumChart'),  /trades\.filter\(isClosed\)\.forEach/);
  });
});

// ── The statistics screen must use one closed-test ──────────────────────────
// stats() and advancedStats() filter on isClosed(); renderStatistics built its
// own `closed` array from `exitPrice > 0 && closedShares > 0`. Both feed KPIs
// shown side by side, so a row accepted by one test and not the other made
// win-rate and profit-factor describe different sets of trades.
describe('statistics KPIs share one population', () => {
  const { advancedStats } = load('calcPL', 'calcTotal', 'isClosed', 'tradeDays', 'advancedStats');

  test('renderStatistics filters with isClosed', () => {
    const src = extractFunction('renderStatistics');
    assert.match(src, /const closed\s+= trades\.filter\(isClosed\)/);
    assert.doesNotMatch(src, /exitPrice > 0 && t\.closedShares > 0/);
  });

  test('a partial close counts for both, not just one', () => {
    // Closed by isClosed (it has legs) but carries no exitPrice, so the old
    // renderStatistics test dropped it out of profit-factor and drawdown while
    // stats() still counted it in the win rate.
    const partial = { ls:'L', entryDate:'2026-03-02', entryPrice:10, shares:100,
                      closedShares:40, exitPrice:null, commission:0, ecn:0,
                      t:[{ shares:40, price:12 }] };
    assert.equal(isClosed(partial), true);
    assert.equal(stats([partial]).nClosed, 1);
    assert.ok(calcTotal(partial) > 0);
  });

  test('break-even is a loss for the win rate and for avgLoss alike', () => {
    const flat = { ls:'L', entryDate:'2026-03-03', closeDate:'2026-03-04', entryPrice:10,
                   shares:100, closedShares:100, exitPrice:10, commission:0, ecn:0, t:[] };
    const win  = { ls:'L', entryDate:'2026-03-05', closeDate:'2026-03-06', entryPrice:10,
                   shares:100, closedShares:100, exitPrice:11, commission:0, ecn:0, t:[] };
    const loss = { ls:'L', entryDate:'2026-03-07', closeDate:'2026-03-08', entryPrice:10,
                   shares:100, closedShares:100, exitPrice:9, commission:0, ecn:0, t:[] };
    assert.equal(calcTotal(flat), 0);
    const rows = [flat, win, loss];
    const st  = stats(rows);
    const adv = advancedStats(rows);
    assert.equal(st.losses, 2, 'break-even counts against the win rate');
    // Expectancy is wr*avgWin + (1-wr)*avgLoss, and both halves have to agree
    // on who the losers are. With avgLoss averaged over < 0 only, the flat
    // trade shrank the win rate to 1/3 while the remaining 2/3 was charged at
    // the full -100 of the one real loss — a trade that cost nothing was
    // priced as an average-sized loser.
    assert.equal(adv.avgLoss, -50, 'the flat trade dilutes the average loss');
    assert.ok(Math.abs((st.wr / 100 * adv.avgWin) + ((1 - st.wr / 100) * adv.avgLoss)) < 1e-9);
  });
});

describe('Interactive Israel (TLG) file import', () => {
  // tlgParse is welded to the DOM only for its status/preview elements, and it
  // stores the parsed trades on window before touching either — so with those
  // stubbed it runs headless and the matching can be tested for real.
  const runTlg = text => {
    const win = {};
    const factory = new Function('document', 'window', 'calcPL',
      `${extractFunction('tlgParse')}\ntlgParse(arguments[3]); return window._tlgPending;`);
    return factory({ getElementById: () => null }, win, () => 0, text) || [];
  };
  // STK_TRD|OrderID|Symbol|Name|Exchange|Action|OC|Date|Time|Currency|Qty|Mult|Price|Value|Commission
  const tlgFill = (sym, action, oc, date, qty, price, comm, time = '100000') =>
    `STK_TRD|1|${sym}|${sym} Inc|SMART|${action}|${oc}|${date}|${time}|USD|${qty}|1|${price}|0|${comm}|`;

  test('one sell cannot close two separate buys', () => {
    // The matcher bucketed fills into buys/sells and, for every buy, scanned the
    // whole sells list for anything dated on or after it. Nothing was consumed,
    // so both buys closed against the same sell: the P&L and that sell's
    // commission were each counted twice.
    const trades = runTlg([
      tlgFill('AAPL', 'BUY',  'O', '20260801', 100, 100, 1),
      tlgFill('AAPL', 'BUY',  'O', '20260802', 100, 110, 1),
      tlgFill('AAPL', 'SELL', 'C', '20260803', 100, 120, 1),
    ].join('\n'));
    assert.equal(trades.length, 2, 'two buys are two positions');
    const closed = trades.filter(t => t.closedShares > 0);
    assert.equal(closed.length, 1, 'only 100 shares were sold, so only one lot closed');
    assert.equal(trades.reduce((a, t) => a + t.closedShares, 0), 100,
      'total closed volume cannot exceed what was actually sold');
    // FIFO: the first lot is the one that closed.
    assert.equal(closed[0].entryPrice, 100);
    assert.equal(closed[0].exitPrice, 120);
    assert.equal(trades.reduce((a, t) => a + t.commission, 0), 3,
      'each fill is charged once across all the lots it touched');
  });

  test('a lot depletes as it is closed, so it cannot be closed twice', () => {
    // Without decrementing the lot's remaining size, the second sell sees the
    // full original 100 again and closes 60 more — 120 closed against a
    // 100-share position, which is the closed_shares > shares defect that
    // overstates P&L directly.
    const trades = runTlg([
      tlgFill('IBM', 'BUY',  'O', '20260801', 100, 10, 0),
      tlgFill('IBM', 'SELL', 'C', '20260802', 60, 12, 0),
      tlgFill('IBM', 'SELL', 'C', '20260803', 60, 13, 0),
    ].join('\n'));
    const long = trades.find(t => t.ls === 'L');
    assert.equal(long.shares, 100);
    assert.equal(long.closedShares, 100, 'a 100-share lot cannot close 120');
    assert.ok(long.closedShares <= long.shares + 1e-9);
    // The 20 shares the second sell had left over are a new short.
    const short = trades.find(t => t.ls === 'S');
    assert.ok(short, 'the unmatched remainder must open a short, not vanish');
    assert.equal(short.shares, 20);
  });

  test('one fill closing two lots splits its commission between them', () => {
    // The fill is charged a single commission for its whole size. Giving each
    // lot the full amount inflates costs by a factor of however many lots the
    // sell happened to span.
    const trades = runTlg([
      tlgFill('KO', 'BUY',  'O', '20260801', 50, 10, 0),
      tlgFill('KO', 'BUY',  'O', '20260802', 50, 11, 0, '110000'),
      tlgFill('KO', 'SELL', 'C', '20260803', 100, 12, 2),
    ].join('\n'));
    assert.equal(trades.length, 2);
    assert.equal(trades.reduce((a, t) => a + t.commission, 0), 2,
      'the sell was charged $2 once, not $2 per lot it closed');
    assert.equal(trades[0].commission, 1);
    assert.equal(trades[1].commission, 1);
  });

  test('a short position survives the import', () => {
    // ls was hardcoded to 'L' and every SELL went into the sells bucket, so a
    // short never became a position at all.
    const trades = runTlg([
      tlgFill('TSLA', 'SELL', 'O', '20260801', 50, 300, 1),
      tlgFill('TSLA', 'BUY',  'C', '20260802', 50, 280, 1),
    ].join('\n'));
    assert.equal(trades.length, 1);
    assert.equal(trades[0].ls, 'S');
    assert.equal(trades[0].shares, 50);
    assert.equal(trades[0].closedShares, 50);
    assert.equal(trades[0].entryPrice, 300);
    assert.equal(trades[0].exitPrice, 280);
  });

  test('an explicit Open marker never consumes an existing lot', () => {
    const trades = runTlg([
      tlgFill('NVDA', 'BUY',  'O', '20260801', 10, 100, 0),
      tlgFill('NVDA', 'SELL', 'O', '20260802', 10, 120, 0),
    ].join('\n'));
    assert.equal(trades.length, 2, 'the second fill is a new short, not a close');
    assert.equal(trades[1].ls, 'S');
    assert.equal(trades[0].closedShares, 0, 'the long must stay open');
  });

  test('a multi-leg exit leaves the final leg to exitPrice, not targets', () => {
    // closedShares is TOTAL closed volume and calcPL prices the remainder
    // (closedShares - sum(t[].shares)) at exitPrice, so listing every leg as a
    // target makes the remainder zero and the last leg disappears from P&L.
    const trades = runTlg([
      tlgFill('X', 'BUY',  'O', '20260801', 100, 10, 0),
      tlgFill('X', 'SELL', 'C', '20260802',  40, 12, 0),
      tlgFill('X', 'SELL', 'C', '20260803',  60, 14, 0),
    ].join('\n'));
    assert.equal(trades.length, 1);
    const t = trades[0];
    assert.equal(t.closedShares, 100);
    assert.equal(t.exitPrice, 14);
    assert.deepEqual(t.targets, [{ shares: 40, price: 12 }]);
    assert.equal(calcPL({ ...t, t: t.targets }), 320,
      '(12-10)*40 + (14-10)*60 — the final leg must still be priced');
  });

  test('fills are matched chronologically, not in file order', () => {
    const trades = runTlg([
      tlgFill('MU', 'SELL', 'C', '20260805', 10, 120, 0),
      tlgFill('MU', 'BUY',  'O', '20260801', 10, 100, 0, '090000'),
    ].join('\n'));
    assert.equal(trades.length, 1, 'the out-of-order sell still closes the buy');
    assert.equal(trades[0].closedShares, 10);
  });

  test('a partial close leaves the rest of the lot open', () => {
    const trades = runTlg([
      tlgFill('SOFI', 'BUY',  'O', '20260801', 90, 18, 0),
      tlgFill('SOFI', 'SELL', 'C', '20260802', 25, 19, 0),
    ].join('\n'));
    assert.equal(trades.length, 1);
    assert.equal(trades[0].shares, 90);
    assert.equal(trades[0].closedShares, 25);
    assert.equal(trades[0].targets.length, 0, 'a single leg belongs to exitPrice');
  });
});

// The personal STEM model approximates Minervini's, whose public description
// has two components: how many focus-list names closed down over the rolling
// 5-day window, AND how they are cumulatively performing. The first version
// shipped fetched the cumulative figure and then ignored it, so a book where
// only a few names were down but those names were collapsing still read green.
describe('personal STEM regime', () => {
  const { computePersonalStemState } = load('computePersonalStemState');

  test('a collapsing book is red even when few names are down', () => {
    assert.equal(computePersonalStemState(25, -3), 'red',
      'the cumulative-performance half must be able to force red on its own');
  });

  test('green needs both halves: few down AND the book up', () => {
    assert.equal(computePersonalStemState(25, 1.5), 'green');
    assert.equal(computePersonalStemState(25, 0), 'orange',
      'a flat book is not the easy-dollar environment green is meant to mean');
  });

  test('the down-count threshold is the 60% the model actually cites', () => {
    assert.equal(computePersonalStemState(60, 0.1), 'red');
    assert.equal(computePersonalStemState(59, 0.1), 'orange');
  });

  test('no data reads as unknown rather than a regime', () => {
    assert.equal(computePersonalStemState(null, null), null);
  });
});

// A market-environment model read off one or two symbols is that stock's week
// restated as a market verdict. The watchlist is empty for most users and the
// journal may hold a single open position, which is exactly the case that
// produced a confident-looking "100% positive" off n=1 in production.
describe('personal STEM sample size', () => {
  const { computePersonalStemState, PSTEM_MIN_SAMPLE } = load('PSTEM_MIN_SAMPLE', 'computePersonalStemState');

  test('a single-symbol focus list cannot produce a regime', () => {
    assert.equal(computePersonalStemState(0, 2.4, 1), 'thin',
      'n=1 at 100% positive is the exact case that shipped as a green "working" reading');
  });

  test('the guard lifts once the list is big enough', () => {
    assert.equal(computePersonalStemState(0, 2.4, PSTEM_MIN_SAMPLE), 'green');
    assert.equal(computePersonalStemState(0, 2.4, PSTEM_MIN_SAMPLE - 1), 'thin');
  });

  test('a thin sample outranks the regime thresholds', () => {
    assert.equal(computePersonalStemState(100, -9, 2), 'thin',
      'even an unambiguous red must not be reported off two symbols');
  });
});

// The live P&L card refetched quotes every 60s around the clock, including all
// night and all weekend when a US equity quote cannot move. The closed-market
// shortcut depends entirely on this predicate being right, including across the
// EST/EDT switch — a hardcoded UTC offset would silently drift by an hour.
describe('US market hours', () => {
  const { _isUSMarketOpen } = load('_isUSMarketOpen');
  const at = iso => _isUSMarketOpen(new Date(iso));

  test('the session opens at 09:30 ET, not before', () => {
    assert.equal(at('2026-08-26T13:25:00Z'), false, '09:25 ET is pre-market');
    assert.equal(at('2026-08-26T13:35:00Z'), true,  '09:35 ET is open');
  });

  test('the session closes at 16:00 ET', () => {
    assert.equal(at('2026-08-26T19:59:00Z'), true);
    assert.equal(at('2026-08-26T20:01:00Z'), false);
  });

  test('weekends are closed', () => {
    assert.equal(at('2026-08-29T15:00:00Z'), false, 'Saturday');
    assert.equal(at('2026-08-30T15:00:00Z'), false, 'Sunday');
  });

  test('daylight saving is handled by the timezone, not an offset', () => {
    assert.equal(at('2026-01-14T15:00:00Z'), true,
      '10:00 ET in January (EST) — a fixed EDT offset would read this as 11:00 and still pass, ' +
      'so pair it with the pre-open case below');
    assert.equal(at('2026-01-14T14:25:00Z'), false, '09:25 EST is pre-market');
  });

  test('midnight does not read as hour 24', () => {
    assert.equal(at('2026-08-26T04:00:00Z'), false);
  });
});

// A partial close leaves the rest of the lot open, so a row can be closed (it
// has realised P&L) and open (it still holds stock) at the same time. The
// open-position views tested `!exitPrice`, so setting any exit price at all made
// the still-held remainder invisible to live P&L, the STEM focus list and the
// exposure alert. Verified against raw IBKR Flex XML 2026-08-27: CRWV held 20
// shares while the journal's open-position views could only see 12.
describe('open positions include partial closes', () => {
  const { openShares, isOpenPosition } = load('openShares', 'isOpenPosition');
  const row = o => ({ symbol: 'CRWV', entryPrice: 99.77, shares: 15, ...o });

  test('a partially closed row is still an open position', () => {
    const t = row({ closedShares: 7, exitPrice: 102.82 });
    assert.equal(openShares(t), 8);
    assert.equal(isOpenPosition(t), true,
      'an exit price on a partial close must not hide the 8 shares still held');
  });

  test('a fully closed row is not an open position', () => {
    assert.equal(isOpenPosition(row({ closedShares: 15, exitPrice: 102.82 })), false);
  });

  test('an untouched position is open, with no closedShares recorded', () => {
    assert.equal(openShares(row({})), 15);
    assert.equal(isOpenPosition(row({})), true);
  });

  test('deleted, unnamed and zero-price rows are never open positions', () => {
    assert.equal(isOpenPosition(row({ deleted: true })), false);
    assert.equal(isOpenPosition(row({ symbol: '' })), false);
    assert.equal(isOpenPosition(row({ entryPrice: 0 })), false);
  });

  test('closing more than was bought does not read as a negative open position', () => {
    assert.equal(isOpenPosition(row({ closedShares: 20 })), false);
  });
});

// The Kelly suggestion writes straight into the position sizer, so an inverted
// or mis-signed result recommends a LARGER position off a worse edge — the one
// failure mode here that costs real money. f* = W - (1-W)/R, halved.
describe('Kelly position sizing', () => {
  const { kellyHalfPct } = load('kellyHalfPct');

  test('reproduces the textbook fraction, halved', () => {
    // W=0.6, R=2 -> f* = 0.6 - 0.4/2 = 0.4 -> half-Kelly 20% -> capped at 10%
    assert.equal(kellyHalfPct(60, 200, -100), 10);
    // W=0.5, R=2 -> f* = 0.5 - 0.5/2 = 0.25 -> half-Kelly 12.5% -> capped
    assert.equal(kellyHalfPct(50, 200, -100), 10);
    // W=0.4, R=2 -> f* = 0.4 - 0.6/2 = 0.10 -> half-Kelly 5%, under the cap
    assert.ok(Math.abs(kellyHalfPct(40, 200, -100) - 5) < 1e-9);
  });

  test('a losing edge suggests nothing rather than the floor', () => {
    // W=0.3, R=1 -> f* = 0.3 - 0.7 = -0.4. Returning the 0.1% floor here would
    // recommend sizing into a system with negative expectancy.
    assert.equal(kellyHalfPct(30, 100, -100), null);
    assert.equal(kellyHalfPct(50, 100, -300), null, 'break-even-or-worse R');
  });

  test('a better edge never suggests a smaller size', () => {
    const worse = kellyHalfPct(45, 150, -100);
    const better = kellyHalfPct(55, 150, -100);
    assert.ok(better > worse, `${better} should exceed ${worse} — an inversion would flip these`);
  });

  test('the suggestion is always inside the sizer input range', () => {
    for (const [w, win, loss] of [[41, 110, -100], [70, 400, -100], [50, 101, -100]]) {
      const p = kellyHalfPct(w, win, loss);
      if (p === null) continue;
      assert.ok(p >= 0.1 && p <= 10, `${p}% is outside the 0.1-10 the input accepts`);
    }
  });

  test('missing or nonsense inputs yield nothing, never NaN', () => {
    assert.equal(kellyHalfPct(50, 100, 0), null, 'no losses recorded yet');
    assert.equal(kellyHalfPct(NaN, 100, -100), null);
    assert.equal(kellyHalfPct(150, 100, -100), null, 'a win rate over 100%');
  });
});

// The market-wide risk gauge (VIX + % of the 11 SPDR sectors above their own
// 50-day SMA). Distinct from the personal STEM above: this one reads indices,
// not the trader's focus list. breadthPct replaced CNN's McClellan-based rating
// on 2026-08-26 — the old field was a different metric wearing the same name.
describe('market risk regime', () => {
  const { computeStemState } = load('computeStemState');

  test('a VIX spike is red on its own', () => {
    assert.equal(computeStemState(35, 80), 'red', 'high VIX outranks healthy breadth');
  });

  test('collapsing breadth is red even with a calm VIX', () => {
    assert.equal(computeStemState(14, 35), 'red');
  });

  test('green needs calm VIX and broad participation together', () => {
    assert.equal(computeStemState(15, 72), 'green');
    assert.equal(computeStemState(15, 50), 'orange', 'calm but narrow is not green');
    assert.equal(computeStemState(25, 72), 'orange', 'broad but jumpy is not green');
  });

  test('no VIX reading means no regime at all', () => {
    assert.equal(computeStemState(null, 72), null);
  });

  test('a missing breadth reading never fabricates green', () => {
    assert.equal(computeStemState(15, null), 'orange',
      'without breadth the calm-VIX half alone must not clear the bar');
  });
});


describe('missedFollowThrough', () => {
  const { missedFollowThrough } = load('missedFollowThrough');

  test('finds the earliest trade on the same symbol after the missed date', () => {
    const missed = { sym: 'AAPL', date: '2026-01-05' };
    const trades = [
      { symbol: 'AAPL', entryDate: '2026-02-10' },
      { symbol: 'AAPL', entryDate: '2026-01-20' },
      { symbol: 'MSFT', entryDate: '2026-01-10' },
    ];
    assert.deepEqual(missedFollowThrough(missed, trades), { symbol: 'AAPL', entryDate: '2026-01-20' });
  });

  test('a trade on or before the missed date does not count as follow-through', () => {
    const missed = { sym: 'AAPL', date: '2026-01-05' };
    const trades = [{ symbol: 'AAPL', entryDate: '2026-01-05' }, { symbol: 'AAPL', entryDate: '2025-12-01' }];
    assert.equal(missedFollowThrough(missed, trades), null);
  });

  test('no matching symbol at all returns null', () => {
    assert.equal(missedFollowThrough({ sym: 'NVDA', date: '2026-01-05' }, [{ symbol: 'AAPL', entryDate: '2026-02-01' }]), null);
  });
});

// ── The live P&L card must always end up with a value on screen ─────────────
// Two calls that overlap (loadDB's renderOverview, then the broker auto-sync's
// renderOverview a moment later) could cancel each other: the second bumped
// _livePLToken and then bailed out at the freshness guard without writing, and
// the first — the only one that was going to paint — saw its token had moved on
// and returned silently. The card sat on "מחשב..." forever, and because the
// cache is only written on a successful paint, every later session repeated it.
describe('live P&L never leaves the card on its placeholder', () => {
  const PLACEHOLDER = 'kpi_calculating';

  function makeCard({ marketOpen = true } = {}) {
    // extractFunction() slices from the `function` keyword, dropping the
    // leading `async` — put it back or the body's awaits are a syntax error.
    const src = 'async ' + extractFunction('_updateLivePL');
    const el  = { textContent: PLACEHOLDER, className: '' };
    const sub = { textContent: '' };
    const els = { 'kpi-live-pl': el, 'kpi-live-sub': sub,
                  'tab-overview': { classList: { contains: () => true } } };
    let releaseFetch;
    const gate = new Promise(r => { releaseFetch = r; });
    const scope = {
      document: { getElementById: id => els[id] || null, hidden: false },
      db: { stocks: [{ symbol: 'AAPL', shares: 10, closedShares: 0, entryPrice: 100, ls: 'L', type: 'stock' }], crypto: [] },
      isOpenPosition: () => true,
      _isUSMarketOpen: () => marketOpen,
      _readLivePLCache: () => null,
      _writeLivePLCache: () => {},
      _paintLivePL: (e, s, total) => { e.textContent = String(total); },
      _getToken: async () => 'tok',
      t: k => k,
      SUPABASE_URL: 'https://example.test',
      fetch: async () => { await gate; return { json: async () => ({ AAPL: { c: 110 } }) }; },
      _LIVE_PL_MIN_INTERVAL: 20000,
      _LIVE_PL_CLOSED_INTERVAL: 900000,
    };
    const names = Object.keys(scope);
    const factory = new Function(...names,
      `let _livePLToken = 0, _lastLivePLTs = 0, _lastLivePLSymbols = '';\n${src}\nreturn _updateLivePL;`);
    return { update: factory(...names.map(n => scope[n])), el, sub, releaseFetch };
  }

  const settle = () => new Promise(r => setTimeout(r, 0));

  test('a second overlapping call does not cancel the one that paints', async () => {
    const { update, el, releaseFetch } = makeCard();
    const first = update();          // loadDB's renderOverview
    await settle();                  // it has stamped the freshness marker and is awaiting the quote
    const second = update();         // the broker auto-sync's renderOverview
    releaseFetch();
    await Promise.all([first, second]);
    assert.notEqual(el.textContent, PLACEHOLDER,
      'card still shows the "calculating" placeholder — both calls returned without writing');
    assert.equal(el.textContent, '100');   // 10 shares × (110 − 100)
  });

  test('a closed market does not keep the placeholder up either', async () => {
    const { update, el, releaseFetch } = makeCard({ marketOpen: false });
    const first = update();
    await settle();
    const second = update(true);
    releaseFetch();
    await Promise.all([first, second]);
    assert.notEqual(el.textContent, PLACEHOLDER);
  });

  test('a single uncontested call still paints', async () => {
    const { update, el, releaseFetch } = makeCard();
    releaseFetch();
    await update();
    assert.equal(el.textContent, '100');
  });
});
