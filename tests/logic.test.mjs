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
