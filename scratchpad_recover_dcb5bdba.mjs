// One-off recovery script: run the REAL, currently-shipped flexParseXML +
// _flexImportInner logic from dashboard.html (extracted the same way the test
// suite does) against the cached-but-never-imported Flex XML for user
// dcb5bdba-8863-4f8f-92f5-498ea9eae59a. Dry-run only — logs planned
// insert/update operations instead of writing to Supabase, so they can be
// reviewed before being applied as real SQL. Not part of the app or the test
// suite; delete after use.
import { readFileSync } from 'node:fs';
import { extractFunction, DOMParser } from './tests/harness.mjs';

const USER_ID = 'dcb5bdba-8863-4f8f-92f5-498ea9eae59a';
const xml = readFileSync('C:/Users/david/AppData/Local/Temp/claude/c--Users-david-trading-journal/d558a470-1fff-4ab2-949c-aaf4ad3c7b8e/scratchpad/dcb5bdba_flex.xml', 'utf8');
// execute_sql (pg wire) returns `numeric` columns as strings to avoid float
// precision loss; PostgREST (what the real browser app talks to) serializes
// them as bare JSON numbers instead. _rowToTrade/validateTradeSchema assume
// the PostgREST shape (typeof entryPrice === 'number'), so the raw dump here
// must be coerced the same way before being fed through the real code.
const NUMERIC_COLS = ['entry_price', 'shares', 'stop', 'closed_shares', 'exit_price', 'ecn', 'commission', 'process_score'];
const existingRowsRaw = JSON.parse(readFileSync('C:/Users/david/AppData/Local/Temp/claude/c--Users-david-trading-journal/d558a470-1fff-4ab2-949c-aaf4ad3c7b8e/scratchpad/dcb5bdba_existing_trades.json', 'utf8'));
const existingRows = existingRowsRaw.map(r => {
  const row = { ...r };
  for (const c of NUMERIC_COLS) if (row[c] !== null && row[c] !== undefined) row[c] = Number(row[c]);
  return row;
});

const opsLog = [];
let fakeIdCounter = 1000000;
function makeSb() {
  return {
    from(table) {
      return {
        update(patch) {
          return { eq(col1, val1) { return { eq(col2, val2) {
            opsLog.push({ op: 'update', table, patch, where: { [col1]: val1, [col2]: val2 } });
            return Promise.resolve({ error: null });
          } }; } };
        },
        insert(row) {
          return { select() { return { single() {
            const data = { ...row, id: ++fakeIdCounter };
            opsLog.push({ op: 'insert', table, row });
            return Promise.resolve({ data, error: null });
          } }; } };
        },
      };
    },
  };
}

const flexParseXMLSrc   = extractFunction('flexParseXML');
const tradeToRowSrc      = extractFunction('_tradeToRow');
const rowToTradeSrc      = extractFunction('_rowToTrade');
const isDeletedImportSrc = extractFunction('_isDeletedImport');
const dedupeTradesSrc    = 'async ' + extractFunction('_dedupeTrades');
const importInnerSrc     = 'async ' + extractFunction('_flexImportInner');

const factory = new Function(
  'DOMParser', '_sb', '_currentUser', 'db', 'initFilters', 'renderTable',
  'renderOverview', 'renderStatistics', 'document', 'toast', 'console',
  `${flexParseXMLSrc}\n${tradeToRowSrc}\n${rowToTradeSrc}\n${isDeletedImportSrc}\n${dedupeTradesSrc}\n${importInnerSrc}\n` +
  `return { flexParseXML, _tradeToRow, _rowToTrade, _isDeletedImport, _dedupeTrades, _flexImportInner };`
);

const db = { stocks: [], crypto: [] };
const { flexParseXML, _rowToTrade, _flexImportInner } = factory(
  DOMParser, makeSb(), { id: USER_ID }, db,
  () => {}, () => {}, () => {}, () => {},
  { getElementById: () => null },
  () => {},
  console,
);

const all = existingRows.map(_rowToTrade);
db.stocks = all.filter(t => t.type === 'stock' && !t.deleted);
db.crypto = all.filter(t => t.type === 'crypto' && !t.deleted);
db._deletedFingerprints = new Set(
  all.filter(t => t.deleted).map(t =>
    `${t.symbol}||${t.entryDate}||${Math.round((t.entryPrice || 0) * 1000)}||${Math.round((t.shares || 0) * 1000)}`)
);
db._deletedBrokerIds = new Set(
  all.filter(t => t.deleted && (t.ibkr_id || t.bybit_id)).map(t => t.ibkr_id || t.bybit_id)
);

console.log('existing open/active stock rows:', db.stocks.length, '| crypto:', db.crypto.length);

const parsed = flexParseXML(xml);
console.log('parsed', parsed.length, 'trades from XML');

const result = await _flexImportInner(parsed);
console.log('import result:', result.imported, 'imported,', result.updated, 'updated');
console.log('---- planned ops ----');
console.log(JSON.stringify(opsLog, null, 2));
