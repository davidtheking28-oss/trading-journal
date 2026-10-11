// Loaded on demand; shared chart helpers and account state remain in dashboard.js.
function renderMonthlyTracker(trades) {
  const wrap = document.getElementById('monthly-tracker-wrap');
  if (!wrap) return;
  const effectiveYear = +(document.getElementById('stats-year')?.value) || +(document.getElementById('ov-year')?.value) || new Date().getFullYear();
  const lbl = document.getElementById('mt-year-label');
  if (lbl) lbl.textContent = effectiveYear;
  const closed = trades.filter(t =>
    t.exitPrice > 0 && t.closedShares > 0 &&
    +(t.entryDate||'').slice(0,4) === effectiveYear
  );

  // Build per-month data
  const byMonth = {}; // key = "MM" (01-12)
  closed.forEach(t => {
    const m = (t.entryDate || '').slice(5, 7);
    if (!m) return;
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(t);
  });

  const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12'];

  function monthStats(arr) {
    if (!arr || !arr.length) return null;
    const winners = arr.filter(t => calcTotal(t) > 0);
    const losers  = arr.filter(t => calcTotal(t) <= 0);
    const avgGainPct = winners.length ? winners.reduce((s,t)=>{ const p=_tradePct(t); return p!==null?s+p:s; },0) / winners.length : null;
    const avgLossPct = losers.length  ? losers.reduce((s,t)=>{ const p=_tradePct(t); return p!==null?s+p:s; },0) / losers.length  : null;
    const winRate    = arr.length ? winners.length / arr.length * 100 : 0;
    const lgGain     = winners.length ? Math.max(...winners.map(t=>calcTotal(t))) : null;
    const lgLoss     = losers.length  ? Math.min(...losers.map(t=>calcTotal(t)))  : null;
    const avgDaysWin = winners.length ? winners.reduce((s,t)=>s+tradeDays(t),0)/winners.length : null;
    const avgDaysLoss= losers.length  ? losers.reduce((s,t)=>s+tradeDays(t),0)/losers.length   : null;
    return { n: arr.length, avgGainPct, avgLossPct, winRate, lgGain, lgLoss, avgDaysWin, avgDaysLoss };
  }

  function pct(v) { return v === null ? '<span class="mt-empty">—</span>' : `${v>=0?'+':''}${v.toFixed(2)}%`; }
  function usd(v) { return v === null ? '<span class="mt-empty">—</span>' : fmtUSD(v); }
  function days(v){ return v === null ? '<span class="mt-empty">—</span>' : Math.round(v); }
  function clrPct(v, el) { return v === null ? '' : v >= 0 ? 'color:var(--green)' : 'color:var(--red)'; }

  let rows = '';
  const validMonths = [];
  MONTH_KEYS.forEach((mk, i) => {
    const arr = byMonth[mk];
    const s = monthStats(arr);
    if (!s) {
      rows += `<tr><td>${monthsShort()[i]}</td><td class="mt-empty">—</td><td class="mt-empty">—</td><td class="mt-empty">—</td><td class="mt-empty">—</td><td class="mt-empty">—</td><td class="mt-empty">—</td><td class="mt-empty">—</td><td class="mt-empty">—</td></tr>`;
      return;
    }
    validMonths.push(s);
    rows += `<tr>
      <td>${monthsShort()[i]}</td>
      <td class="${s.avgGainPct!==null?(s.avgGainPct>=0?'cl-green':'cl-red'):''} sensitive">${pct(s.avgGainPct)}</td>
      <td class="${s.avgLossPct!==null?(s.avgLossPct>=0?'cl-green':'cl-red'):''} sensitive">${pct(s.avgLossPct)}</td>
      <td class="${s.winRate>=50?'cl-green':'cl-red'} sensitive">${fmt(s.winRate,1)}%</td>
      <td class="sensitive">${s.n}</td>
      <td class="cl-green sensitive">${usd(s.lgGain)}</td>
      <td class="cl-red sensitive">${usd(s.lgLoss)}</td>
      <td class="sensitive">${days(s.avgDaysWin)}</td>
      <td class="sensitive">${days(s.avgDaysLoss)}</td>
    </tr>`;
  });

  // AVG row
  let avgRow = `<tr><td>${t('mt_avg_row')}</td>`;
  if (validMonths.length) {
    const avg = f => { const vals=validMonths.filter(s=>s[f]!==null); return vals.length?vals.reduce((a,s)=>a+s[f],0)/vals.length:null; };
    const avgWR = validMonths.reduce((a,s)=>a+s.winRate,0)/validMonths.length;
    const avgN  = Math.round(validMonths.reduce((a,s)=>a+s.n,0)/validMonths.length);
    const agp = avg('avgGainPct'), alp = avg('avgLossPct');
    avgRow += `<td class="${agp!==null?(agp>=0?'cl-green':'cl-red'):''} sensitive">${pct(agp)}</td>`;
    avgRow += `<td class="${alp!==null?(alp>=0?'cl-green':'cl-red'):''} sensitive">${pct(alp)}</td>`;
    avgRow += `<td class="${avgWR>=50?'cl-green':'cl-red'} sensitive">${fmt(avgWR,1)}%</td>`;
    avgRow += `<td class="sensitive">${avgN}</td>`;
    avgRow += `<td class="cl-green sensitive">${usd(avg('lgGain'))}</td>`;
    avgRow += `<td class="cl-red sensitive">${usd(avg('lgLoss'))}</td>`;
    avgRow += `<td class="sensitive">${days(avg('avgDaysWin'))}</td>`;
    avgRow += `<td class="sensitive">${days(avg('avgDaysLoss'))}</td>`;
  } else {
    avgRow += '<td colspan="8" class="mt-empty">—</td>';
  }
  avgRow += '</tr>';

  wrap.innerHTML = `<table class="mt-table">
    <thead><tr>
      <th></th>
      <th>${t('mt_avg_gain')}</th>
      <th>${t('mt_avg_loss')}</th>
      <th>WIN %</th>
      <th>${t('mt_total_trades')}</th>
      <th>${t('mt_max_gain')}</th>
      <th>${t('mt_max_loss')}</th>
      <th>${t('mt_avg_days_win')}</th>
      <th>${t('mt_avg_days_loss')}</th>
    </tr></thead>
    <tbody>${rows}${avgRow}</tbody>
  </table>`;
}


