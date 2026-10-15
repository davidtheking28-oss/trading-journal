// Loaded on demand by loadBrokerImportFeature; shares the dashboard global scope.
const BROKER_DEFS = {
  colmex: {
    name: 'Colmex Pro',
    cols: {
      symbol:     ['Symbol','Ticker','Instrument','Description','Sym'],
      side:       ['Side','Direction','Action','Type','Buy/Sell','B/S'],
      shares:     ['Quantity','Qty','Volume','Size','Amount','Shares'],
      entryPrice: ['Open Price','Entry Price','Price','Open','Bought'],
      exitPrice:  ['Close Price','Exit Price','Close','Sold'],
      entryDate:  ['Date/Time','DateTime','Open Date','Date','Time','Open Time','Trade Date'],
      commission: ['Execution fee','Commission','Fee','Fees','Commissions','Exec Fee'],
      pnl:        ['Net P/L','Net PL','NetPL','P/L','PnL','Profit','Gross P/L','Net Profit'],
    },
    sideMap: { 'buy':'L','long':'L','b':'L','l':'L','sell':'S','short':'S','s':'S' },
  }
};

let _biRows = null, _biMapping = null, _biTrades = null;

function brokerReadFile(input) {
  const file = (input.files || input)[0];
  if (!file) return;
  const broker = document.getElementById('bi-broker').value;
  if (!broker) { toast('בחר ברוקר תחילה', true); return; }
  const user = _currentUser;
  const reader = new FileReader();
  reader.onload = e => {
    if (_currentUser !== user) return;
    try {
      _biRows = biParseCSV(e.target.result);
      if (!_biRows.length) { toast('לא נמצאו שורות בקובץ', true); return; }
      const def = BROKER_DEFS[broker];
      _biMapping = biDetectCols(Object.keys(_biRows[0]), def.cols);
      biShowMapping(_biMapping, Object.keys(_biRows[0]));
    } catch(err) { toast('שגיאה בקריאת הקובץ', true); }
  };
  reader.readAsText(file, 'UTF-8');
}

function biParseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = biSplitLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = biSplitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim(); });
    return obj;
  });
}

function biSplitLine(line) {
  const r = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === ',' && !q) { r.push(cur); cur = ''; }
    else cur += c;
  }
  r.push(cur);
  return r;
}

function biDetectCols(headers, colDefs) {
  const map = {};
  for (const [field, candidates] of Object.entries(colDefs)) {
    for (const c of candidates) {
      const found = headers.find(h => h.toLowerCase().trim() === c.toLowerCase().trim());
      if (found) { map[field] = found; break; }
    }
  }
  return map;
}

function biShowMapping(mapping, headers) {
  const labels = {
    symbol:'סימבול *', side:'כיוון (L/S) *', shares:'כמות *',
    entryPrice:'מחיר כניסה *', exitPrice:'מחיר יציאה',
    entryDate:'תאריך *', commission:'עמלה', pnl:'P&L'
  };
  let h = `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">מיפוי עמודות (ניתן לשנות):</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">`;
  for (const [field, label] of Object.entries(labels)) {
    const sel = mapping[field] || '';
    h += `<div>
      <div class="ibkr-field-label">${label}</div>
      <select class="form-control" style="font-size:12px;padding:4px 8px;"
        onchange="_biMapping['${field}']=this.value">
        <option value="">— לא ממופה —</option>
        ${headers.map(hd => `<option value="${esc(hd)}"${hd===sel?' selected':''}>${esc(hd)}</option>`).join('')}
      </select>
    </div>`;
  }
  h += `</div><button class="btn btn-secondary btn-sm" onclick="biPreview()">👁 תצוגה מקדימה</button></div>`;
  const el = document.getElementById('bi-mapping');
  el.innerHTML = h; el.style.display = 'block';
  document.getElementById('bi-preview').style.display = 'none';
  document.getElementById('bi-import-btn').style.display = 'none';
}

function biPreview() {
  const broker = document.getElementById('bi-broker').value;
  const def = BROKER_DEFS[broker];
  _biTrades = biParseRows(_biRows, _biMapping, def);
  if (!_biTrades.length) { toast('לא זוהו עסקאות — בדוק מיפוי עמודות', true); return; }
  const show = _biTrades.slice(0, 5);
  let h = `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">
      ${_biTrades.length} עסקאות זוהו — מוצגות 5 ראשונות:
    </div>
    <div class="table-wrap" style="margin-bottom:12px;max-height:220px;overflow-y:auto;">
    <table><thead><tr><th>סימבול</th><th>כיוון</th><th>תאריך</th><th>כניסה</th><th>יציאה</th><th>כמות</th><th>עמלה</th></tr></thead><tbody>`;
  for (const t of show) {
    h += `<tr class="data-row">
      <td><strong>${esc(t.symbol)}</strong></td>
      <td><span class="badge badge-${t.ls}">${t.ls}</span></td>
      <td>${fmtDate(t.entryDate)}</td>
      <td>$${fmtPrice(t.entryPrice)}</td>
      <td>${t.exitPrice ? '$'+fmtPrice(t.exitPrice) : '—'}</td>
      <td>${t.shares}</td>
      <td>$${fmt(t.commission||0)}</td>
    </tr>`;
  }
  h += `</tbody></table></div>
    <div style="display:flex;align-items:center;gap:10px;">
      <div class="ibkr-field-label" style="margin:0;">סוג נכס:</div>
      <select id="bi-asset-type" class="form-control" style="font-size:12px;padding:4px 8px;width:130px;">
        <option value="stock">מניות</option>
        <option value="crypto">קריפטו</option>
      </select>
    </div>
  </div>`;
  const el = document.getElementById('bi-preview');
  el.innerHTML = h; el.style.display = 'block';
  document.getElementById('bi-import-btn').style.display = 'inline-flex';
}

