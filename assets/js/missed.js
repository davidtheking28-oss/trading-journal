// Loaded on demand; account cache and database mutations remain in dashboard.js.
const _MISSED_COLLAPSE_KEY = () => 'missed_toggled_' + (_currentUser?.id || 'anon');
const _MISSED_MONTH_THRESHOLD = 8; // a month with fewer cards than this always starts open
function _missedLoadToggled() {
  try { return new Set(JSON.parse(localStorage.getItem(_MISSED_COLLAPSE_KEY())) || []); } catch { return new Set(); }
}
function _missedSaveToggled(set) {
  try { localStorage.setItem(_MISSED_COLLAPSE_KEY(), JSON.stringify([...set])); } catch {}
}
function missedToggleSection(key) {
  const toggled = _missedLoadToggled();
  if (toggled.has(key)) toggled.delete(key); else toggled.add(key);
  _missedSaveToggled(toggled);
  document.getElementById('missed-section-' + key)?.classList.toggle('collapsed');
}

// Cross-check: was a symbol logged as a missed opportunity eventually traded?
// Matches by symbol against every entry strictly after the missed date and
// returns the earliest such trade — a later re-entry doesn't change the
// answer to "did this ever get acted on". No new field needed: symbol+date
// is already on both sides.
function missedFollowThrough(missedItem, trades) {
  const later = trades.filter(t => t.symbol === missedItem.sym && t.entryDate && t.entryDate > missedItem.date);
  if (!later.length) return null;
  return later.reduce((a, b) => a.entryDate < b.entryDate ? a : b);
}

function missedRenderList(list) {
  const container = document.getElementById('missed-tbody');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = `<div class="missed-empty">${t('missed_empty')}</div>`;
    return;
  }
  const allTrades = [...db.stocks, ...db.crypto].filter(t => !t.deleted);
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
  // Two-level grouping: year (the archive — every past year starts collapsed
  // so old history doesn't dominate the page but is always one click away)
  // then month within the year (the current month always starts open; a
  // heavy past month inside the current year also starts collapsed).
  const byYear = {};
  sorted.forEach(r => {
    const y = r.date.slice(0, 4);
    (byYear[y] ??= []).push(r);
  });
  const thisYear = String(new Date().getFullYear());
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const toggled = _missedLoadToggled();
  const byMonthCount = {};
  sorted.forEach(r => { const k = r.date.slice(0, 7); byMonthCount[k] = (byMonthCount[k] || 0) + 1; });
  const collapsed = key => {
    const defaultCollapsed = key.length === 4
      ? key !== thisYear                                                    // year key
      : key !== thisMonthKey && byMonthCount[key] >= _MISSED_MONTH_THRESHOLD; // month key
    return toggled.has(key) ? !defaultCollapsed : defaultCollapsed;
  };

  const cardHtml = r => `
      <div class="missed-card" id="missed-row-${r.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
          <div class="missed-card-sym" style="display:flex;align-items:center;gap:8px;min-width:0"><img src="${_symLogoUrl({symbol:r.sym},'stock')}" alt="" loading="lazy" width="24" height="24" style="border-radius:50%;object-fit:cover;background:var(--bg);flex-shrink:0" onerror="this.style.visibility='hidden'"><span>${esc(r.sym)}</span></div>
          <div class="missed-card-actions">
            <button type="button" class="missed-del-btn" onclick="missedOpenChart('${esc(String(r.id))}')" aria-label="${_lang==='he'?'גרף כניסה מתוכננת':'Planned entry chart'} · ${esc(r.sym)}" title="${_lang==='he'?'גרף כניסה':'Entry chart'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></svg></button>
            <button class="missed-del-btn edit" onclick="missedEdit('${r.id}')" title="ערוך">✏</button>
            <button class="missed-del-btn" onclick="missedDelete('${r.id}')" title="מחק">✕</button>
          </div>
        </div>
        <div class="missed-card-price sensitive">$${fmtPrice(r.price)}</div>
        <div class="missed-card-meta">${r.sector ? esc(r.sector)+' · ' : ''}${fmtDate(r.date)}</div>
        <div class="missed-since sensitive" id="missed-since-${r.id}"></div>
        ${(() => { const ft = missedFollowThrough(r, allTrades); return ft
          ? `<div class="missed-card-meta" style="color:var(--green)">✓ בסוף נסחר ב-${fmtDate(ft.entryDate)}</div>` : ''; })()}
        ${r.note ? `<div class="missed-card-note">${esc(r.note)}</div>` : ''}
      </div>`;

  const sectionHtml = (key, label, count, depth, innerHtml) => `
      <div class="missed-${depth}-section${collapsed(key) ? ' collapsed' : ''}" id="missed-section-${key}">
        <div class="missed-${depth}-label" onclick="missedToggleSection('${key}')">
          <svg class="missed-month-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3.5L5 6.5L8 3.5"/></svg>
          ${label} <span style="color:var(--accent);font-size:10px;font-weight:800">${count}</span>
          ${depth === 'month' ? `<span class="missed-month-pnl sensitive" id="missed-month-pnl-${key}"></span>` : ''}
        </div>
        <div class="missed-${depth}-body">${innerHtml}</div>
      </div>`;

  // Object.entries on numeric-looking keys ("2025","2026") always iterates
  // ascending regardless of insertion order — that's a JS engine rule, not a
  // sort this code was doing — so the oldest year rendered first (top) no
  // matter what. Sorted explicitly descending here: newest year on top,
  // oldest (2025) at the bottom.
  container.innerHTML = Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).map(([year, yearItems]) => {
    // Months and their cards read newest-first, same direction as the
    // year-level order above.
    const byMonth = {};
    [...yearItems].sort((a, b) => b.date.localeCompare(a.date))
      .forEach(r => { const k = r.date.slice(0, 7); (byMonth[k] ??= []).push(r); });
    const monthsHtml = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([key, items]) => {
      const label = months()[+key.slice(5, 7) - 1];
      const cards = `<div class="missed-cards">${items.map(cardHtml).join('')}</div>`;
      return sectionHtml(key, label, items.length, 'month', cards);
    }).join('');
    return sectionHtml(year, year, yearItems.length, 'year', monthsHtml);
  }).join('');

  container.querySelectorAll('.missed-card').forEach((el, i) => {
    el.style.setProperty('--i', i);
    el.classList.add('animate-in');
  });
  // Whatever quotes are already warm in the cache (e.g. a re-render within
  // the TTL) paint immediately; missedFollowUp repaints once fresh ones land.
  _paintMissedMonthSummaries(list);
}

