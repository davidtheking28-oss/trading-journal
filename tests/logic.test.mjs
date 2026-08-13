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
import { load, extractFunction } from './harness.mjs';

const { flexParseXML } = load('flexParseXML');
const { calcPL, calcTotal } = load('calcPL', 'calcTotal');
const { isClosed } = load('isClosed');
const { calcRisk } = load('calcRisk');
const { tradeDays } = load('tradeDays');
const { calcStopRisk } = load('calcStopRisk');
const { stats } = load('calcPL', 'calcTotal', 'isClosed', 'stats');

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
    assert.match(importSrc, /t\.closedShares\s*\|\|\s*0\)\s*<=\s*\(open\.shares/,
      'the candidates[0] fallback must be size-guarded');
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