function renderStatisticsContent() {
 const secondaryToggle=document.getElementById('stats-secondary-toggle');
 if(secondaryToggle && window.matchMedia('(min-width:769px)').matches) {
 const open=!document.getElementById('stats-secondary-content').classList.contains('stats-desktop-collapsed');
 secondaryToggle.setAttribute('aria-expanded',String(open));
 secondaryToggle.textContent=_lang === 'he' ? (open?'הסתר סטטיסטיקות נוספות ▴':'הצג סטטיסטיקות נוספות ▾') : (open?'Hide additional statistics ▴':'Show additional statistics ▾');
 }

  _restoreStatsState();
  _loadBrokerEquity();
  const { month, year } = getFilter('stats');
  let allTrades = [...db.stocks, ...db.crypto].filter(t => !t.deleted && t.entryDate);
  if (month) allTrades = allTrades.filter(t => +t.entryDate.slice(5, 7) === +month);
  if (year)  allTrades = allTrades.filter(t => +t.entryDate.slice(0, 4) === +year);

  const stTrades = allTrades.filter(t => t.type === 'stock' || !t.type);
  const crTrades = allTrades.filter(t => t.type === 'crypto');

  let trades;
  if (statsScope === 'stock') trades = stTrades;
  else if (statsScope === 'crypto') trades = crTrades;
  else trades = allTrades;

  const st  = stats(trades);
  const adv = advancedStats(trades);

  // Must be the same closed-test stats()/advancedStats() use. This screen shows
  // both families of KPI side by side, so a row that one counts and the other
  // doesn't makes win-rate and profit-factor describe different populations.
  const closed  = trades.filter(isClosed);
  const winners = closed.filter(t => calcTotal(t) > 0);
  const losers  = closed.filter(t => calcTotal(t) <= 0);
  const winSum  = winners.reduce((s, t) => s + calcTotal(t), 0);
  const lossSum = Math.abs(losers.reduce((s, t) => s + calcTotal(t), 0));
  const pf      = lossSum > 0 ? winSum / lossSum : null;

  let curW = 0, maxW = 0, curL = 0, maxL = 0;
  [...closed].sort((a, b) => a.entryDate.localeCompare(b.entryDate)).forEach(t => {
    if (calcTotal(t) > 0) { curW++; maxW = Math.max(maxW, curW); curL = 0; }
    else               { curL++; maxL = Math.max(maxL, curL); curW = 0; }
  });

  // Same risk definition the rest of the app uses — this used to inline its own
  // and so kept the fee-dominated outliers calcStopRisk already rejects.
  let rSum = 0, rCount = 0;
  closed.forEach(t => {
    const risk = calcStopRisk(t);
    if (risk > 0) { rSum += calcTotal(t) / risk; rCount++; }
  });
  const avgR = rCount > 0 ? rSum / rCount : 0;

  // Negatives dropped their sign entirely and leaned on the red class alone, so
  // "הפסד ממוצע $44.00" read as a gain in any context where color is lost.
  const fmt = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct  = v => v.toFixed(1) + '%';

  // Broker-derived portfolio size gets its own full-width card above the grid.
  // Locked to the same מניות/קריפטו/הכל filter the KPIs below already use — it
  // used to run its own independent broker pick, so picking "קריפטו" up top
  // could still show the IBKR (stock) balance in this card, right above stats
  // that were only ever measuring the crypto book.
  const _SCOPE_BROKER = { stock: 'ibkr', crypto: 'bybit' };
  const scopeBroker = _SCOPE_BROKER[statsScope] || null;
  const brokerList = Object.keys(_brokerEquityByBroker);
  let portfolioCard = null;
  if (scopeBroker) {
    // Single deterministic broker for this scope — no picker, same as the
    // existing "only one broker connected" case never showing one either.
    if (scopeBroker in _brokerEquityByBroker) {
      portfolioCard = {
        label: `גודל תיק ${_BROKER_NAMES[scopeBroker] || scopeBroker}`,
        value: '$' + _brokerEquityByBroker[scopeBroker].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        brokerDD: null,
      };
    }
  } else if (_brokerEquityUsd != null) {
    // statsScope 'all' — combined by default, with the existing dropdown to
    // peek at one connected broker without leaving the combined stats scope.
    const selectedEquity = _brokerEquitySelected != null ? _brokerEquityByBroker[_brokerEquitySelected] : _brokerEquityUsd;
    portfolioCard = {
      label: _brokerEquitySelected != null
        ? `גודל תיק ${_BROKER_NAMES[_brokerEquitySelected] || _brokerEquitySelected}`
        : _brokerEquityLabel,
      value: '$' + (selectedEquity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      brokerDD: brokerList.length > 1 ? brokerList : null,
    };
  }

  // Curated down from 15 flat tiles to the 8 numbers that actually drive a
  // go/no-go read on the book — best/worst trade, avg trade, hold-time and
  // drawdown stayed available lower in the tab (Trading Summary) instead of
  // repeating here, per the user's "too crowded" feedback.
  const maxWin  = winners.length ? Math.max(...winners.map(t => calcTotal(t))) : 0;
  const maxLoss = losers.length  ? Math.min(...losers.map(t => calcTotal(t)))  : 0;
  const ICON_DOLLAR = '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  const ICON_TARGET = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>';
  const ICON_BARS   = '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>';
  const ICON_PCT    = '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>';
  const ICON_UP     = '<path d="M14 9V5a3 3 0 0 0-3-3L7 11v10h10.3a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>';
  const ICON_DOWN   = '<path d="M10 15v4a3 3 0 0 0 3 3l4-8V4H6.7a2 2 0 0 0-2 1.7l-1.4 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>';
  const ICON_SWAP   = '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
  const ICON_TROPHY = '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M5 4H3v2a4 4 0 0 0 4 4M19 4h2v2a4 4 0 0 1-4 4"/>';
  const ICON_FROWN  = '<circle cx="12" cy="12" r="9"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>';
  // No closed trades yet: several of these cards would otherwise show a
  // fabricated "+$0.00" / "0.0%" (fmt(0) and pct(0) both format fine, they're
  // just not measuring anything) — matches how fmtR already renders "—" for
  // an unmeasurable value instead of a real one.
  const noDataYet = st.nClosed === 0;
  const kpiCards = [
    { label: t('kpi_pnl'), tip: 'רווח/הפסד כולל בתקופה ובסקופ הנבחרים (עסקאות סגורות בלבד)', value: noDataYet ? '—' : fmt(st.total), sub: `${st.nClosed} ${t('trades')}${st.nOpen ? ` · ${st.nOpen} פתוחות` : ''}`, cls: st.total >= 0 ? 'c-green' : 'c-red', valCls: noDataYet ? '' : (st.total >= 0 ? 'green' : 'red'), sensitive: true, icon: ICON_DOLLAR },
    { label: t('st_win_rate'), tip: 'אחוז העסקאות הסגורות שהסתיימו ברווח', value: noDataYet ? '—' : pct(st.wr), sub: `${st.wins}W / ${losers.length}L`, cls: st.wr >= 50 ? 'c-green' : 'c-red', valCls: noDataYet ? '' : (st.wr >= 50 ? 'green' : 'red'), icon: ICON_TARGET },
    { label: 'Profit Factor', tip: 'סך הרווחים חלקי סך ההפסדים — מעל 1 אומר שהמערכת רווחית', value: pf != null ? pf.toFixed(2) : '—', sub: pf != null ? (pf >= 1 ? 'רווחי' : 'לא רווחי') : '', cls: pf != null ? (pf >= 1 ? 'c-green' : 'c-red') : 'c-blue', valCls: pf != null ? (pf >= 1 ? 'green' : 'red') : '', icon: ICON_BARS },
    { label: t('st_avg_r'), tip: 'רווח/הפסד ממוצע ביחס לסיכון המתוכנן — סטופ שהוגדר, או אם לא הוגדר סטופ, מרחק הכניסה ממחיר היציאה בפועל', value: rCount ? avgR.toFixed(2) + 'R' : '—', sub: rCount ? `${rCount} עסקאות עם סיכון מדיד` : '', cls: avgR >= 0 ? 'c-green' : 'c-red', valCls: rCount ? (avgR >= 0 ? 'green' : 'red') : '', icon: ICON_PCT },
    { label: t('st_avg_win'), tip: 'רווח ממוצע בעסקה מנצחת', value: winners.length ? fmt(adv.avgWin) : '—', sub: winners.length ? `מקסימום: ${fmt(maxWin)}` : '', cls: 'c-green', valCls: winners.length ? 'green' : '', sensitive: true, icon: ICON_UP },
    { label: t('st_avg_loss'), tip: 'הפסד ממוצע בעסקה מפסידה', value: losers.length ? fmt(adv.avgLoss) : '—', sub: losers.length ? `מקסימום: ${fmt(maxLoss)}` : '', cls: 'c-red', valCls: losers.length ? 'red' : '', sensitive: true, icon: ICON_DOWN },
    { label: t('st_wl_ratio'), tip: 'רווח ממוצע חלקי הפסד ממוצע', value: adv.avgLoss !== 0 ? Math.abs(adv.avgWin / adv.avgLoss).toFixed(2) + 'x' : '—', sub: 'רווח / הפסד ממוצע', cls: 'c-blue', valCls: '', icon: ICON_SWAP },
    { label: t('st_max_win_streak'), tip: 'הרצף הארוך ביותר של עסקאות מנצחות ברציפות', value: maxW, sub: 'עסקאות רצופות', cls: 'c-green', valCls: 'green', icon: ICON_TROPHY },
    { label: t('st_max_loss_streak'), tip: 'הרצף הארוך ביותר של עסקאות מפסידות ברציפות', value: maxL, sub: 'עסקאות רצופות', cls: 'c-red', valCls: 'red', icon: ICON_FROWN },
  ];

  const grid = document.getElementById('stats-kpi-grid');
  if (grid) {
    const portfolioHtml = portfolioCard ? `
      <div class="kpi-card portfolio-hero c-blue" title="שווי התיק כפי שדווח מהברוקר המחובר, לא ערך מוזן ידנית">
        <div class="kpi-label" style="display:flex;align-items:center;gap:6px;justify-content:center;">
          <span>${portfolioCard.label}</span>
          ${portfolioCard.brokerDD ? `
            <div id="port-equity-dd" class="scope-dd">
              <button class="scope-dd-btn" onclick="toggleScopeDD('port-equity-dd')" aria-label="בחר ברוקר להצגה" title="בחר ברוקר להצגה">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="scope-dd-menu" id="port-equity-menu">
                <button class="${_brokerEquitySelected == null ? 'active' : ''}" ${_brokerEquitySelected == null ? 'aria-current="true"' : ''} onclick="_setBrokerEquitySelected(null,this)">כל הברוקרים</button>
                ${portfolioCard.brokerDD.map(b => `<button class="${_brokerEquitySelected === b ? 'active' : ''}" ${_brokerEquitySelected === b ? 'aria-current="true"' : ''} onclick="_setBrokerEquitySelected('${b}',this)">${_BROKER_NAMES[b] || b}</button>`).join('')}
              </div>
            </div>` : ''}
        </div>
        <div class="kpi-value sensitive">${portfolioCard.value}</div>
      </div>` : '';
    const cardHtml = k => `
      <div class="kpi-card ${k.cls}" title="${k.tip}">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.valCls}${k.sensitive ? ' sensitive' : ''}">${k.value}</div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
      </div>`;
    // Spans every column except the last one, placed right before the final
    // KPI card in DOM order — the grid's auto-placement then has no choice but
    // to start it on a fresh row (an explicit column-1 start can't land
    // mid-row) and drop the last card into the one column left beside it,
    // exactly filling the gap a row of leftover cards would otherwise leave.
    // Grid-line indices are relative, so this holds at any column count the
    // responsive auto-fit grid resolves to, not just today's width.
    const lastCard = kpiCards[kpiCards.length - 1];
    const cardsHtml = kpiCards.slice(0, -1).map(cardHtml).join('') + `
      <div style="grid-column:1/-2;padding:6px 2px;">
        <div class="kpi-label" style="text-align:right;margin-bottom:6px;">משך זמן ממוצע לפי סוג עסקה</div>
        <div id="hold-compare-wrap"></div>
      </div>` + cardHtml(lastCard);
    grid.innerHTML = portfolioHtml + `<div class="kpi-grid-hero">${cardsHtml}</div>`;
    // Rebuilt fresh on every render, so it has to be reparented here every
    // time (not just once at DOMContentLoaded like the other scope-dd-menus)
    // — .kpi-card's fadeUp animation leaves a permanent (fill-mode: both)
    // transform behind, which makes it a containing block for this
    // position:fixed menu and detaches it from its trigger button otherwise.
    const _peMenu = document.getElementById('port-equity-menu');
    if (_peMenu) document.body.appendChild(_peMenu);
  }

  renderHoldCompare(adv);
  renderDonut(st, adv, trades);
  renderDrawdownChart(trades);
  renderRHistogram(trades);
  const secondary = document.getElementById('stats-secondary-content');
  if (secondary && getComputedStyle(secondary).display !== 'none') {
    renderMonthlyTracker(trades);
    renderSetupBreakdown(trades);
    renderHoldBreakdown(trades);
    renderPivotDistance(trades);
    renderComparison(stTrades, crTrades);
  }
  applyPrivacy();
}

// Which setup actually pays. Expectancy is the number that matters here: a
// setup can win often and still lose money, and with the book's 25.8% hit rate
// and wins smaller than losses that is exactly the shape to watch for.
function renderSetupBreakdown(trades) {
  const host = document.getElementById('setup-breakdown-wrap');
  if (!host) return;
  const closed = trades.filter(t => t.closeDate && t.exitPrice);
  const tagged = closed.filter(t => t.setupType);
  if (!tagged.length) {
    host.innerHTML = `<div style="padding:14px 16px;background:var(--card);
      border:1px solid var(--border);border-radius:var(--r-lg);color:var(--text2);font-size:12px;line-height:1.7">
      אף עסקה סגורה עדיין לא מתויגת בסוג סטאפ. תייג כמה ב״להשלמה״ שבסקירה הכללית — משם מגיע הפילוח.
      </div>`;
    return;
  }
  const groups = {};
  tagged.forEach(t => {
    const k = t.setupType;
    (groups[k] = groups[k] || []).push(t);
  });
  const rows = Object.entries(groups).map(([k, arr]) => {
    const pnl = arr.map(calcTotal);
    const wins = pnl.filter(v => v > 0), losses = pnl.filter(v => v <= 0);
    const total = pnl.reduce((a, b) => a + b, 0);
    const wr = arr.length ? wins.length / arr.length * 100 : 0;
    const avgW = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgL = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    const exp = arr.length ? total / arr.length : 0;
    // R only where a stop was recorded, so this stays honest about coverage
    const rs = arr.map(t => { const r = calcStopRisk(t); return r ? calcTotal(t) / r : null; }).filter(v => v != null);
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    return { k, n: arr.length, wr, avgW, avgL, total, exp, avgR, rn: rs.length,
             nWins: wins.length, nLosses: losses.length };
  }).sort((a, b) => b.total - a.total);

  const untagged = closed.length - tagged.length;
  host.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;min-width:0;border-collapse:collapse;font-size:12px">
    <thead><tr style="color:var(--text3);text-align:right">
      <th style="padding:7px 8px;font-weight:600">סטאפ</th>
      <th style="padding:7px 8px;font-weight:600">עסקאות</th>
      <th style="padding:7px 8px;font-weight:600">הצלחה</th>
      <th style="padding:7px 8px;font-weight:600">רווח ממוצע</th>
      <th style="padding:7px 8px;font-weight:600">הפסד ממוצע</th>
      <th style="padding:7px 8px;font-weight:600">תוחלת</th>
      <th style="padding:7px 8px;font-weight:600">R ממוצע</th>
      <th style="padding:7px 8px;font-weight:600">סה״כ</th>
    </tr></thead><tbody>
    ${rows.map(r => `<tr style="border-top:1px solid rgba(255,255,255,0.05)">
      <td style="padding:7px 8px;font-weight:600">${SETUP_LABELS[r.k] || r.k}</td>
      <td style="padding:7px 8px">${r.n}</td>
      <td style="padding:7px 8px">${r.wr.toFixed(0)}%</td>
      <td style="padding:7px 8px" class="num-green sensitive">${r.nWins ? fmtUSD(r.avgW) : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="padding:7px 8px" class="num-red sensitive">${r.nLosses ? fmtUSD(r.avgL) : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="padding:7px 8px;font-weight:700" class="${r.exp>=0?'num-green':'num-red'} sensitive">${fmtUSD(r.exp)}</td>
      <td style="padding:7px 8px">${r.avgR==null?'<span style="color:var(--text3)">—</span>':
          `<span class="${r.avgR>=0?'num-green':'num-red'}">${r.avgR>=0?'+':''}${r.avgR.toFixed(2)}R</span>
           <span style="color:var(--text3);font-size:10px">(${r.rn})</span>`}</td>
      <td style="padding:7px 8px;font-weight:700" class="${r.total>=0?'num-green':'num-red'} sensitive">${fmtUSD(r.total)}</td>
    </tr>`).join('')}
    </tbody></table>
    ${untagged ? `<div style="color:var(--text3);font-size:11px;margin-top:8px">
      ${untagged} עסקאות סגורות עדיין בלי סטאפ ולא נכללות כאן.</div>` : ''}
  </div>`;
}

// How long a position was given to work. Across the book, exits inside two days
// hit 5% and everything held past three weeks was the only positive bucket, so
// this is the cut that separates the strategy from the impatience.
const HOLD_BUCKETS = [
  { max: 0,        label: 'תוך-יומי' },
  { max: 2,        label: '1–2 ימים' },
  { max: 5,        label: '3–5 ימים' },
  { max: 20,       label: '6–20 ימים' },
  { max: Infinity, label: '20+ ימים' },
];
function renderHoldBreakdown(trades) {
  const host = document.getElementById('hold-breakdown-wrap');
  if (!host) return;
  const closed = trades.filter(t => t.closeDate && t.exitPrice && _holdDays(t) !== null);
  if (!closed.length) {
    host.innerHTML = `<div style="padding:14px 16px;background:var(--card);
      border:1px solid var(--border);border-radius:var(--r-lg);color:var(--text2);font-size:12px">
      אין עסקאות סגורות עם תאריך סגירה בתקופה שנבחרה.</div>`;
    return;
  }
  const rows = HOLD_BUCKETS.map((b, i) => {
    const lo = i === 0 ? -1 : HOLD_BUCKETS[i - 1].max;
    const arr = closed.filter(t => { const d = _holdDays(t); return d > lo && d <= b.max; });
    if (!arr.length) return null;
    const pnl = arr.map(calcTotal);
    const total = pnl.reduce((a, c) => a + c, 0);
    const wins = pnl.filter(v => v > 0).length;
    return { label: b.label, n: arr.length, wr: wins / arr.length * 100, avg: total / arr.length, total };
  }).filter(Boolean);

  const worst = Math.max(...rows.map(r => Math.abs(r.total)), 1);
  host.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;min-width:0;border-collapse:collapse;font-size:12px">
    <thead><tr style="color:var(--text3);text-align:right">
      <th style="padding:7px 8px;font-weight:600">זמן החזקה</th>
      <th style="padding:7px 8px;font-weight:600">עסקאות</th>
      <th style="padding:7px 8px;font-weight:600">הצלחה</th>
      <th style="padding:7px 8px;font-weight:600">ממוצע לעסקה</th>
      <th style="padding:7px 8px;font-weight:600">סה״כ</th>
      <th style="padding:7px 8px;font-weight:600;width:180px"></th>
    </tr></thead><tbody>
    ${rows.map(r => `<tr style="border-top:1px solid rgba(255,255,255,0.05)">
      <td style="padding:7px 8px;font-weight:600">${r.label}</td>
      <td style="padding:7px 8px">${r.n}</td>
      <td style="padding:7px 8px" class="${r.wr>=50?'num-green':r.wr<20?'num-red':''}">${r.wr.toFixed(0)}%</td>
      <td style="padding:7px 8px" class="${r.avg>=0?'num-green':'num-red'} sensitive">${fmtUSD(r.avg)}</td>
      <td style="padding:7px 8px;font-weight:700" class="${r.total>=0?'num-green':'num-red'} sensitive">${fmtUSD(r.total)}</td>
      <td style="padding:7px 8px">
        <div style="height:6px;border-radius:var(--r-sm);background:rgba(255,255,255,0.05);overflow:hidden">
          <div style="height:100%;width:${Math.abs(r.total)/worst*100}%;background:${r.total>=0?'var(--green)':'var(--red)'}"></div>
        </div>
      </td>
    </tr>`).join('')}
    </tbody></table></div>`;
}


let _ddResizeObserver = null;
function renderDrawdownChart(trades) {
  destroyChart('dd');
  if (_ddResizeObserver) { _ddResizeObserver.disconnect(); _ddResizeObserver = null; }
  showChart('skel-dd', 'chart-dd');
  const el = document.getElementById('chart-dd');
  const statsEl = document.getElementById('dd-stats');
  if (!el) return;
  const { points, maxDrawdown, current, pctMode } = calcDrawdownSeries(trades);
  const wrapEl = el.parentElement;
  if (!points.length) {
    _showChartEmpty(el, 'אין עדיין עסקאות סגורות למדידת ירידת הון');
    if (statsEl) statsEl.innerHTML = '';
    return;
  }
  _hideChartEmpty(el);
  // MM-DD alone reads as nonsense once the series crosses a year boundary
  // (07-11 ... 01-15 ... 08-31 looks like it goes backward in time) — fmtDate
  // includes the 2-digit year so the axis stays chronological to the eye.
  const labels = ['', ...points.map(p => fmtDate(p.date))];
  const data = [0, ...points.map(p => +p.drawdown.toFixed(2))];
  const ctx2d = el.getContext('2d');
  const ddRgb = cssVarRgb('--red');
  const grad = ctx2d.createLinearGradient(0, 0, 0, el.offsetHeight || 150);
  grad.addColorStop(0,    `rgba(${ddRgb},0.00)`);
  grad.addColorStop(0.55, `rgba(${ddRgb},0.10)`);
  grad.addColorStop(1,    `rgba(${ddRgb},0.24)`);
  charts.dd = new Chart(ctx2d, {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Drawdown', data, borderColor: cssVar('--red'), backgroundColor: grad,
      tension: 0.35, fill: true, pointRadius: data.length > 20 ? 0 : 4,
      pointBackgroundColor: cssVar('--red'), borderWidth: 2,
    }] },
    options: {
      ...chartDefaults('line'),
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,18,36,0.95)', titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: false,
          callbacks: { label: c => ` ${(+c.raw).toFixed(2)}${pctMode ? '%' : '$'}` }
        }
      },
      layout: { padding: { top: 8, right: 12, bottom: 0, left: 0 } },
      scales: {
        x: { ticks: { color: getTickColor(), font: CHART_FONT, maxTicksLimit: 8 }, grid: { color: getGridColor(), drawBorder: false } },
        y: { ticks: { color: getTickColor(), font: CHART_FONT, callback: v => (+v).toFixed(1) + (pctMode ? '%' : '$') }, grid: { color: getGridColor(), drawBorder: false } }
      }
    }
  });
  if (wrapEl) {
    _ddResizeObserver = new ResizeObserver(() => charts.dd?.resize());
    _ddResizeObserver.observe(wrapEl);
  }
  if (statsEl) {
    statsEl.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;">
      <span style="color:var(--text3)">ירידה נוכחית: <b style="color:var(--red)">${current.toFixed(2)}${pctMode ? '%' : '$'}</b></span>
      <span style="color:var(--text3)">ירידה מקסימלית: <b style="color:var(--red)">${maxDrawdown.toFixed(2)}${pctMode ? '%' : '$'}</b></span>
    </div>`;
  }
}

function renderRHistogram(trades) {
  destroyChart('rhist');
  showChart('skel-rhist', 'chart-rhist');
  const el = document.getElementById('chart-rhist');
  const statsEl = document.getElementById('rhist-stats');
  if (!el) return;
  const { buckets, counted } = calcRHistogram(trades);
  const wrapEl = el.parentElement;
  if (!counted) {
    _showChartEmpty(el, 'אין עדיין עסקאות סגורות עם סיכון מדיד למדידת R');
    if (statsEl) statsEl.innerHTML = '';
    return;
  }
  _hideChartEmpty(el);
  const ctx2d = el.getContext('2d');
  // A bucket with 1-2 trades renders a near-zero-height bar next to a bucket
  // with 25 — the count is real but invisible next to the tall bars. Draw the
  // count above every non-empty bar so a thin sliver still reads as data.
  const rhistCountLabels = {
    id: 'rhistCountLabels',
    afterDatasetsDraw(chart) {
      const { ctx, data } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = getTickColor();
      ctx.font = CHART_FONT.weight + ' 11px ' + CHART_FONT.family;
      ctx.textAlign = 'center';
      meta.data.forEach((bar, i) => {
        const count = data.datasets[0].data[i];
        if (!count) return;
        ctx.fillText(count, bar.x, bar.y - 6);
      });
      ctx.restore();
    }
  };
  charts.rhist = new Chart(ctx2d, {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{
        data: buckets.map(b => b.count),
        backgroundColor: buckets.map(b => `rgba(${b.max <= 0 ? cssVarRgb('--red') : cssVarRgb('--green')},0.65)`),
        borderRadius: 4, borderSkipped: false,
        minBarLength: 3,
      }]
    },
    plugins: [rhistCountLabels],
    options: {
      ...chartDefaults('bar'),
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,18,36,0.95)', titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: false,
          callbacks: { label: c => ` ${c.raw} עסקאות` }
        }
      },
      layout: { padding: { top: 20, right: 12, bottom: 0, left: 0 } },
      scales: {
        x: { ticks: { color: getTickColor(), font: CHART_FONT }, grid: { display: false } },
        y: { ticks: { color: getTickColor(), font: CHART_FONT, precision: 0 }, grid: { color: getGridColor(), drawBorder: false } }
      }
    }
  });
  if (statsEl) {
    statsEl.innerHTML = `<div style="text-align:center;font-size:12px;color:var(--text3)">${counted} עסקאות עם סיכון מדיד נספרו</div>`;
  }
}

// Horizontal bar comparison of avg holding time, winners vs losers — reads the
// same adv (advancedStats) values already computed for the KPI grid, filtered
// by whatever period/scope renderStatistics is currently showing.
function renderHoldCompare(adv) {
  const wrap = document.getElementById('hold-compare-wrap');
  if (!wrap) return;
  const win = adv.avgWinDays, loss = adv.avgLossDays;
  const max = Math.max(win, loss, 0.01);
  const row = (label, days, color) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
      <div style="width:40px;flex-shrink:0;font-size:13px;font-weight:600;color:var(--text2);">${label}</div>
      <div style="flex:1;height:4px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;">
        <div style="width:${Math.min(days / max * 100, 100)}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <div style="width:36px;flex-shrink:0;font-size:13px;font-weight:700;color:var(--text);text-align:left;">${days.toFixed(1)}d</div>
    </div>`;
  const ratio = win > 0 && loss > 0
    ? (win >= loss ? `${(win / loss).toFixed(1)}:1` : `1:${(loss / win).toFixed(1)}`)
    : '—';
  wrap.innerHTML = row('מנצחת', win, '#0d9488') + row('הפסד', loss, '#e11d48')
    + `<div style="text-align:center;font-size:13px;font-weight:700;color:var(--text);margin-top:2px;">יחס: ${ratio}</div>`;
}