// "Was this month, across everything I passed on, actually a good one?" —
// the average % move from the logged price to the latest quote, over every
// row in the month that has both. No position size is recorded here (these
// were never bought), so a dollar total isn't answerable — the average % is.
// Last calendar day of a 'YYYY-MM' month key, as 'YYYY-MM-DD'. Day 0 of the
// following month is the trick — Date normalizes a 0 day back into the last
// day of the month before it.
function _monthEndDate(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
function _missedIsCurrentMonth(monthKey) {
  return monthKey === new Date().toISOString().slice(0, 7);
}
// The month's OWN move, not the drift since the user happened to log it — a
// row from March read against today's price mixes six months of unrelated
// market movement into "was March good". Past months compare against the
// close on that month's last trading day (_missedHistClose, fetched once,
// never stale — history doesn't change); the still-open current month has no
// "end" yet, so it uses the same live quote the per-row "% since" already shows.
function _missedMonthAvgPct(items, monthKey) {
  const current = _missedIsCurrentMonth(monthKey);
  const pts = items.map(r => {
    const sym = (r.sym || '').toUpperCase();
    const base = +r.price || 0;
    if (!base) return null;
    const price = current ? _missedQuotes[sym]?.p : _missedHistClose[sym + '|' + monthKey];
    return price ? (price - base) / base * 100 : null;
  }).filter(v => v !== null);
  return pts.length ? { avg: pts.reduce((a, b) => a + b, 0) / pts.length, n: pts.length, of: items.length } : null;
}
function _paintMissedMonthSummaries(list) {
  const byMonth = {};
  list.forEach(r => { const k = (r.date || '').slice(0, 7); if (k.length === 7) (byMonth[k] ??= []).push(r); });
  Object.entries(byMonth).forEach(([key, items]) => {
    const el = document.getElementById('missed-month-pnl-' + key);
    if (!el) return;
    const s = _missedMonthAvgPct(items, key);
    if (!s) { el.textContent = ''; el.title = ''; return; }
    const good = s.avg >= 0;
    const scope = _missedIsCurrentMonth(key) ? 'עד היום' : 'במהלך החודש עצמו';
    el.innerHTML = `<span class="${good ? 'num-green' : 'num-red'}">${good ? '📈' : '📉'} ${fmtPct(s.avg)} בממוצע</span>`;
    el.title = (s.n < s.of ? `מבוסס על ${s.n} מתוך ${s.of} — לחלק אין מחיר זמין. ` : `על ${s.n} עסקאות. `)
      + `שינוי ${scope}, לא מהיום שנרשם.`;
  });
  applyPrivacy();
}

// Historical closes are immutable once the month is over — no TTL, unlike
// _missedQuotes. Keyed 'SYM|YYYY-MM' since the same symbol can appear in
// several months.
const _missedHistClose = {};
async function _fetchMissedMonthHistory(list) {
  const need = [];
  const seen = new Set();
  list.forEach(r => {
    const monthKey = (r.date || '').slice(0, 7);
    const sym = (r.sym || '').toUpperCase();
    if (monthKey.length !== 7 || !sym || _missedIsCurrentMonth(monthKey) || symIsCrypto(sym)) return;
    const key = sym + '|' + monthKey;
    if (seen.has(key) || key in _missedHistClose) return;
    seen.add(key);
    need.push({ sym, monthKey, key });
  });
  if (!need.length) return;
  const token = await _getToken();
  await Promise.all(need.map(async ({ sym, monthKey, key }) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/finnhub?path=history&symbol=${encodeURIComponent(sym)}&date=${_monthEndDate(monthKey)}`,
        { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { const data = await res.json(); _missedHistClose[key] = data?.c || null; }
    } catch { /* leaves the key unset — next visit retries rather than caching a failure */ }
  }));
  _paintMissedMonthSummaries(list);
}

let _missedRenderSeq = 0;
async function missedRenderContent(force = false, loadedList) {
  const seq = ++_missedRenderSeq;
  const user = _currentUser;
  if (_missedLoaded && !force) {
    missedRenderList(_missedList);
    missedFollowUp(_missedList);
    _fetchMissedMonthHistory(_missedList);
    return;
  }
  const list = loadedList === undefined ? await missedLoad() : loadedList;
  if (seq !== _missedRenderSeq || _currentUser !== user || !document.getElementById('tab-missed')?.classList.contains('active')) return;
  _missedList = list;
  _missedLoaded = true;
  missedRenderList(list);
  _paintMissedReasons(list);
  missedFollowUp(list);
  _fetchMissedMonthHistory(list);
}

// A missed-opportunity log without an outcome is a list of regrets. This says
// what the trade would have done, which is the only part worth learning from.
// Quotes are cached with a timestamp, not forever. The old cache keyed on
// `=== undefined`, so the "% since" froze at whatever the price was the first
// time the tab opened — and the socket teardown on visibilitychange keeps this
// page alive in bfcache for days, so "first time" could be days ago.
// A failed fetch is never written to the cache either: the shared Finnhub key
// is rate-limited to 30/min per user and missedFollowUp fires every symbol at
// once, so a single 429 used to blank that symbol's percentage permanently.

// Why a setup was missed, read off the free-text note. Order matters: "didn't
// act because of the market" is a market call, not hesitation.
function _missedReason(note) {
  const n = (note || '').trim();
  if (!n) return 'none';
  if (/זוהה אוטומטית/.test(n)) return 'auto';
  if (/שוק|ריבית|תנודתי/.test(n)) return 'market';
  if (/לא שמתי לב|שכחתי|לא ראיתי|ברח לי|מילואים|לא סיננתי/.test(n)) return 'noticed';
  if (/גאפ|ניעור|ממוצע|סיכון|lps|נר /i.test(n)) return 'setup';
  if (/ביטחון|לא פעלתי|לא הייתי סגור|שאנן|היסוס|פחד/.test(n)) return 'doubt';
  return 'other';
}
const _MISSED_REASON_LBL = { market: 'שוק / ריבית', noticed: 'לא שמתי לב', doubt: 'היסוס', setup: 'בעיה בסטאפ', auto: 'זוהה אוטומטית', other: 'אחר', none: 'בלי הערה' };
// Grouped by reason, each with what those trades did since: the log itself
// shows the pattern only one card at a time.
function _paintMissedReasons(list) {
  const el = document.getElementById('missed-reasons');
  if (!el) return;
  if (!list.length) { el.innerHTML = ''; return; }
  const g = {};
  for (const r of list) {
    const k = _missedReason(r.note), p = _missedQuotes[(r.sym || '').toUpperCase()]?.p, base = +r.price || 0;
    (g[k] ??= { n: 0, chg: [] }).n++;
    if (p && base) g[k].chg.push((p - base) / base * 100);
  }
  const rows = Object.entries(g).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => {
    const avg = v.chg.length ? v.chg.reduce((s, x) => s + x, 0) / v.chg.length : null;
    const up = v.chg.length ? Math.round(v.chg.filter(x => x > 0).length / v.chg.length * 100) : null;
    return `<tr><td>${_MISSED_REASON_LBL[k]}</td><td>${v.n}</td><td>${avg == null ? '—' : `<span class="${avg >= 0 ? 'num-green' : 'num-red'}">${fmtPct(avg)}</span>`}</td><td>${up == null ? '—' : up + '%'}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="missed-reasons-title">למה פספסתי — ומה קרה אחר כך</div>`
    + `<table class="missed-reasons-table"><thead><tr><th scope="col">סיבה</th><th scope="col">פעמים</th><th scope="col">ממוצע מאז</th><th scope="col">עלו מאז</th></tr></thead><tbody>${rows}</tbody></table>`;
}
const _MISSED_QUOTE_TTL = 60_000;
async function missedFollowUp(list) {
  if (!list.length) return;
  const token = await _getToken();
  const syms = [...new Set(list.map(r => (r.sym || '').toUpperCase()).filter(Boolean))];
  await Promise.all(syms.map(async sym => {
    // Finnhub answers a crypto ticker with c:0, which looked identical to a
    // failed request — the card just stayed blank forever with no explanation.
    if (symIsCrypto(sym)) { _missedQuotes[sym] = { p: null, ts: Infinity }; }
    const hit = _missedQuotes[sym];
    if (!hit || Date.now() - hit.ts > _MISSED_QUOTE_TTL) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/finnhub?path=quote&symbol=${encodeURIComponent(sym)}`,
          { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          _missedQuotes[sym] = { p: +data.c || null, ts: Date.now() };
        }
      } catch { /* keep any previous quote rather than blanking the card */ }
    }
    const price = _missedQuotes[sym]?.p;
    list.filter(r => (r.sym || '').toUpperCase() === sym).forEach(r => {
      const el = document.getElementById('missed-since-' + r.id);
      if (!el) return;
      const base = +r.price || 0;
      if (!price || !base) {
        // A known-unquotable symbol says so; a request still in flight stays
        // blank rather than flashing a dash it will replace a moment later.
        el.textContent = (_missedQuotes[sym] && _missedQuotes[sym].p === null) ? '—' : '';
        el.title = el.textContent ? 'אין מקור ציטוט לסימבול הזה' : '';
        return;
      }
      el.title = '';
      const chg = (price - base) / base * 100;
      el.innerHTML = `<span class="${chg >= 0 ? 'num-green' : 'num-red'}">${fmtPct(chg)}</span>
        <span style="color:var(--text3)">מאז · $${fmtPrice(price)}</span>`;
    });
  }));
  _paintMissedMonthSummaries(list);
  _paintMissedReasons(list);
  applyPrivacy();
}

