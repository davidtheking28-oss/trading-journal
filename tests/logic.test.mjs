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

  test('the trading-summary table on the same screen agrees', () => {
    // Its own win rate sat directly under the KPI one and was computed over a
    // different set of rows, so the two could disagree by a few points.
    const src = extractFunction('renderTradingSummary');
    assert.ok(src.includes('const closed = trades.filter(isClosed);'));
    assert.ok(src.includes('const losers  = closed.filter(t => calcTotal(t) <= 0);'));
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

// Historical win-rate-by-regime insight (Overview tab). There is no stored
// history of the real STEM state (breadth was never logged per day), so this
// is a disclosed VIX-only approximation against CNN's own ~1-year daily VIX
// series — not the same classifier as computeStemState above.
describe('VIX-only historical regime approximation', () => {
  const { vixApproxStemBucket, _nearestVixOnOrBefore, vixApproxStemStats } =
    load('vixApproxStemBucket', '_nearestVixOnOrBefore', 'vixApproxStemStats');

  test('buckets mirror computeStemState\'s VIX-only fallback thresholds', () => {
    assert.equal(vixApproxStemBucket(35), 'red');
    assert.equal(vixApproxStemBucket(30.1), 'red');
    assert.equal(vixApproxStemBucket(15), 'green');
    assert.equal(vixApproxStemBucket(19.9), 'green');
    assert.equal(vixApproxStemBucket(25), 'orange');
    assert.equal(vixApproxStemBucket(null), null);
  });

  const day = (y, m, d) => Date.UTC(y, m - 1, d);
  const series = [
    { x: day(2026, 1, 5), y: 15 },
    { x: day(2026, 1, 12), y: 32 },
    { x: day(2026, 1, 20), y: 18 },
  ];

  test('reads the most recent prior close, never a later one', () => {
    assert.equal(_nearestVixOnOrBefore(day(2026, 1, 8), series), 15, 'between two points reads the earlier');
    assert.equal(_nearestVixOnOrBefore(day(2026, 1, 12), series), 32, 'exact match reads its own point');
    assert.equal(_nearestVixOnOrBefore(day(2026, 1, 1), series), null, 'before the series starts has no reading');
  });

  test('stats bucket trades by the VIX reading on their entry date and count wins', () => {
    const trades = [
      { entryDate: '2026-01-06', win: true },  // reads Jan-5 close (15) -> green
      { entryDate: '2026-01-07', win: false }, // reads Jan-5 close (15) -> green
      { entryDate: '2026-01-13', win: true },  // reads Jan-12 close (32) -> red
    ];
    const out = vixApproxStemStats(trades, series);
    assert.deepEqual(out.green, { trades: 2, wins: 1 });
    assert.deepEqual(out.red, { trades: 1, wins: 1 });
    assert.deepEqual(out.orange, { trades: 0, wins: 0 });
  });

  test('a trade with no VIX reading available is skipped, not misbucketed', () => {
    const out = vixApproxStemStats([{ entryDate: '2020-01-01', win: true }], series);
    assert.deepEqual(out, { green: { trades: 0, wins: 0 }, orange: { trades: 0, wins: 0 }, red: { trades: 0, wins: 0 } });
  });

  test('no VIX series at all yields empty buckets rather than throwing', () => {
    const out = vixApproxStemStats([{ entryDate: '2026-01-06', win: true }], []);
    assert.deepEqual(out, { green: { trades: 0, wins: 0 }, orange: { trades: 0, wins: 0 }, red: { trades: 0, wins: 0 } });
  });
});

// The custom trade-review chart (replaced a TradingView iframe embed whose
// free tier cannot mark a custom entry/stop/exit price at all). Symbols are
// mapped to Yahoo's ticker convention, and the entry/exit marker is placed on
// the candle nearest the trade's date.
describe('trade chart symbol and marker placement', () => {
  const { _ohlcSymbol } = load('_ohlcSymbol');
  const { _nearestCandleTime } = load('_nearestCandleTime', '_nearestCandleIndex');
  const { _tradeChartSlice } = load('_tradeChartSlice', '_nearestCandleIndex', '_CHART_MIN_SESSIONS', '_CHART_MAX_SESSIONS');
  const { _mergeBars } = load('_mergeBars');

  test('a stock symbol passes through unchanged', () => {
    assert.equal(_ohlcSymbol({ type: 'stock', symbol: 'aapl' }), 'AAPL');
  });

  test('a Bybit perp is rewritten to Yahoo -USD form', () => {
    assert.equal(_ohlcSymbol({ type: 'crypto', symbol: 'XRPUSDT.P' }), 'XRP-USD');
  });

  test('a Bybit spot pair is rewritten the same way', () => {
    assert.equal(_ohlcSymbol({ type: 'crypto', symbol: 'btcusdt' }), 'BTC-USD');
  });

  const candles = [
    { t: Date.parse('2026-02-20T00:00:00Z') / 1000 },
    { t: Date.parse('2026-02-23T00:00:00Z') / 1000 }, // a Monday after a weekend gap
    { t: Date.parse('2026-02-24T00:00:00Z') / 1000 },
  ];

  test('an exact date match wins outright', () => {
    assert.equal(_nearestCandleTime(candles, '2026-02-24'), candles[2].t);
  });

  test('a weekend trade date snaps to the nearest real trading day', () => {
    // 2026-02-22 is a Sunday; no candle exists for it.
    assert.equal(_nearestCandleTime(candles, '2026-02-22'), candles[1].t,
      'Monday the 23rd is one day away; Friday the 20th is two');
  });

  test('no candles or no date yields nothing rather than a wrong guess', () => {
    assert.equal(_nearestCandleTime([], '2026-02-24'), null);
    assert.equal(_nearestCandleTime(candles, null), null);
    assert.equal(_nearestCandleTime(candles, ''), null);
  });

  // A year of daily candles fitted into one view squeezes the handful of bars
  // around an actual trade into an illegible sliver — this zooms to the
  // entry->exit window (with padding) instead.
  const yearCandles = Array.from({ length: 250 }, (_, i) => ({ t: 1_700_000_000 + i * 86400 }));

  const LAST = yearCandles.length - 1;

  // The window is a SLICE of the series, not a logical range over it. Six
  // rounds of "I still can't see the last trading day" were all range
  // arithmetic that kept the newest bar inside the range and still unreadable:
  // with no ceiling the window stretched back to the entry, and a 2-BAR right
  // pad was 25px on a 40-bar chart but 8px on a 130-bar one. Slicing makes the
  // newest bar the last element by construction, and the screener's pixel pad
  // gives the same visual gap at any bar count.
  describe('the chart window is a slice ending at the newest session', () => {
    test('the newest session is always the last element', () => {
      for (const back of [1, 3, 20, 60, 120, 200]) {
        const out = _tradeChartSlice(yearCandles, yearCandles[LAST - back].t);
        assert.equal(out[out.length - 1].t, yearCandles[LAST].t,
          `entry ${back} sessions back must still end on today`);
      }
    });

    test('a fresh entry still gets the full minimum span', () => {
      assert.equal(_tradeChartSlice(yearCandles, yearCandles[LAST - 2].t).length, 46);
    });

    test('an entry inside the ceiling pulls the window back to include it', () => {
      const out = _tradeChartSlice(yearCandles, yearCandles[LAST - 50].t);
      assert.equal(out.length, 57, 'fifty sessions plus six of context');
      assert.equal(out[0].t, yearCandles[LAST - 56].t);
    });

    test('an older entry is capped rather than squeezing every bar', () => {
      // Without the cap this ran back to the entry: measured on the live page,
      // an entry 5 1/2 months back left the newest bar five painted pixels wide,
      // pinned against the price scale.
      assert.equal(_tradeChartSlice(yearCandles, yearCandles[10].t).length, 61);
    });

    test('a series shorter than the window is kept whole', () => {
      const short = yearCandles.slice(0, 12);
      assert.equal(_tradeChartSlice(short, short[0].t).length, 12);
    });

    test('no candles yields nothing rather than throwing', () => {
      assert.deepEqual(_tradeChartSlice([], 1_700_000_000), []);
      assert.deepEqual(_tradeChartSlice(null, 1_700_000_000), []);
    });
  });

  // Guard, not behavioural: CSS layout cannot be exercised headless. Lightweight
  // Charts lays itself out with a <table>, and this sheet has a global
  // `table { width:100%; min-width:1600px }` for the journal's wide data tables.
  // Without a reset scoped to the chart container, that rule stretched the
  // chart's internal table to 1600px inside a ~600px container (measured live:
  // cells of 276/548/776px) and .modal's overflow:hidden clipped the rest, so
  // the chart rendered at roughly half width. Deleting this reset brings that
  // back with no error anywhere.
  test('the chart container resets the global table rules', () => {
    assert.match(SOURCE, /#cal-trade-chart table\s*\{[^}]*min-width:\s*0/,
      'the chart table must opt out of the global min-width:1600px');
    assert.match(SOURCE, /#cal-trade-chart table\s*\{[^}]*width:\s*auto/,
      'the chart table must opt out of the global width:100%');
    assert.match(SOURCE, /#cal-trade-chart td[^{]*\{[^}]*padding:\s*0/,
      'the global td padding must not apply inside the chart');
  });

  // Nine rounds went into "I can't see the last trading day" while every
  // measurement of the bar's POSITION came back correct on both machines —
  // because it was, and for most of them the only real defect was a cached
  // response feeding the chart week-old bars. Neither side could tell those two
  // apart, because nothing on screen said which day any candle was. The readout
  // makes it answerable by pointing; deleting it takes that back.
  test('a readout names the bar under the pointer, defaulting to the newest', () => {
    assert.match(SOURCE, /chart\.subscribeCrosshairMove\(/,
      'the chart must report the hovered bar');
    assert.match(SOURCE, /showBar\(newestPoint\)/,
      'and fall back to the newest bar when nothing is hovered');
    assert.match(SOURCE, /const newestBar = bars\[bars\.length - 1\]/,
      'the default must come from the last bar actually drawn');
    assert.match(SOURCE, /position:relative;width:100%;height:\$\{_CHART_H\}px/,
      'the container must be a positioning context or the readout escapes it');
    assert.match(SOURCE, /el\.addEventListener\('mouseleave', \(\) => showBar\(newestPoint\)\)/,
      'crosshairMove does not always fire on the way out, so the readout would stick');
  });

  // Chart-native `series.setMarkers` labels for entry/exit/date were tried
  // first and technically rendered — confirmed live, magnified 3x, the arrows
  // and the date dot were all there — but Lightweight Charts draws marker text
  // at its own small fixed library font, too faint to register at normal chart
  // size against the candle/grid background. That is what "nothing changed, I
  // still can't see my entry" looks like when the pixels genuinely did change.
  // Real HTML pills, sized like the price-scale badges already on the chart,
  // are unmissable at any zoom, and every one is repositioned each time the
  // chart itself re-fits — same cadence as _watchTradeChart's own re-anchoring,
  // so a resize cannot leave one stranded relative to the bar it labels.
  test('entry and exit are real HTML pills, not library markers', () => {
    assert.doesNotMatch(SOURCE, /series\.setMarkers\(/,
      'no chart-native marker may be relied on for anything that must be readable');
    assert.match(SOURCE, /const _mkTag = \(text, bg, fg\) => \{/,
      'a shared pill constructor must back entry, exit and the date tag alike');
    assert.match(SOURCE, /_mkTag\('↑', accent, '#ffffff'\)/,
      'the entry pill must exist and be colored with the accent — arrow only, no label text, to stay narrow enough not to cover a nearby recent bar');
    assert.match(SOURCE, /_mkTag\('↓ ' \+ t\('tile_exit'\), exitCol, '#ffffff'\)/,
      'the exit pill must exist, colored by win/loss like the arrow it replaces');
    assert.match(SOURCE, /_watchTradeChart\(chart, bars\.length, placeDateTag\)/,
      'placement must run on every fit, not just once at creation');
  });

  // Reported repeatedly as "the recent bars aren't there until I drag right
  // myself". The fit used to call fitContent() and then read back its own
  // barSpacing to compute a pixel pad — but fitContent() ALWAYS fits every bar
  // into whatever width existed the instant it ran, so a "did the newest bar
  // land in view" check on the result can never fail, whether that width was
  // the modal's real final size or a transient one from mid-animation. The
  // check was worthless by construction, which is why it kept passing while
  // the report kept coming back. barSpacing is now solved directly from the
  // container's own clientWidth — the actual laid-out box, synchronously, with
  // no dependency on the chart library's internal state having caught up.
  test('the fit is computed from clientWidth directly, not a fitContent readback', () => {
    assert.doesNotMatch(SOURCE, /function _fitTradeChart[\s\S]{0,50}ts\.fitContent\(\)/,
      'fitContent() must not be the source of truth for the width');
    assert.match(SOURCE, /const w = paneCanvas \? paneCanvas\.getBoundingClientRect\(\)\.width : el\.clientWidth;/,
      'the candle PANE must be measured directly, not the whole container — el.clientWidth includes the price scale column and was proven live to overshoot the pane by ~60px, leaving the newest bar sitting in a gap short of the edge');
    assert.match(SOURCE, /const bs = Math\.max\(0\.5, \(w - _CHART_RIGHT_PAD_PX\) \/ barCount\)/,
      'bar spacing must be solved from that width, not read back after the fact');
    assert.doesNotMatch(SOURCE, /function _fitTradeChart[\s\S]{0,900}?ts\.scrollToPosition\(/,
      'scrollToPosition, spammed every pump frame, was proven live to leave the painted canvas disagreeing with the reported range — use a direct setVisibleLogicalRange instead');
    assert.match(SOURCE, /ts\.setVisibleLogicalRange\(\{ from: 0, to: barCount - 1 \+ pad \}\)/,
      'the range must be set directly from the bar count and pixel pad, not reached incrementally');
  });

  // Proven live, twice: setVisibleLogicalRange() makes getVisibleRange() report
  // the newest bar correctly the instant it's called — but the canvas itself
  // stayed painted on a narrower, older range regardless, through every re-fit
  // frame of the pump, across a fresh page load. A manual chart.resize(w,h,true)
  // was the only thing that made the paint catch up; nothing else in the flow
  // forces a repaint the same way.
  test('the fit forces a repaint, not just a state change', () => {
    assert.doesNotMatch(SOURCE, /function _fitTradeChart[\s\S]{0,1100}?chart\.resize\(/,
      'resize(w,h,true) was tried live and confirmed NOT to force the repaint — do not reintroduce it here');
    assert.match(SOURCE, /chart\.applyOptions\(\{ layout: \{ background: \{ color: layout\.background\.color \} \} \}\)/,
      'setVisibleLogicalRange alone was proven to leave the canvas painted on a stale range — reapplying layout options is what forced the repaint live');
  });

  // The ohlc endpoint sends no Cache-Control at all, which leaves any layer
  // between the browser and the function free to keep a copy. One did: this
  // browser drew MD ending 2026-08-19 (58 bars) while the identical request from
  // elsewhere returned 65 bars ending 2026-08-28 — the seven "missing" sessions.
  // The cache-buster changes nothing server-side, since the function keys its own
  // cache on symbol+range only.
  test('the bars request is not served from an intermediate cache', () => {
    assert.match(SOURCE, /ohlc\?symbol=\$\{encodeURIComponent\(sym\)\}&range=\$\{range\}&_=\$\{Date\.now\(\)\}/,
      'the request must carry a cache-buster');
    assert.match(SOURCE, /cache: 'no-store'/,
      "and opt out of the browser's own HTTP cache");
  });

  // Lightweight Charts spaces the time axis by available room. On a ~45-bar
  // window it drew exactly two date labels — measured at x=45 and x=306 with the
  // newest bar at x=527 — so the rightmost date on the axis sat about eighteen
  // sessions before the last candle and nothing said the right edge was today.
  // Reading the axis, the chart looks like it ends a week or two ago, which is
  // what "I can't see the last trading day" meant while every measurement of the
  // bar's position kept coming back correct. Naming the date in text is the part
  // that cannot be misread.
  test('the newest session is named in text, not left to the time axis', () => {
    assert.match(SOURCE, /<span id="cal-chart-last"/,
      'the chart label must carry a slot for the newest session date');
    assert.match(SOURCE, /lastEl\.textContent = ' · ' \+ fmtDate\(new Date\(bars\[bars\.length - 1\]\.t \* 1000\)/,
      'and it must be filled from the last bar actually drawn');
    assert.match(SOURCE, /ticksVisible: true/,
      'the axis ticks must tie its few labels to real bars');
  });

  // The pad after the newest bar is a pixel amount, not a bar count — a 2-bar
  // pad measured 25px on a 40-bar chart and 8px on a 130-bar one, which is why
  // the newest session looked missing on older trades and fine on fresh ones.
  test('the right-hand air is a pixel amount, not a bar count', () => {
    assert.match(SOURCE, /const _CHART_RIGHT_PAD_PX = 32/,
      'the pad is expressed in pixels');
    assert.match(SOURCE, /rightOffset: 0/,
      'a bar-based rightOffset would fight the pixel pad');
  });

  // A single guaranteed follow-up frame was tried and measured insufficient:
  // reproduced live by repeatedly closing and reopening a trade chart (the
  // library is already loaded by the second open, so creation lands mid the
  // modal's 0.22s animation every time — unlike a session's very first open,
  // which the script's own network fetch happens to mask). Some reopens
  // self-corrected one frame later as designed; others stayed on the bad first
  // frame indefinitely, which is exactly "the recent bars aren't there until I
  // drag right myself" reported repeatedly. Re-applying the fit for a run of
  // frames after every trigger — not a fixed delay, and not just one frame —
  // is what converges regardless of how many frames autoSize's own internal
  // resize happens to need that time.
  test('the fit re-applies for a run of frames, not a fixed count or a timer', () => {
    assert.match(SOURCE, /function _watchTradeChart[\s\S]{0,900}?let framesLeft = 0;/,
      'the re-apply must be frame-driven, not a one-shot follow-up');
    assert.match(SOURCE, /if \(_chartInstance === chart && framesLeft-- > 0\) _chartViewRaf = requestAnimationFrame\(pump\)/,
      'it must keep re-applying across a run of frames, not stop after exactly one');
    assert.match(SOURCE, /_chartResizeObs = new ResizeObserver\(kick\)/,
      'a resize must restart the same run, not a single fit');
    assert.doesNotMatch(SOURCE, /_chartViewTimers/,
      'no timer may be left deciding when the layout is final');
    assert.match(SOURCE, /_disposeTradeChart[\s\S]{0,400}?_chartResizeObs[\s\S]{0,80}?disconnect\(\)/,
      'the observer must be disconnected with the chart or it outlives the modal');
  });

  // Reported live even after the clientWidth/frame-pump fix: getVisibleRange()
  // and a diagnostic marker both said the newest bar was correctly in view, but
  // the actual rightmost PAINTED candle was still a week old. The modal's own
  // open animation/transition can promote it to its own compositing layer, and
  // a canvas inside can keep showing a cached raster for a frame or two after
  // JS reports the animation done — the 20-frame pump is a frame-count guess,
  // not tied to that. transitionend on the overlay fires every single open
  // (unlike the .modal keyframe, which only plays once ever), so it is the one
  // real per-open signal for when that layer actually settles.
  test('a fit is forced again on the overlay transition ending, not just the frame pump', () => {
    assert.match(SOURCE, /overlayEl\.addEventListener\('transitionend', kick, \{ once: true \}\)/,
      'transitionend must trigger the same kick() as a resize, not a separate one-off fit');
  });

  // The entry/exit/date pills are plain HTML positioned via timeToCoordinate /
  // priceToCoordinate at creation and on the re-fit pump — but a user panning or
  // zooming the chart by hand moves the candles without touching either, so the
  // pills stayed frozen at their pre-drag pixel position while the candles slid
  // underneath. Reported live: the entry pill did not sit on the real entry
  // candle after dragging right to find the newest bars.
  test('the pills re-place themselves on every visible-range change, not just the fit pump', () => {
    assert.match(SOURCE, /chart\.timeScale\(\)\.subscribeVisibleLogicalRangeChange\(placeDateTag\)/,
      'a user pan/zoom must re-run the same placer used by the fit pump');
  });

  // `activeTab` is a const scoped inside another function; the visibilitychange
  // handler at top level called it and threw ReferenceError on every return to
  // the tab, so the catch-up repaint it guards never ran. Reported from the live
  // console, twice per return.
  test('the visibility handler reads the active tab without a scoped helper', () => {
    assert.doesNotMatch(SOURCE, /const tab = activeTab\(\)/,
      'activeTab() is not in scope where the visibility handler runs');
    assert.match(SOURCE, /const tab = \(document\.querySelector\('\.tab-content\.active'\) \|\| \{\}\)\.id \|\| ''/,
      'it must read the active tab off the DOM');
  });

});
