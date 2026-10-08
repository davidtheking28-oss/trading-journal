const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('C:/Users/david/stock-screener/מסנן-מניות.html', 'utf8');
const source = html.slice(html.indexOf('async function checkAndSaveHistory('), html.indexOf('async function scan('));
let resolveRead;
const pending = new Promise(resolve => { resolveRead = resolve; });
const writes = [];
const context = vm.createContext({
  _currentUser: { id: 'account-A' }, activeScreener: 'sepa', _scanToken: 1,
  Date, Set, Map, console, firstSeenByTicker: new Map(), newToday: new Set(), watchlist: new Set(),
  _fsKey: (scr, ticker) => scr + ':' + ticker,
  _sb: { from: () => ({ select: () => ({ eq: () => ({ eq: () => pending }) }), upsert: async rows => { writes.push(rows); } }) },
});
vm.runInContext(source, context);
(async () => {
  const work = context.checkAndSaveHistory(['SYNTHETIC']);
  context._currentUser = { id: 'account-B' };
  resolveRead({ data: [], error: null });
  await work;
  assert.equal(writes[0][0].user_id, 'account-B');
  console.log('REPRODUCED: history started for account-A was written using account-B after switching during the read. Synthetic mocks only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
