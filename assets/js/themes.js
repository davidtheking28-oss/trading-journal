// Loaded on demand; market state and wake-up scheduling remain in dashboard.js.
function ttRenderContent(themes, indices) {
  const grid = document.getElementById('tt-grid');
  if (!grid) return;
  const pKey = _ttPeriod;

  // ── Session note: before the open (or on a closed day) the "Today" figures are the previous session's ──
  const tabEl = document.getElementById('tab-themes');
  if (tabEl) {
    let note = document.getElementById('tt-session-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'tt-session-note';
      note.setAttribute('role', 'status');
      note.style.cssText = 'margin:0 0 12px;padding:8px 12px;border-radius:8px;font-size:12px;color:var(--text2);background:var(--fill, rgba(255,255,255,.05));border:1px solid var(--border, rgba(255,255,255,.08))';
      document.getElementById('tt-indices')?.before(note);
    }
    const etToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const stale = pKey === 'today' && _ttLastBar && _ttLastBar < etToday;
    note.style.display = stale ? '' : 'none';
    if (stale) {
      const d = _ttLastBar.slice(8, 10) + '.' + _ttLastBar.slice(5, 7);
      note.textContent = _lang === 'he'
        ? 'המסחר היום עוד לא התחיל — מוצגת סגירת ' + d + '. נתוני היום יופיעו עם פתיחת המסחר.'
        : "Today's session has not started — showing the " + d + " close. Today's figures appear at the open.";
    }
  }

  // ── Indices bar ──
  const indicesEl = document.getElementById('tt-indices');
  if (indicesEl && indices?.length) {
    indicesEl.innerHTML = indices.map(idx => {
      const pct = idx[pKey];
      const cls = pct == null ? 'flat' : pct > 0 ? 'pos' : pct < 0 ? 'neg' : 'flat';
      const sign = pct != null && pct > 0 ? '+' : '';
      const display = pct != null ? sign + pct.toFixed(2) + '%' : '—';
      return `<div class="tt-index-card">
        <div class="tt-index-name">${esc(idx.name)}</div>
        <div class="tt-index-pct ${cls}">${display}</div>
        <div class="tt-index-ticker">${esc(idx.ticker)}</div>
      </div>`;
    }).join('');
  }

  // ── Theme list ──
  const valid = themes.filter(t => t[pKey] != null);
  const sorted = [...valid].sort((a, b) => b[pKey] - a[pKey]);
  if (!sorted.length) { grid.innerHTML = '<div class="tt-loading">אין נתונים לתקופה זו</div>'; return; }

  // ── Meta: Top3/Bottom3 + Breadth ──
  const metaEl = document.getElementById('tt-meta');
  if (metaEl) {
    const _ttN = window.innerWidth <= 768 ? 3 : 5;
    const top3 = sorted.slice(0, _ttN);
    const bot3 = sorted.slice(-_ttN).reverse();
    const green = sorted.filter(t => t[pKey] >= 0).length;
    const red   = sorted.filter(t => t[pKey] <  0).length;
    const total = sorted.length;
    const greenPct = Math.round((green / total) * 100);
    const redPct   = 100 - greenPct;

    const podiumRow = t => {
      const pct = t[pKey];
      const pos = pct >= 0;
      const sign = pos ? '+' : '';
      return `<div class="tt-podium-row">
        <span class="tt-podium-name">${esc(t.name)}</span>
        <span class="tt-podium-pct ${pos?'pos':'neg'}">${sign}${pct.toFixed(2)}%</span>
      </div>`;
    };

    metaEl.innerHTML = `
      <div class="tt-meta-card">
        <div class="tt-meta-title">Top ${_ttN} &nbsp;·&nbsp; Bottom ${_ttN}</div>
        <div class="tt-podium">${top3.map(podiumRow).join('')}</div>
        <div style="height:8px"></div>
        <div class="tt-podium">${bot3.map(podiumRow).join('')}</div>
      </div>
      <div class="tt-meta-card">
        <div class="tt-meta-title">${_lang === 'he' ? 'רוחב השוק — סקטורים עולים ויורדים' : 'Market Breadth'}</div>
        <div class="tt-breadth-bar-wrap" style="background:linear-gradient(to right,#0d9488 ${greenPct}%,#e11d48 ${greenPct}%)"></div>
        <div class="tt-breadth-labels">
          <span class="tt-breadth-red">▼ ${red} <span style="opacity:0.7">(${redPct}%)</span></span>
          <span class="tt-breadth-neutral">${total} ${_lang === 'he' ? 'סקטורים' : 'sectors'}</span>
          <span class="tt-breadth-green">▲ ${green} <span style="opacity:0.7">(${greenPct}%)</span></span>
        </div>
        <div class="tt-breadth-chips" id="tt-breadth-chips-inner"></div>
      </div>`;
    const chipsEl = document.getElementById('tt-breadth-chips-inner');
    if (chipsEl) {
      const greens = sorted.filter(t => t[pKey] > 0).slice(0, 7);
      const reds   = sorted.filter(t => t[pKey] < 0).slice(-7).reverse();
      const rows = Math.max(greens.length, reds.length);
      let chipsHtml = '';
      for (let i = 0; i < rows; i++) {
        const g = greens[i], r = reds[i];
        chipsHtml += r
          ? `<div class="tt-chip red" role="button" tabindex="0" style="cursor:pointer" onclick="sectorModalOpen('${esc(r.ticker)}','${esc(r.name)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sectorModalOpen('${esc(r.ticker)}','${esc(r.name)}')}"><span>${esc(r.name)}</span><span>${r[pKey].toFixed(1)}%</span></div>`
          : '<div></div>';
        chipsHtml += g
          ? `<div class="tt-chip green" role="button" tabindex="0" style="cursor:pointer" onclick="sectorModalOpen('${esc(g.ticker)}','${esc(g.name)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sectorModalOpen('${esc(g.ticker)}','${esc(g.name)}')}"><span>${esc(g.name)}</span><span>+${g[pKey].toFixed(1)}%</span></div>`
          : '<div></div>';
      }
      chipsEl.innerHTML = chipsHtml;
    }
  }

  const maxAbs = Math.max(...sorted.map(t => Math.abs(t[pKey])), 0.01);
  const renderRow = t => {
    const pct = t[pKey];
    const pos = pct >= 0;
    const barW = Math.min((Math.abs(pct) / maxAbs) * 48, 48);
    const sign = pos ? '+' : '';
    return `<div class="tt-row" role="button" tabindex="0" onclick="sectorModalOpen('${esc(t.ticker)}','${esc(t.name)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sectorModalOpen('${esc(t.ticker)}','${esc(t.name)}')}">
      <div class="tt-name">${esc(t.name)}</div>
      <div class="tt-bar-wrap">
        <div class="tt-bar-bg"></div>
        <div class="tt-bar ${pos?'pos':'neg'}" style="width:${barW}%"></div>
      </div>
      <div class="tt-pct ${pos?'pos':'neg'}">${sign}${pct.toFixed(2)}%</div>
    </div>`;
  };
  const half = Math.ceil(sorted.length / 2);
  grid.innerHTML = `<div class="tt-col">${sorted.slice(half).map(renderRow).join('')}</div>`
                 + `<div class="tt-col">${sorted.slice(0, half).map(renderRow).join('')}</div>`;
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// SECTOR HOLDINGS MODAL
// ─────────────────────────────────────────────


function _renderHoldingsForPeriod(allHoldings, period) {
  const body = document.getElementById('sector-modal-body');
  if (!body) return;
  const key = period || 'today';
  const sorted = allHoldings
    .filter(h => h[key] != null)
    .sort((a, b) => b[key] - a[key])
    .slice(0, 10);
  if (!sorted.length) { body.innerHTML = '<div class="sector-modal-loading">אין נתונים לתקופה זו</div>'; return; }
  body.innerHTML = sorted.map(h => {
    const pct = h[key];
    const pos = pct > 0, neg = pct < 0;
    const cls = pos ? 'pos' : neg ? 'neg' : '';
    const sign = pos ? '+' : '';
    return '<div class="sector-holding-row">'
      + '<span class="sector-holding-sym">' + esc(h.symbol) + '</span>'
      + '<span class="sector-holding-name">' + esc(h.name) + '</span>'
      + '<span class="sector-holding-pct ' + cls + '">' + sign + pct.toFixed(2) + '%</span>'
      + '</div>';
  }).join('');
}

async function _fetchAndRender(ticker, showLoading) {
  const body = document.getElementById('sector-modal-body');
  if (!body) return;
  if (showLoading) body.innerHTML = `<div class="sector-modal-loading">${t('set_loading')}</div>`;
  try {
    const _shToken = await _getToken();
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/sector-holdings?ticker=${encodeURIComponent(ticker)}`,
      { headers: { 'Authorization': `Bearer ${_shToken}` } }
    );
    const json = await res.json();
    if (json.error) { body.innerHTML = `<div class="sector-modal-loading">${esc(json.error)}</div>`; return; }
    if (!json.holdings?.length) { body.innerHTML = `<div class="sector-modal-loading">${_lang === 'he' ? 'אין נתוני אחזקות לסקטור זה' : 'No holdings data'}</div>`; return; }
    _sectorHoldingsCache[ticker] = json.holdings;
    _sectorSaveLS(ticker, json.holdings);
    _renderHoldingsForPeriod(json.holdings, _ttPeriod);
    const sub = document.getElementById('sector-modal-sub');
    if (sub) sub.textContent = ticker + (_lang === 'he' ? ' — עודכן ' : ' — updated ') + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    if (showLoading) body.innerHTML = `<div class="sector-modal-loading">${_lang === 'he' ? 'לא ניתן לטעון את הנתונים כרגע' : 'Error loading data'}</div>`;
  }
}

async function sectorModalOpen(ticker, name) {
  const overlay = document.getElementById('sector-modal-overlay');
  const modal   = document.getElementById('sector-modal');
  const title   = document.getElementById('sector-modal-title');
  if (!modal) return;

  _sectorTicker = ticker;
  title.textContent = name;
  overlay.style.display = 'block';
  modal.style.display   = 'block';

  clearInterval(_sectorTimer);
  // Stale-while-revalidate: show any cached data (memory → localStorage)
  // instantly, then refresh in the background. Only show a spinner on a true
  // first open with nothing cached.
  const lsHit = !_sectorHoldingsCache[ticker] && _sectorLoadLS()[ticker];
  if (lsHit?.holdings?.length) _sectorHoldingsCache[ticker] = lsHit.holdings;
  if (_sectorHoldingsCache[ticker]) {
    _renderHoldingsForPeriod(_sectorHoldingsCache[ticker], _ttPeriod);
    _fetchAndRender(ticker, false); // refresh in background, no spinner
  } else {
    await _fetchAndRender(ticker, true);
  }
  _sectorTimer = setInterval(() => _fetchAndRender(_sectorTicker, false), 60000);
}