function renderDonut(st, adv, trades) {
  destroyChart('donut');
  showChart('skel-donut', 'chart-donut');
  const rowEl = document.getElementById('donut-row');
  if (rowEl) rowEl.style.display = 'flex';
  const donutEl = document.getElementById('chart-donut'); if (!donutEl) return;
  const ctx = donutEl.getContext('2d');
  const closedCount = st.nClosed ?? ((st.wins || 0) + (st.losses || 0));
  const winPct = closedCount ? (st.wins / closedCount * 100).toFixed(1) : '0.0';
  const lossPct = closedCount ? (st.losses / closedCount * 100).toFixed(1) : '0.0';
  const winEl  = document.getElementById('donut-legend-win');
  const lossEl = document.getElementById('donut-legend-loss');
  if (winEl) winEl.innerHTML = `
    <div class="donut-legend-lbl"><span class="donut-legend-dot" style="background:var(--green);"></span>${t('donut_wins')}</div>
    <div class="donut-legend-val" style="color:var(--green);">${st.wins || 0} (${winPct}%)</div>`;
  if (lossEl) lossEl.innerHTML = `
    <div class="donut-legend-lbl"><span class="donut-legend-dot" style="background:var(--red);"></span>${t('donut_losses')}</div>
    <div class="donut-legend-val" style="color:var(--red);">${st.losses || 0} (${lossPct}%)</div>`;
  charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [t('donut_win'), t('donut_loss')],
      datasets: [{
        data: [st.wins || 0, st.losses || 0],
        backgroundColor: [cssVar('--green'), cssVar('--red')],
        borderColor: 'rgba(0,0,0,0)',
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: c => ` ${c.label}: ${c.raw} (${closedCount ? (c.raw/closedCount*100).toFixed(1) : 0}%)` }
        }
      },
      cutout: '70%',
      animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300 }
    }
  });

  // ── Compute extra stats ──────────────────────────
  // Profit Factor, W/L Ratio and the win/loss streaks now live in the KPI grid
  // above — kept here would be the same numbers twice on one tab. Best/worst
  // trade are the only donut-adjacent numbers not already shown elsewhere.
  const none = '—';
  const bestStr  = st.n ? fmtUSD(st.best)  : none;
  const worstStr = st.n ? fmtUSD(st.worst) : none;

  const el = document.getElementById('donut-stats');
  if (el) el.innerHTML = `
    <div class="donut-stat">
      <div class="donut-stat-label">${t('donut_best')}</div>
      <div class="donut-stat-value green sensitive">${bestStr}</div>
    </div>
    <div class="donut-stat">
      <div class="donut-stat-label">${t('donut_worst')}</div>
      <div class="donut-stat-value red sensitive">${worstStr}</div>
    </div>`;
  applyPrivacy();
}