let _missedChartSequence=0;
async function missedOpenChart(id) {
  const user=_currentUser,row=_missedList.find(item=>String(item.id)===String(id));
  if(!user || _legalReadyUserId!==user.id || !row)return;
  let dialog=document.getElementById('missed-chart-dialog');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='missed-chart-dialog';dialog.className='missed-chart-dialog';
    dialog.innerHTML='<div class="missed-chart-heading"><h2 id="missed-chart-title"></h2><button type="button" class="btn btn-secondary" aria-label="Close">✕</button></div><div id="missed-chart-body"></div>';
    dialog.setAttribute('aria-labelledby','missed-chart-title');dialog.querySelector('h2').className='sensitive';document.body.append(dialog);
    dialog.querySelector('button').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{if(dialog.open)return;_missedChartSequence++;dialog.querySelector('#missed-chart-body').replaceChildren();});
  }
  const seq=++_missedChartSequence,fingerprint=JSON.stringify([row.sym,row.date,row.price]);
  const body=dialog.querySelector('#missed-chart-body');body.replaceChildren();
  dialog.querySelector('h2').textContent=row.sym+' · '+(_lang==='he'?'כניסה מתוכננת':'Planned entry');
  dialog.querySelector('button').setAttribute('aria-label',_lang==='he'?'סגור':'Close');
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent=_lang==='he'?'טוען גרף…':'Loading chart…';body.append(status);
  if(!dialog.open)dialog.showModal();
  const valid=()=>dialog.open && seq===_missedChartSequence && _currentUser===user && _legalReadyUserId===user.id && _missedList.some(item=>String(item.id)===String(id)&&JSON.stringify([item.sym,item.date,item.price])===fingerprint);
  try{
    const [bars]=await Promise.all([_fetchPivotBars(row.sym),loadTradeSnapshotFeature()]);
    if(!valid())return;
    const image=await tradeSnapshotImage({type:'stock',symbol:row.sym,entryDate:row.date,entryPrice:row.price,ls:'L'},bars,{entryOnly:true});
    if(!valid())return;
    if(!image)throw new Error('Unavailable');
    const img=document.createElement('img');img.src=image;img.className='sensitive';img.alt=(_lang==='he'?'גרף כניסה מתוכננת ללא יציאה · ':'Planned entry chart without exit · ')+row.sym;
    body.replaceChildren(img);applyPrivacy();
  }catch{
    if(!valid())return;
    status.textContent=_lang==='he'?'אין כרגע נתוני גרף תואמים לתאריך ולמחיר שנרשמו.':'Matching chart data is currently unavailable.';
    const retry=document.createElement('button');retry.type='button';retry.className='btn btn-secondary';retry.textContent=_lang==='he'?'נסה שוב':'Retry';retry.onclick=()=>{_pivotBarsCache.delete(row.sym);void missedOpenChart(id);};body.append(retry);
  }
}

