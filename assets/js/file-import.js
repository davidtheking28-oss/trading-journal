// Manual TLG parsing and preview; database confirmation stays in dashboard.js.
function tlgParse(text) {
  const status  = document.getElementById('tlg-status');
  const preview = document.getElementById('tlg-preview');
  if (status)  status.textContent = '';
  if (preview) preview.innerHTML  = '';

  const lines = text.split(/\r?\n/).filter(l => l.startsWith('STK_TRD|'));
  if (!lines.length) {
    if (status) status.textContent = '❌ לא נמצאו עסקאות בקובץ';
    return;
  }

  // Parse each row
  const rows = lines.map(line => {
    const p = line.split('|');
    // STK_TRD|OrderID|Symbol|Name|Exchange|Action|OC|Date|Time|Currency|Qty|Mult|Price|Value|Commission|...
    const action = (p[5] || '').toUpperCase();
    const oc     = (p[6] || '').toUpperCase();
    const rawDate = p[7] || '';
    const entryDate = rawDate.length === 8
      ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`
      : '';
    return {
      orderId:    p[1] || '',
      symbol:     (p[2] || '').toUpperCase().replace(/[^A-Z0-9._\-]/g,'').slice(0,10),
      name:       p[3] || '',
      action,
      oc,
      entryDate,
      price:      Math.abs(parseFloat(p[12]) || 0),
      time:       p[8] || "",
      qty:        Math.abs(parseFloat(p[10]) || 0),
      commission: Math.abs(parseFloat(p[14]) || 0),
      isBuy:      action.includes('BUY'),
    };
  }).filter(r => r.symbol && r.price && r.qty);

  // FIFO-match each symbol's fills against each other.
  //
  // This used to bucket fills into buys/sells and then, for every buy, scan the
  // WHOLE sells list for anything dated on or after it. Nothing was ever
  // consumed, so two buys of one symbol followed by a single sell closed BOTH
  // buys against that same sell — the P&L and the sell's commission were
  // counted once per buy. It also hardcoded ls:'L', so a short's opening SELL
  // landed in the sells bucket, silently vanished as a position, and corrupted
  // the matching of the real buys around it.
  const bySymbol = {};
  rows.forEach(r => { (bySymbol[r.symbol] = bySymbol[r.symbol] || []).push(r); });

  const trades = [];
  Object.entries(bySymbol).forEach(([sym, fills]) => {
    // FIFO is meaningless on file order and the export is not guaranteed sorted.
    fills.sort((a, b) => (a.entryDate + a.time).localeCompare(b.entryDate + b.time));
    const lots = [];
    fills.forEach(f => {
      let qty = f.qty;
      // The broker's O/C column decides when it is filled in; direction against
      // what is actually open is the fallback for rows that leave it blank.
      const opensOnly = f.oc.startsWith('O');
      const want = f.isBuy ? 'S' : 'L';   // a buy closes shorts, a sell closes longs
      if (!opensOnly) {
        for (const lot of lots) {
          if (qty <= 1e-9) break;
          if (lot.ls !== want || lot.left <= 1e-9) continue;
          const take = Math.min(lot.left, qty);
          lot.left -= take;
          qty -= take;
          lot.closedShares += take;
          lot.legs.push({ shares: take, price: f.price });
          lot.closeDate = f.entryDate;
          lot.exitPrice = f.price;
          // The fill is charged one commission for its whole size; give each
          // lot it closed only that lot's share.
          lot.commission += f.commission * take / f.qty;
        }
      }
      // Whatever is left opens a position — a plain open, or the far side of a
      // reversal that closed more than was on the books.
      if (qty > 1e-9) {
        lots.push({
          symbol: sym, name: f.name, entryDate: f.entryDate, entryPrice: f.price,
          shares: qty, ls: f.isBuy ? 'L' : 'S', left: qty,
          commission: f.commission * qty / f.qty,
          closedShares: 0, closeDate: '', exitPrice: 0, legs: [],
        });
      }
    });
    lots.forEach(l => trades.push({
      symbol: l.symbol, name: l.name,
      entryDate: l.entryDate, entryPrice: l.entryPrice, shares: l.shares,
      commission: Math.round(l.commission * 10000) / 10000,
      closeDate: l.closedShares > 0 ? l.closeDate : '',
      exitPrice: l.closedShares > 0 ? l.exitPrice : 0,
      closedShares: l.closedShares,
      // closedShares is TOTAL closed volume and calcPL prices the remainder
      // (closedShares - sum(targets[].shares)) at exitPrice, so the final leg
      // must NOT also be listed as a target or it is counted twice.
      targets: l.legs.length > 1 ? l.legs.slice(0, -1) : [],
      ls: l.ls,
    }));
  });

  if (!trades.length) {
    if (status) status.textContent = '❌ לא ניתן לבנות עסקאות מהקובץ';
    return;
  }

  if (status) status.innerHTML = `<span style="color:var(--green)">✅ נמצאו ${trades.length} עסקאות — בחר אילו לייבא:</span>`;

  // Store for confirmation
  window._tlgPending = trades;

  // Render preview
  if (!preview) return;
  preview.innerHTML = '';
  trades.forEach((t, i) => {
    // calcPL, not a long-only one-liner: this preview now shows shorts (whose
    // P&L runs the other way) and multi-leg exits (which live in targets and
    // were priced at the final exit by the subtraction below).
    const pnl = t.closedShares > 0 ? (calcPL({ ...t, t: t.targets }) - t.commission).toFixed(2) : null;
    const pnlHtml = pnl !== null
      ? `<span style="color:${+pnl >= 0 ? 'var(--green)' : 'var(--red)'};">${+pnl >= 0 ? '+' : ''}$${pnl}</span>`
      : '<span style="color:var(--text3)">פתוח</span>';
    const safeEntryDate  = /^\d{4}-\d{2}-\d{2}$/.test(t.entryDate) ? t.entryDate : '—';
    const safeEntryPrice = parseFloat(t.entryPrice||0).toFixed(4);
    const safeShares     = parseFloat(t.shares||0);
    const safeTargets    = Number.isInteger(t.targets?.length) ? t.targets.length : 0;
    const div = document.createElement('div');
    div.className = 'ibkr-trade-preview';
    div.innerHTML = `
      <div>
        <span class="sym">${esc(t.symbol)}</span>
        <span style="font-size:11px;color:var(--text3);margin-right:8px;">${esc(t.name)}</span>
      </div>
      <div class="det">
        ${safeEntryDate} &nbsp;|&nbsp; כניסה: $${safeEntryPrice} &nbsp;|&nbsp;
        ${safeShares} מניות &nbsp;|&nbsp; P&L: ${pnlHtml}
        ${safeTargets ? ` &nbsp;|&nbsp; ${safeTargets} יציאות חלקיות` : ''}
      </div>
      <button class="btn btn-primary btn-sm" onclick="tlgConfirm(${i})" id="tlg-btn-${i}">+ ייבא</button>
    `;
    preview.appendChild(div);
  });

  const allBtn = document.createElement('button');
  allBtn.className = 'btn btn-primary';
  allBtn.style.marginTop = '12px';
  allBtn.textContent = `📥 ייבא הכל (${trades.length})`;
  allBtn.onclick = () => trades.forEach((_, i) => tlgConfirm(i));
  preview.appendChild(allBtn);
}