let _compScopeData = { st: [], cr: [] };
let _compScope = 'all';

function _renderCompBody(scope) {
  const tr = scope === 'stock' ? _compScopeData.st
           : scope === 'crypto' ? _compScopeData.cr
           : [..._compScopeData.st, ..._compScopeData.cr];
  const accentColor = scope === 'stock' ? '#818cf8' : scope === 'crypto' ? '#f59e0b' : '#4f83ff';
  const st = stats(tr);
  const adv = advancedStats(tr);
  const wl    = adv.avgLoss!==0 ? Math.abs(adv.avgWin/adv.avgLoss).toFixed(2)+'x' : '—';
  document.getElementById('comp-card-inner').innerHTML = `
    <div class="comp-stat"><span class="comp-stat-label">${_lang==='he'?'יחס רווח ממוצע להפסד ממוצע':'Average win / loss ratio'}</span><span class="comp-stat-val sensitive">${wl}</span></div>
    <div class="comp-stat"><span class="comp-stat-label">${t('comp_avg_trade')}</span><span class="comp-stat-val ${clr(st.avg)} sensitive">${st.n?fmtUSD(st.avg):'—'}</span></div>
  `;
  document.getElementById('comp-card-wrap').style.borderTopColor = accentColor;
  applyPrivacy();
}

function _switchCompScope(scope) {
  _compScope = scope;
  _renderCompBody(scope);
}

function renderComparison(stTrades, crTrades) {
  _compScopeData = { st: stTrades, cr: crTrades };
  document.getElementById('comparison-wrap').innerHTML =
    `<div class="comp-card" id="comp-card-wrap" style="border-top:2px solid #4f83ff;"><div id="comp-card-inner"></div></div>`;
  _renderCompBody(statsScope);
}