function missedEdit(id) {
  const r = _missedList.find(x => String(x.id) === String(id));
  if (!r) return;
  const card = document.getElementById('missed-row-' + id);
  if (!card) return;
  card.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <input class="form-control" style="font-size:12px;padding:4px 8px;text-transform:uppercase" value="${esc(r.sym)}" id="me-sym-${id}" placeholder="סימבול">
      <input class="form-control" style="font-size:12px;padding:4px 8px" value="${esc(r.sector||'')}" id="me-sec-${id}" placeholder="סקטור">
      <input class="form-control" type="date" style="font-size:12px;padding:4px 8px" value="${esc(r.date)}" id="me-date-${id}">
      <input class="form-control" type="number" style="font-size:12px;padding:4px 8px" value="${r.price}" step="0.0001" id="me-price-${id}" placeholder="מחיר">
      <input class="form-control" style="font-size:12px;padding:4px 8px" value="${esc(r.note||'')}" id="me-note-${id}" placeholder="הערה" maxlength="120">
      <div style="display:flex;gap:6px;margin-top:2px;">
        <button class="btn btn-primary btn-sm" style="flex:1;font-size:11px" onclick="missedSaveEdit('${id}')">שמור</button>
        <button class="btn btn-secondary btn-sm" style="font-size:11px" onclick="missedRender()">ביטול</button>
      </div>
    </div>`;
}

async function missedSaveEdit(id) {
  const sym   = (document.getElementById('me-sym-'+id)?.value||'').trim().toUpperCase().replace(/[^A-Z0-9._\-]/g,'');
  const sector= (document.getElementById('me-sec-'+id)?.value||'').trim().slice(0,40);
  const date  = document.getElementById('me-date-'+id)?.value||'';
  const price = parseFloat(document.getElementById('me-price-'+id)?.value);
  const note  = (document.getElementById('me-note-'+id)?.value||'').trim().slice(0,120);

  if (!sym)                   { toast('הכנס סימבול','error'); return; }
  if (!date)                  { toast('הכנס תאריך','error'); return; }
  if (isNaN(price)||price<=0) { toast('הכנס מחיר תקין','error'); return; }

  _rtSuppress('missed_opportunities');
  const { error } = await _sb.from('missed_opportunities')
    .update({ symbol: sym, sector, date, price, note })
    .eq('id', id).eq('user_id', _currentUser.id);
  if (error) { toast('שגיאה בעדכון','error'); console.error(error); return; }
  await missedRender(true);
  toast('עודכן ✓','success');
}