function biParseRows(rows, mapping, def) {
  const trades = [];
  for (const row of rows) {
    try {
      const symbol = (row[mapping.symbol] || '').trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9._\-]/g,'');
      if (!symbol) continue;
      const sideRaw = (row[mapping.side] || '').trim().toLowerCase();
      const ls = def.sideMap[sideRaw] || (sideRaw.startsWith('b') || sideRaw.startsWith('l') ? 'L' : 'S');
      const shares = parseFloat(row[mapping.shares]) || 0;
      if (shares <= 0) continue;
      let entryPrice = parseFloat(row[mapping.entryPrice]) || 0;
      const rawDate = (row[mapping.entryDate] || '').trim();
      const entryDate = biParseDate(rawDate);
      if (!entryDate) continue;
      let exitPrice = mapping.exitPrice ? (parseFloat(row[mapping.exitPrice]) || 0) : 0;
      const commission = mapping.commission ? Math.abs(parseFloat(row[mapping.commission]) || 0) : 0;
      const pnl = mapping.pnl ? (parseFloat(row[mapping.pnl]) || 0) : 0;
      // Colmex "Bought"/"Sold" may be total values — detect and convert to price
      if (entryPrice > shares * 1000 && shares >= 1) entryPrice = entryPrice / shares;
      if (exitPrice > shares * 1000 && shares >= 1) exitPrice = exitPrice / shares;
      // Back-calc exit price from P/L if missing
      if (!exitPrice && pnl && entryPrice && shares) {
        const dir = ls === 'L' ? 1 : -1;
        exitPrice = entryPrice + (pnl + commission) / shares * dir;
        if (exitPrice < 0) exitPrice = 0;
      }
      // A row carrying an exit price is a closed position, so record how much
      // of it closed — every other import path (Bybit, and the manual broker
      // paths) sets closedShares explicitly. Leaving it null made these trades
      // invisible to renderMonthlyTracker, which selects on closedShares > 0,
      // so a CSV-imported month showed no performance at all.
      trades.push({ symbol, ls, entryDate, entryPrice, exitPrice: exitPrice > 0 ? exitPrice : null, shares, commission,
                    closedShares: exitPrice > 0 ? shares : null });
    } catch(e) { /* skip bad row */ }
  }
  return trades;
}

function biParseDate(raw) {
  if (!raw) return null;
  // YYYY-MM-DD or YYYY/MM/DD
  let m = raw.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // DD/MM/YYYY or MM/DD/YYYY
  m = raw.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})/);
  if (m) {
    const d1 = +m[1], d2 = +m[2];
    if (d1 > 12) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  return null;
}

async function brokerImport() {
  if (!_biTrades?.length) return;
  const type = document.getElementById('bi-asset-type').value;
  const btn = document.getElementById('bi-import-btn');
  btn.disabled = true; btn.textContent = 'מייבא...';
  let added = 0, skipped = 0, dupes = 0;
  for (const t of _biTrades) {
    t.type = type;
    const fp = `${t.symbol}||${t.entryDate}||${Math.round((t.entryPrice||0)*1000)}||${Math.round((t.shares||0)*1000)}`;
    if (db._deletedFingerprints?.has(fp)) { dupes++; continue; }
    const existing = (type==='stock'?db.stocks:db.crypto).find(x =>
      x.symbol===t.symbol && x.entryDate===t.entryDate &&
      Math.abs((x.entryPrice||0)-(t.entryPrice||0)) < 0.001 &&
      Math.abs((x.shares||0)-(t.shares||0)) < 0.001);
    if (existing) { dupes++; continue; }
    try {
      const row = _tradeToRow(t);
      const { data, error } = await _sb.from('trades').insert(row).select().single();
      if (error) { skipped++; continue; }
      const trade = _rowToTrade(data);
      (type==='stock' ? db.stocks : db.crypto).push(trade);
      added++;
    } catch(e) { skipped++; }
  }
  btn.disabled = false; btn.textContent = 'ייבא עסקאות';
  toast(`ייבוא הסתיים: ${added} נוספו${dupes?' | '+dupes+' כפולות':''}${skipped?' | '+skipped+' שגיאות':''}`);
  if (added) { renderTable(type); renderOverview(); }
  _biTrades = null;
  document.getElementById('bi-preview').style.display = 'none';
  document.getElementById('bi-import-btn').style.display = 'none';
}

