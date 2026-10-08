// ===== INVESTMENTS TAB =====
let _invData = null;
let _invSaveTimer = null;
let _invPortfolios = [];
let _invActivePortfolioId = null;
let _invCurrency = '$';
// Same rationale as tj_active_tab (CLAUDE.md): a same-tab reload should keep
// the portfolio the user was looking at, but a fresh login should default
// back to their is_default portfolio — sessionStorage, not localStorage.
const _INV_ACTIVE_PORTFOLIO_KEY = () => 'inv_active_portfolio_' + (_currentUser?.id || 'anon');

async function invLoadPortfolios() {
  if (!_currentUser) { _invPortfolios = []; _invActivePortfolioId = null; return; }
  const userId = _currentUser.id;
  const gen = _invReloadGen;
  const { data, error } = await _sb.from('portfolios')
    .select('id, name, is_default')
    .eq('user_id', _currentUser.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (_currentUser?.id !== userId || gen !== _invReloadGen) return;
  if (error) { console.error('[invLoadPortfolios]', error); return; }
  _invPortfolios = data || [];
  let saved = null;
  try { saved = sessionStorage.getItem(_INV_ACTIVE_PORTFOLIO_KEY()); } catch {}
  const def = _invPortfolios.find(p => p.is_default) || _invPortfolios[0];
  _invActivePortfolioId = (saved && _invPortfolios.some(p => p.id === saved)) ? saved : (def ? def.id : null);
}

function invRenderPortfolioPicker() {
  const lbl = document.getElementById('inv-portfolio-lbl');
  const active = _invPortfolios.find(p => p.id === _invActivePortfolioId);
  if (lbl) lbl.textContent = active?.name || '';
  const menu = document.getElementById('inv-portfolio-menu');
  if (!menu) return;
  menu.innerHTML = _invPortfolios.map(p => `<div style="display:flex;align-items:center;gap:4px;">
      <button class="${p.id === _invActivePortfolioId ? 'active' : ''}" ${p.id === _invActivePortfolioId ? 'aria-current="true"' : ''} onclick="invSwitchPortfolio('${p.id}')" style="flex:1;">${esc(p.name)}</button>
      ${p.id === _invActivePortfolioId ? `<button onclick="invRenamePortfolio()" title="שנה שם" aria-label="שנה שם תיק" style="flex:0 0 auto;padding:4px 8px;">✏</button>` : ''}
    </div>`).join('')
    + `<button onclick="invAddPortfolio()" style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:8px;">+ הוסף תיק</button>`;
  // Reparented to <body> each rebuild — the menu is position:fixed and needs
  // to escape .inv-header's stacking context, same pattern as port-equity-menu.
  document.body.appendChild(menu);
}

async function invSwitchPortfolio(id) {
  _closeAllDDs();
  if (id === _invActivePortfolioId) return;
  if (!_invPortfolios.some(p => p.id === id)) return;
  const gen = _invReloadGen;
  // Flush edits still waiting for the debounce before leaving this portfolio.
  while (true) {
    const pending = _invSaveTimer !== null || _invSaveTotalTimer !== null || invHasUnsavedChanges();
    clearTimeout(_invSaveTimer);
    clearTimeout(_invSaveTotalTimer);
    _invSaveTimer = null;
    _invSaveTotalTimer = null;
    if (pending && _invData) {
      if (!await invSaveData(invGetCurrentData())) return;
    } else {
      await _invSaveChain;
    }
    if (gen !== _invReloadGen || !_currentUser) return;
    if (!_invSaveTimer && !_invSaveTotalTimer && !invHasUnsavedChanges()) break;
  }
  _invActivePortfolioId = id;
  _invSaveRevision = 0; _invSavedRevision = 0; _invPendingWrites = 0;
  _invSaveChain = Promise.resolve();
  invSetSaveState('idle');
  try { sessionStorage.setItem(_INV_ACTIVE_PORTFOLIO_KEY(), id); } catch {}
  _invData = null;
  _invUpdatedAt = null;
  _invReloadGen++;
  // invInit() (below) calls invRenderPortfolioPicker() itself, first thing —
  // this used to call it again beforehand, a redundant full innerHTML
  // rebuild of the dropdown on every portfolio switch (code-review finding).
  await invInit();
}

let _invPfNameMode = null;

function invAddPortfolio() {
  _closeAllDDs();
  if (!_currentUser) return;
  _invPfNameMode = 'add';
  document.getElementById('inv-pf-name-title').textContent = 'שם התיק החדש';
  const input = document.getElementById('inv-pf-name-input');
  input.value = '';
  document.getElementById('inv-portfolio-name-modal').classList.add('open');
  setTimeout(() => input.focus(), 80);
}

function invRenamePortfolio() {
  const active = _invPortfolios.find(p => p.id === _invActivePortfolioId);
  if (!active || !_currentUser) return;
  _invPfNameMode = 'rename';
  document.getElementById('inv-pf-name-title').textContent = 'שינוי שם התיק';
  const input = document.getElementById('inv-pf-name-input');
  input.value = active.name;
  document.getElementById('inv-portfolio-name-modal').classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 80);
}

function invPortfolioNameClose() {
  document.getElementById('inv-portfolio-name-modal')?.classList.remove('open');
  _invPfNameMode = null;
}

async function invPortfolioNameConfirm() {
  const mode = _invPfNameMode;
  const name = (document.getElementById('inv-pf-name-input').value || '').trim().slice(0, 60);
  if (!name) return;
  if (mode === 'add') {
    const { data, error } = await _sb.from('portfolios')
      .insert({ user_id: _currentUser.id, name, is_default: false })
      .select('id, name, is_default').single();
    if (error) { toast('שגיאה בהוספת תיק: ' + error.message, 'error'); console.error('[invAddPortfolio]', error); return; }
    invPortfolioNameClose();
    _invPortfolios.push(data);
    await invSwitchPortfolio(data.id);
    toast('תיק נוסף ✓', 'success');
  } else if (mode === 'rename') {
    const active = _invPortfolios.find(p => p.id === _invActivePortfolioId);
    if (!active) return;
    if (name === active.name) { invPortfolioNameClose(); return; }
    const { error } = await _sb.from('portfolios').update({ name }).eq('id', active.id).eq('user_id', _currentUser.id);
    if (error) { toast('שגיאה בשינוי שם: ' + error.message, 'error'); console.error('[invRenamePortfolio]', error); return; }
    invPortfolioNameClose();
    active.name = name;
    invRenderPortfolioPicker();
    toast('שם התיק עודכן ✓', 'success');
  }
}

// Display-only label, per portfolio. Holdings are still priced by Finnhub in
// USD and nothing converts them — switching to ₪ here just relabels the same
// dollar figures, it does not convert them. Reintroduced 2026-09-10 on
// explicit request, aware of that limitation (see AskUserQuestion in the
// session log) — a real FX-conversion layer was declined in favor of this.
function invGetCurrency() { return _invCurrency === '₪' ? '₪' : '$'; }
function invSetCurrency(cur) {
  _invCurrency = cur === '₪' ? '₪' : '$';
  const chip = document.getElementById('inv-currency-toggle');
  if (chip) chip.textContent = _invCurrency;
  const prefix = document.getElementById('inv-portfolio-currency');
  if (prefix) prefix.textContent = _invCurrency;
  invSyncPnlBtn();
  invRecalc();
  invAutoSaveTotal();
}
function invGetPnlMode() { return localStorage.getItem('inv_pnl_mode') || 'amount'; }
function invSyncPnlBtn() {
  const btn = document.getElementById('inv-pnl-toggle');
  if (btn) btn.textContent = invGetPnlMode() === 'amount' ? invGetCurrency() : '%';
}
function invTogglePnlMode() {
  const next = invGetPnlMode() === 'amount' ? '%' : 'amount';
  localStorage.setItem('inv_pnl_mode', next);
  invSyncPnlBtn();
  invRecalc();
}

// Supabase is the only source of truth. This used to fall back to the
// `inv_data_v1` localStorage blob, which nothing has written for a long time —
// so the only thing it could ever return was another session's leftovers, and
// invRenderDeposits/invGetCurrentData read it on every render.
function invLoad() {
  return _invData || { portfolioTotal: '', holdings: [], deposits: [] };
}

async function invLoadFromDB() {
  if (!_currentUser) return invLoad();
  if (!_invActivePortfolioId) await invLoadPortfolios();
  if (!_invActivePortfolioId) return invLoad();
  // Snapshot the generation at entry and re-check it after each await. Without
  // this, switching portfolios quickly (A→B→C) can let A's slower response
  // land after C's faster one: this function has two awaits with no guard
  // between them, so an unconditional `_invData = {...}` at the end (below)
  // clobbered whichever portfolio was actually showing with a stale one's
  // data — and the next autosave then wrote A's data under C's row in the DB.
  // Mirrors the same `gen !== _invReloadGen` guard _invSaveWrite already uses.
  const myGen = _invReloadGen;
  const fallbackTotal = invLoad().portfolioTotal || '';
  // maybeSingle, and the error is kept. `.single()` reports "no row" and "the
  // request failed" the same way — {data:null} — so a dropped connection, a 5xx
  // or a token refreshing mid-flight all used to fall into the brand-new-account
  // branch below. That branch clears _invUpdatedAt, which is what arms the
  // last-writer-wins guard, so the next save took the unguarded path and wrote
  // an empty portfolio over a real one — and now also deletes every row in
  // investment_holdings, destroying both copies at once.
  const { data, error: docErr } = await _sb.from('investments')
    .select('deposits, currency, alloc_targets, updated_at, portfolio_total')
    .eq('user_id', _currentUser.id)
    .eq('portfolio_id', _invActivePortfolioId)
    .maybeSingle();
  if (docErr) {
    console.error('[invLoadFromDB]', docErr);
    toast('לא ניתן לטעון את ההשקעות — רענן את הדף', 'error');
    // Deliberately does not touch _invData or _invUpdatedAt. _invData staying
    // null is what stops invAutoSave from persisting this empty screen, and the
    // untouched stamp keeps the guard armed if anything else tries.
    return _invData || { portfolioTotal: fallbackTotal, holdings: [], deposits: [] };
  }
  if (myGen !== _invReloadGen) return _invData; // superseded by a newer switch/reload
  if (data) {
    _invUpdatedAt = data.updated_at || null;
    _invCurrency = data.currency === '₪' ? '₪' : '$';
    const portfolioTotal = data.portfolio_total != null ? String(data.portfolio_total) : '';
    // Stage 3 (2026-08-23): investment_holdings is now the only source — the
    // jsonb `holdings` document on this row stopped being written the moment
    // this shipped, so falling back to it here would silently freeze anyone
    // whose read hits an error at whatever their portfolio looked like that
    // day. A read error is surfaced instead, same as the docErr branch above.
    const { data: rows, error: rowsErr } = await _sb.from('investment_holdings')
      .select('id, symbol, cat, sector, entry_shares, entry_price, current_price, position')
      .eq('user_id', _currentUser.id)
      .eq('portfolio_id', _invActivePortfolioId)
      .order('position', { ascending: true });
    if (rowsErr) {
      console.error('[invLoadFromDB] holdings', rowsErr);
      toast('לא ניתן לטעון את ההשקעות — רענן את הדף', 'error');
      return _invData || { portfolioTotal, holdings: [], deposits: [] };
    }
    if (myGen !== _invReloadGen) return _invData; // superseded by a newer switch/reload
    const holdings = (rows || []).map(r => ({ id: r.id, symbol: r.symbol || '', cat: r.cat || '', sector: r.sector || '',
                       entryShares: +r.entry_shares || 0, entryPrice: +r.entry_price || 0,
                       currentPrice: r.current_price == null ? undefined : +r.current_price,
                       locked: true }));
    invApplyTargets(data.alloc_targets);
    _invData = { portfolioTotal, holdings, deposits: data.deposits || [], allocTargets: invTargetsPayload() };
  } else {
    // A brand-new portfolio (or a brand-new account) starts empty. This used to
    // seed itself from the `inv_data_v1` localStorage blob and immediately save
    // it — on a shared browser that adopted whoever used the app last as your
    // own portfolio. Nothing writes that key any more, so it is only ever a
    // stale leftover.
    invApplyTargets(null);
    _invUpdatedAt = null;
    _invCurrency = '$';
    _invData = { portfolioTotal: '', holdings: [], deposits: [] };
  }
  return _invData;
}

let _invUpdatedAt = null;

// Saves are fired from a dozen independent places — a debounced autosave, a row
// lock, a delete, a target change — and none of them knew about the others. Two
// that overlapped both captured the same `_invUpdatedAt`, so the second matched
// no row and reported "updated elsewhere": a conflict with ourselves, on one
// device, with nobody else writing. It then reloaded and threw away the newer
// edit. Queueing the writes means each one reads the stamp the previous write
// produced. A real remote change still moves the stamp and still trips the
// guard, which is the case it exists for.
let _invSaveChain = Promise.resolve();
// Bumped whenever a real conflict forced a reload, so writes composed before it
// can tell that the ground moved under them.
let _invReloadGen = 0;

function _invResetSession() {
  clearTimeout(_invSaveTimer);
  clearTimeout(_invSaveTotalTimer);
  _invSaveTimer = null;
  _invSaveTotalTimer = null;
  _invReloadGen++;
  _invPortfolios = [];
  _invActivePortfolioId = null;
  _invUpdatedAt = null;
  _invCurrency = '$';
  _invData = null;
  _invSaveRevision = 0; _invSavedRevision = 0; _invPendingWrites = 0;
  _invSaveChain = Promise.resolve();
  invSetSaveState('idle');
}

let _invSaveState = 'idle';
let _invSaveRevision = 0;
let _invSavedRevision = 0;
let _invPendingWrites = 0;

function invSetSaveState(state) {
  _invSaveState = state;
  const el = document.getElementById('inv-save-status');
  if (el) {
    el.dataset.state = state;
    el.textContent = ({ idle: '', pending: 'שינויים ממתינים לשמירה', saving: 'שומר…', saved: 'נשמר ✓', error: 'השמירה נכשלה' })[state];
  }
  const retry = document.getElementById('inv-save-retry');
  if (retry) retry.hidden = state !== 'error';
}

function invMarkDirty() {
  _invSaveRevision++;
  invSetSaveState('pending');
}

function invHasUnsavedChanges() {
  return !!_currentUser && (_invSaveRevision !== _invSavedRevision || _invPendingWrites > 0);
}

function invRetrySave() {
  if (_invData) return invSaveData(invGetCurrentData());
}

function invSaveData(data) {
  if (!_currentUser || !_invActivePortfolioId) return Promise.resolve(false);
  for (const h of invStripBlank(data.holdings)) if (!h.id) h.id = crypto.randomUUID();
  _invData = data;
  invMarkDirty();
  const revision = _invSaveRevision;
  const snapshot = structuredClone(data);
  const gen = _invReloadGen;
  _invPendingWrites++;
  invSetSaveState('saving');
  const run = _invSaveChain.then(async () => {
    let saved = false;
    try {
      saved = await _invSaveWrite(snapshot, null, gen);
    } catch (error) {
      if (gen === _invReloadGen) {
        toast('שגיאה בשמירת השקעות — נסה לשמור שוב', 'error');
        _reportClientError('inv_save', error.message || String(error));
      }
    } finally {
      if (gen === _invReloadGen) {
        _invPendingWrites--;
        if (saved) _invSavedRevision = Math.max(_invSavedRevision, revision);
        invSetSaveState(_invPendingWrites ? 'saving' : !saved ? 'error' : invHasUnsavedChanges() ? 'pending' : 'saved');
      }
    }
    return saved;
  });
  _invSaveChain = run.catch(() => {});
  return run;
}

async function _invSaveWrite(data, prev, gen) {
  if (gen !== _invReloadGen || !_currentUser || !_invActivePortfolioId) return false;
  const userId = _currentUser.id;
  const portfolioId = _invActivePortfolioId;
  const isCurrent = () => gen === _invReloadGen && _currentUser?.id === userId && _invActivePortfolioId === portfolioId;
  _rtSuppress('investments');
  _rtSuppress('investment_holdings');
  const total = +String(data.portfolioTotal || '').replace(/[^\d.]/g, '');
  const live = invStripBlank(data.holdings);
  const { data: saved, error } = await _sb.rpc('save_investment_portfolio', {
    p_portfolio_id: portfolioId,
    p_expected_updated_at: _invUpdatedAt,
    p_portfolio_total: Number.isFinite(total) && total > 0 ? total : null,
    p_currency: invGetCurrency(),
    p_deposits: data.deposits || [],
    p_alloc_targets: data.allocTargets || invTargetsPayload(),
    p_holdings: live.map(h => ({ id: h.id || null, symbol: (h.symbol || '').toUpperCase().trim(),
      cat: h.cat || null, sector: h.sector || null, entry_shares: +h.entryShares || 0,
      entry_price: +h.entryPrice || 0, current_price: h.currentPrice == null ? null : +h.currentPrice })),
  });
  if (!isCurrent()) return false;
  if (error) {
    if (error.code === 'PT409') {
      clearTimeout(_invSaveTimer); clearTimeout(_invSaveTotalTimer);
      _invSaveTimer = null; _invSaveTotalTimer = null;
      _invData = null; _invUpdatedAt = null; _invReloadGen++;
      _invPendingWrites = 0;
      _invSavedRevision = _invSaveRevision;
      toast('התיק עודכן במכשיר אחר — השינויים המקומיים בוטלו והנתונים נטענים מחדש', 'error');
      const conflictGen = _invReloadGen;
      await invInit();
      if (conflictGen === _invReloadGen && _currentUser?.id === userId && _invActivePortfolioId === portfolioId) invSetSaveState('error');
    } else {
      toast('ההשקעות לא נשמרו — נסה לשמור שוב', 'error');
      _reportClientError('inv_save', error.message || String(error));
    }
    return false;
  }
  if (!saved?.updated_at) throw new Error('Missing portfolio save timestamp');
  _invUpdatedAt = saved.updated_at;
  (saved.holdings || []).forEach(r => { if (live[r.position]) live[r.position].id = r.id; });
  return true;
}

window.addEventListener('beforeunload', event => {
  if (!invHasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
});

async function invInit() {
  const gen = _invReloadGen;
  if (!_invPortfolios.length) await invLoadPortfolios();
  if (gen !== _invReloadGen || !_currentUser) return;
  invRenderPortfolioPicker();
  const data = _invData || await invLoadFromDB();
  if (gen !== _invReloadGen || !data) return;
  invSyncPnlBtn();
  const chip = document.getElementById('inv-currency-toggle');
  if (chip) chip.textContent = invGetCurrency();
  const prefix = document.getElementById('inv-portfolio-currency');
  if (prefix) prefix.textContent = invGetCurrency();
  const totalEl = document.getElementById('inv-portfolio-total');
  if (totalEl) totalEl.value = data.portfolioTotal || '';
  const dl = document.getElementById('inv-sym-list');
  if (dl) dl.innerHTML = Object.keys(SECTOR_MAP).filter(s => !symIsCrypto(s)).map(s => `<option value="${s}">`).join('');
  invRenderRows(data.holdings || []);
  invRenderDeposits(data.deposits || []);
  invSyncTargetInputs();
  invRecalc();
  invFetchPrices();
  // Keep holdings P&L live: refresh quotes every 60s while on this tab
  // (cleared in switchTab when leaving). No DB write on these ticks.
  if (_invPriceTimer) clearInterval(_invPriceTimer);
  _invPriceTimer = setInterval(() => invFetchPrices(false), 60000);
}
let _invPriceTimer = null;

function invRenderRows(holdings) {
  const tbody = document.getElementById('inv-tbody');
  if (!tbody) return;
  if (!holdings.length) {
    tbody.innerHTML = `<tr><td colspan="13" class="inv-empty">אין עדיין אחזקות — לחץ על "+ הוסף אחזקה" כדי להתחיל</td></tr>`;
    return;
  }
  tbody.innerHTML = holdings.map((h, i) => {
    const locked = h.locked !== false;
    const ro = locked ? 'disabled' : '';
    const symCell = locked
      ? `<input type="hidden" value="${esc(h.symbol||'')}"><span class="inv-sym-chip">${esc(h.symbol||'—')}</span>`
      : `<input class="inv-sym-input" type="text" value="${esc(h.symbol||'')}" placeholder="AAPL" list="inv-sym-list" oninput="this.value=this.value.toUpperCase();invRecalc();invMarkDirty();invAutoSector(${i});">`;
    return `
    <tr data-idx="${i}" class="${locked?'inv-row-locked':'inv-row-edit'}">
      <td ${locked&&h.symbol?`onclick="invToggleBuyRow(${i})" style="cursor:pointer"`:''}>${symCell}<button class="inv-card-toggle" onclick="event.stopPropagation();invToggleCard(this)" aria-expanded="false">${_lang === 'he' ? 'פרטים' : 'Details'}</button></td>
      <td><input class="inv-sector-input" type="text" value="${esc(h.sector||'')}" title="${esc(h.sector||'')}" placeholder="טכנולוגיה" data-sector-idx="${i}" ${ro} ${locked?'':'oninput="invAutoSave();this.title=this.value"'}></td>
      <td>
        <select class="inv-cat-sel" ${ro} onchange="invRecalc();${locked?'':'invAutoSave()'}">
          <option value="">—</option>
          <option value="blue" ${h.cat==='blue'?'selected':''}>${t('inv_cat_blue')}</option>
          <option value="green" ${h.cat==='green'?'selected':''}>${t('inv_cat_green')}</option>
          <option value="yellow" ${h.cat==='yellow'?'selected':''}>${t('inv_cat_yellow')}</option>
        </select>
      </td>
      <td><input class="sensitive" type="number" value="${+h.entryShares || ''}" placeholder="0" min="0" step="any" ${ro} ${locked?'':'oninput="invRecalc();invAutoSave()"'}></td>
      <td><input class="sensitive" type="number" value="${+h.entryPrice || ''}" placeholder="0.00" min="0" step="any" ${ro} ${locked?'':'oninput="invRecalc();invAutoSave()"'}></td>
      <td><span class="inv-stop-label sensitive" id="inv-stop-${i}" title="8% מתחת למחיר הכניסה">—</span></td>
      <td><input class="sensitive" type="number" value="${+h.currentPrice || ''}" placeholder="0.00" min="0" step="any" readonly tabindex="-1" style="cursor:default;opacity:0.7;" title="מחיר נשלף אוטומטית"></td>
      <td><span class="inv-avg-label sensitive" id="inv-avg-${i}">—</span></td>
      <td><span class="inv-value-label sensitive" id="inv-val-${i}">—</span></td>
      <td><span class="inv-pnl-label sensitive" id="inv-pnl-${i}">—</span></td>
      <td><div class="inv-pct-bar"><div class="inv-pct-fill" id="inv-bar-${i}" style="width:0%"></div><span class="inv-pct-label" id="inv-pct-${i}">0%</span></div></td>
      <td><span class="inv-cat-rem" id="inv-catrem-${i}">—</span></td>
      <td style="white-space:nowrap;text-align:center;padding-left:6px;padding-right:6px;">
        ${locked
          ? `<button class="inv-edit-btn" onclick="invEditRow(${i})" title="ערוך" aria-label="ערוך"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
          : `<button class="inv-lock-btn" onclick="invLockRow(${i})" title="שמור" aria-label="שמור"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>`
        }
        <!-- Rendered for unlocked rows too: gating it on the locked flag meant a
             brand-new holding had no way to reach the size calculator until it
             had been saved, i.e. you had to commit to a quantity before the
             tool that computes the quantity became available. -->
        <button class="inv-buy-btn" onclick="invToggleBuyRow(${i})" aria-label="קנייה/מכירה עבור ${esc(h.symbol||'החזקה')}" title="קנייה/מכירה + מחשבון כמות וסיכון">+</button>
        <button class="inv-del-btn" onclick="invDeleteRow(${i})" aria-label="מחק ${esc(h.symbol||'החזקה')}" title="מחק">×</button>
      </td>
    </tr>`;
  }).join('');
  const labels = Array.from(document.querySelectorAll('.inv-table thead th'), th => th.textContent.trim());
  tbody.querySelectorAll('tr[data-idx]').forEach(row => {
    Array.from(row.cells).forEach((cell, index) => {
      cell.dataset.label = labels[index] || '';
      cell.querySelectorAll('input:not([type="hidden"]),select').forEach(control => {
        control.setAttribute('aria-label', labels[index] || (_lang === 'he' ? 'שדה אחזקה' : 'Holding field'));
      });
    });
  });
  invRecalc();
}

function invToggleCard(button) {
  const expanded = button.closest('tr').classList.toggle('inv-card-expanded');
  button.setAttribute('aria-expanded', String(expanded));
  button.textContent = _lang === 'he' ? (expanded ? 'פחות פרטים' : 'פרטים') : (expanded ? 'Less' : 'Details');
}

const ALLOC_DEFAULTS = { blue: 0.60, green: 0.35, yellow: 0.05, cash: 0.05 };
let ALLOC_TARGETS = { blue: 0.60, green: 0.35, yellow: 0.05 };
let ALLOC_CASH_TARGET = 0.05;
const ALLOC_COLORS  = { blue: '#818cf8', green: '#0d9488', yellow: '#fbbf24' };

function invApplyTargets(tg) {
  const v = tg && typeof tg === 'object' ? tg : {};
  ALLOC_TARGETS = {
    blue:   v.blue   != null ? +v.blue   : ALLOC_DEFAULTS.blue,
    green:  v.green  != null ? +v.green  : ALLOC_DEFAULTS.green,
    yellow: v.yellow != null ? +v.yellow : ALLOC_DEFAULTS.yellow,
  };
  ALLOC_CASH_TARGET = v.cash != null ? +v.cash : ALLOC_DEFAULTS.cash;
}

function invTargetsPayload() {
  return { blue: ALLOC_TARGETS.blue, green: ALLOC_TARGETS.green, yellow: ALLOC_TARGETS.yellow, cash: ALLOC_CASH_TARGET };
}

function invSetTarget(cat, pctStr) {
  let pct = parseFloat(pctStr);
  if (!isFinite(pct)) pct = 0;
  pct = Math.max(0, Math.min(100, pct));
  const frac = pct / 100;
  const prev = cat === 'cash' ? ALLOC_CASH_TARGET : ALLOC_TARGETS[cat];
  if (cat === 'cash') ALLOC_CASH_TARGET = frac;
  else ALLOC_TARGETS[cat] = frac;
  const total = ALLOC_TARGETS.blue + ALLOC_TARGETS.green + ALLOC_TARGETS.yellow + ALLOC_CASH_TARGET;
  if (total > 1.0001) {
    if (cat === 'cash') ALLOC_CASH_TARGET = prev;
    else ALLOC_TARGETS[cat] = prev;
    invSyncTargetInputs(true);
    const over = Math.round(total * 100);
    toast(`סה"כ יעדים ${over}% — חייב להיות עד 100%`, 'error');
    return;
  }
  invSyncTargetInputs();
  invRecalc();
  // invLoad() returns a blank portfolio when _invData is null, and _invData is
  // null for the whole of an in-flight invInit — which the realtime handler, the
  // reconnect handler and the conflict path all trigger. These inputs stay
  // clickable throughout, so saving invLoad()'s fallback here would persist
  // holdings: [] and wipe the account. Same guard invAutoSave already has.
  if (!_invData) { toast('עוד טוען — נסה שוב בעוד רגע', 'error'); return; }
  const data = invLoad();
  data.allocTargets = invTargetsPayload();
  invSaveData(data);
}

// `force` is used by the rejection paths: onchange fires while the input is
// still focused, so the focus guard — which exists to avoid fighting the user
// mid-type — would otherwise leave the rejected value on screen.
function invSyncTargetInputs(force = false) {
  const set = (id, frac) => { const el = document.getElementById(id); if (el && (force || document.activeElement !== el)) el.value = Math.round(frac * 100); };
  set('inv-tg-blue', ALLOC_TARGETS.blue);
  set('inv-tg-green', ALLOC_TARGETS.green);
  set('inv-tg-yellow', ALLOC_TARGETS.yellow);
  set('inv-tg-cash', ALLOC_CASH_TARGET);
}

// The portfolio total lives in a type="text" field so it can be typed with
// thousands separators. Every read of it must strip them identically, or the
// same typed number means different things in different corners of the tab.
function invParseTotal(raw) {
  const n = +String(raw ?? '').replace(/[^\d.]/g, '');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Pure accumulation, kept out of invRecalc so the arithmetic can be tested
// without a DOM. Input is one plain object per holding; nothing here reads or
// writes the page.
// How much of its category's target is still free, and what that buys. `cost`
// is the position's current cost basis, which stands in for one tranche.
function invRoomInfo(o) {
  const { portfolioTotal, target, catValue, price, cost } = o;
  const catAmt = (portfolioTotal || 0) * (target || 0);
  const room = catAmt - (catValue || 0);
  const free = Math.max(0, room);
  return {
    catAmt, free, over: Math.max(0, -room),
    shares: price > 0 ? Math.floor(free / price) : null,
    tranches: cost > 0 ? free / cost : null,
  };
}
function invAccumulate(holdings) {
  let totalCost = 0, totalCurrentValue = 0, totalUnrealizedPnL = null, pnlCost = 0;
  // `none` is a real bucket, not a rounding error: a new row renders with no
  // category selected, and such a holding used to count toward "invested" and
  // shrink free cash while appearing in no bar, no slice and no remaining
  // figure — money the allocation view simply did not show.
  const byCat = { blue: 0, green: 0, yellow: 0, none: 0 };
  const byCatValue = { blue: 0, green: 0, yellow: 0, none: 0 };
  const rowData = [];
  holdings.forEach(h => {
    const cat          = h.cat || '';
    const entryShares  = +h.entryShares || 0;
    const entryPrice   = +h.entryPrice || 0;
    const currentPrice = +h.currentPrice || 0;
    const value  = currentPrice > 0 ? entryShares * currentPrice : entryShares * entryPrice;
    const cost   = entryShares * entryPrice;
    const pnlAmt = (currentPrice > 0 && entryPrice > 0) ? (currentPrice - entryPrice) * entryShares : null;
    const pnlPct = (pnlAmt !== null && cost > 0) ? (pnlAmt / cost) * 100 : null;
    totalCost         += cost;
    totalCurrentValue += value;
    // The total-return % divides by cost, so only cost that actually has a
    // quote behind it belongs in that denominator. A holding whose quote failed
    // contributes 0 P&L; counting its cost anyway dragged the headline % toward
    // zero and made the portfolio look flatter than it is.
    if (pnlAmt !== null) { totalUnrealizedPnL = (totalUnrealizedPnL || 0) + pnlAmt; pnlCost += cost; }
    const bucket = (cat && byCat[cat] !== undefined) ? cat : 'none';
    byCat[bucket] += cost;
    byCatValue[bucket] += value;
    rowData.push({ i: h.i, cat, value, cost, pnlAmt, pnlPct });
  });
  return { totalCost, totalCurrentValue, totalUnrealizedPnL, pnlCost, byCat, byCatValue, rowData };
}

// Donut slice percentages. Cash is clamped at both ends: a cost basis above the
// portfolio total made `100 - totalAllocated` negative, which emitted an
// invalid negative stroke-dasharray and drew the slice wrong.
function invDonutPcts(byCat, portfolioTotal, cash = 0) {
  const pct = v => portfolioTotal > 0 ? v / portfolioTotal * 100 : 0;
  const pcts = { blue: pct(byCat.blue), green: pct(byCat.green), yellow: pct(byCat.yellow), none: pct(byCat.none || 0) };
  const totalAllocated = pcts.blue + pcts.green + pcts.yellow + pcts.none;
  pcts.cash = portfolioTotal > 0 ? Math.max(0, Math.min(cash / portfolioTotal * 100, 100 - totalAllocated)) : 0;
  return pcts;
}

// USD→ILS rate, refreshed at most hourly and remembered across reloads so a
// dead network degrades to yesterday's rate (shown as stale) instead of to no
// calculator at all.
const FX_KEY = 'inv_fx_usd_ils';
let _invFx = null;
function invFxLoad() {
  if (_invFx) return _invFx;
  try { _invFx = JSON.parse(localStorage.getItem(FX_KEY) || 'null'); } catch { _invFx = null; }
  return _invFx;
}
async function invFxRefresh() {
  const cached = invFxLoad();
  if (cached && Date.now() - cached.ts < 3600_000) return cached;
  const token = await _getToken();
  if (!token) return cached;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/fx?from=USD&to=ILS`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return cached;
    const data = await res.json();
    if (!(+data.rate > 0)) return cached;
    _invFx = { rate: +data.rate, date: data.date || null, ts: Date.now() };
    localStorage.setItem(FX_KEY, JSON.stringify(_invFx));
  } catch { /* keep the cached rate rather than blanking the calculator */ }
  return _invFx;
}

// Position sizing. Everything the calculator shows is derived here so the
// arithmetic can be tested without a DOM or a network.
//   portfolio × desired%  →  (÷ fx if the portfolio is in ₪)  →  ÷ price  →  floor
// The floor matters: it is the difference between a budget and an order, and it
// makes the realised percentage lower than the one that was asked for.
function invPositionSize(o) {
  const price          = +o.price || 0;
  const pct            = +o.pctOfPortfolio || 0;
  const portfolioValue = +o.portfolioValue || 0;
  const inShekels      = o.portfolioCurrency === '₪';
  const fxRate         = +o.fxRate || 0;
  const portfolioTotal = +o.portfolioTotalUsd || 0;
  const cash           = +o.cashUsd || 0;
  const stop           = +o.stop || 0;

  const nil = { shares: null, amountUsd: null, positionUsd: null, actualPct: null,
                riskUsd: null, riskPct: null, catRoomUsd: null,
                maxSharesByTarget: null, maxSharesByCash: null,
                suggestedShares: null, withinTarget: true, withinCash: true };

  // Without a rate a ₪ portfolio cannot be sized at all. Falling back to some
  // default rate would silently place the order off an invented number.
  if (inShekels && !fxRate) return { ...nil, error: 'no-fx' };
  // Not just `!price`: the number input does not enforce min="0", and a negative
  // price produced negative share counts with a positive dollar position, while
  // a non-finite one rendered "NaN מניות".
  if (!(price > 0) || !Number.isFinite(price)) return { ...nil, error: 'no-price' };

  const amountLocal = portfolioValue * pct / 100;
  const amountUsd   = inShekels ? amountLocal / fxRate : amountLocal;
  const shares      = Math.floor(amountUsd / price);
  const positionUsd = shares * price;
  const actualPct   = portfolioTotal > 0 ? positionUsd / portfolioTotal * 100 : null;

  // A stop at or above the entry is not a negative risk — it is no stop.
  const riskPerShare = stop > 0 && stop < price ? price - stop : 0;
  const riskUsd = riskPerShare ? riskPerShare * shares : null;
  const riskPct = riskUsd !== null && portfolioTotal > 0 ? riskUsd / portfolioTotal * 100 : null;

  const catTargetUsd = portfolioTotal * (+o.catTargetFrac || 0);
  const catRoomUsd   = Math.max(0, catTargetUsd - (+o.catCostUsd || 0));

  const maxSharesByTarget = Math.floor(catRoomUsd / price);
  const maxSharesByCash   = Math.floor(cash / price);

  const caps = [maxSharesByTarget, maxSharesByCash].filter(n => n !== null);
  const suggestedShares = Math.max(0, Math.min(...caps));

  return {
    shares, amountUsd, positionUsd, actualPct, riskUsd, riskPct, catRoomUsd,
    maxSharesByTarget, maxSharesByCash, suggestedShares,
    withinTarget: shares <= maxSharesByTarget,
    withinCash:   shares <= maxSharesByCash,
    error: null,
  };
}

// Split a sized position into N scale-in entries. The tranches must sum back to
// exactly the total: rounding each one up would buy more than the sizing
// allowed, which defeats the point of sizing it.
// The remainder goes to the earliest entries, so the first buy is the largest.
function invSplitEntries(totalShares, price, n) {
  const total = Math.floor(+totalShares || 0);
  const count = Math.floor(+n || 0);
  if (total <= 0 || count <= 0) return [];
  // More entries than shares cannot produce that many real orders.
  const k = Math.min(count, total);
  const base = Math.floor(total / k);
  let rem = total - base * k;
  const out = [];
  for (let i = 0; i < k; i++) {
    const shares = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    out.push({ shares, usd: shares * (+price || 0) });
  }
  return out;
}

// What the stop costs, tranche by tranche. `cum` is the number that actually
// governs a scale-in: the stop does not wait for the last entry, so once entry
// k is filled the money on the line is entries 1..k, not entry k alone.
// Like invSplitEntries this prices every tranche at the same `price` — the
// planned entry. A real scale-in fills at different prices, so these are the
// losses for the plan as sized, not a forecast of the fills.
// No stop, or a stop above the entry, means there is no loss to state — an
// empty list, never zeros, so the caller renders nothing rather than "$0".
function invTrancheRisk(parts, price, stop) {
  const perShare = (+price > 0 && +stop > 0 && +stop < +price) ? +price - +stop : 0;
  if (!perShare) return [];
  let cum = 0;
  return parts.map(e => {
    const loss = e.shares * perShare;
    cum += loss;
    return { loss, cum };
  });
}

function invRecalc() {
  const tbody = document.getElementById('inv-tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr[data-idx]');

  // Pass 1: read the rows out of the DOM, then accumulate them purely
  const { totalCost, totalCurrentValue, totalUnrealizedPnL, pnlCost, byCat, byCatValue, rowData } =
    invAccumulate([...rows].map(row => {
      const inputs = row.querySelectorAll('input');
      return {
        i: +row.dataset.idx,
        cat: row.querySelector('.inv-cat-sel')?.value || '',
        entryShares:  inputs[2]?.value,
        entryPrice:   inputs[3]?.value,
        currentPrice: inputs[4]?.value,
      };
    }));

  // Total portfolio is the anchor (input). Free cash is whatever isn't invested
  // in holdings (total − holdings value), so it stays in sync with the total and
  // grows when a monthly deposit raises the total.
  // The field is type="text", so a typed "32,253" arrives with the comma and
  // `+value` is NaN — which zeroed the whole panel: every bar, every percent and
  // the free-cash figure. invSizerCtx and invCalcOpen already strip; this read
  // was the one left behind.
  const portfolioTotal = invParseTotal(document.getElementById('inv-portfolio-total')?.value);
  const cash = Math.max(0, portfolioTotal - totalCurrentValue);
  const effectiveTotal = portfolioTotal;

  // Pass 2: render per-row display (pct now uses totalCost as denominator)
  const cur = invGetCurrency();
  const pnlMode = invGetPnlMode();
  rowData.forEach(({ i, value, cost, pnlAmt, pnlPct }) => {
    const pct   = effectiveTotal > 0 ? (value / effectiveTotal) * 100 : 0;
    const avgEl = document.getElementById(`inv-avg-${i}`);
    const stopEl = document.getElementById(`inv-stop-${i}`);
    const valEl = document.getElementById(`inv-val-${i}`);
    const pnlEl = document.getElementById(`inv-pnl-${i}`);
    const barEl = document.getElementById(`inv-bar-${i}`);
    const pctEl = document.getElementById(`inv-pct-${i}`);
    const inputs = tbody.querySelector(`tr[data-idx="${i}"]`)?.querySelectorAll('input');
    const entryPrice = +(inputs?.[3]?.value) || 0;
    if (avgEl) avgEl.textContent = entryPrice > 0 ? cur + entryPrice.toFixed(2) : '—';
    const livePrice = +(inputs?.[4]?.value) || 0;
    const stopHit = invStopHit(livePrice, entryPrice);
    if (stopEl) {
      stopEl.textContent = entryPrice > 0 ? (stopHit ? '🛑 ' : '') + cur + (entryPrice * INV_STOP_FACTOR).toFixed(2) : '—';
      stopEl.classList.toggle('inv-stop-hit', stopHit);
      if (stopHit) stopEl.title = 'המחיר הגיע לסטופ';
    }
    if (stopHit) invNotifyStopHit(inputs?.[0]?.value?.trim().toUpperCase(), livePrice, entryPrice * INV_STOP_FACTOR);
    if (valEl) valEl.textContent = value > 0 ? cur + value.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
    if (pnlEl) {
      if (pnlAmt !== null) {
        const sign = pnlAmt >= 0 ? '+' : '';
        pnlEl.textContent = pnlMode === 'amount'
          ? `${sign}${cur}${Math.abs(pnlAmt).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`
          : `${sign}${pnlPct.toFixed(2)}%`;
        pnlEl.style.color = pnlAmt >= 0 ? 'var(--green)' : 'var(--red)';
        pnlEl.style.fontWeight = '700';
      } else {
        pnlEl.textContent = '—'; pnlEl.style.color = ''; pnlEl.style.fontWeight = '';
      }
    }
    if (barEl) barEl.style.width = Math.min(pct, 100) + '%';
    if (pctEl) pctEl.textContent = pct > 0 ? pct.toFixed(1) + '%' : '0%';
  });

  // Allocated % = invested value / total portfolio
  const allocEl = document.getElementById('inv-allocated-pct');
  if (allocEl) {
    // Value, not cost — the label says "invested" and cash is the value-based
    // remainder, so on a cost basis the two never summed to 100%.
    const allocPct = effectiveTotal > 0 ? (totalCurrentValue / effectiveTotal * 100) : 0;
    allocEl.textContent = allocPct.toFixed(1) + '%';
    allocEl.style.color = allocPct > 100 ? 'var(--red)' : 'var(--accent)';
  }
  // Free cash = total − invested (live). Shown next to the total input.
  const cashValEl = document.getElementById('inv-cash-value');
  if (cashValEl) cashValEl.textContent = portfolioTotal > 0
    ? invGetCurrency() + cash.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : '—';

  // Allocation bars use CURRENT VALUE, not cost. On a cost basis a category that
  // had run up read 57.6% against a 60% target while actually being 79% of the
  // portfolio — the panel invited another buy into a position already $6k over.
  // Value basis also makes invested + cash close at exactly 100%.
  const c = invGetCurrency();
  Object.entries(ALLOC_TARGETS).forEach(([cat, target]) => {
    const targetAmt  = effectiveTotal * target;
    const currentAmt = byCatValue[cat];
    const currentPct = effectiveTotal > 0 ? (currentAmt / effectiveTotal * 100) : 0;
    const remaining  = Math.max(0, targetAmt - currentAmt);
    const over       = effectiveTotal > 0 && currentAmt > targetAmt;
    const barW       = targetAmt > 0 ? Math.min(currentAmt / targetAmt * 100, 100) : 0;
    const barEl = document.getElementById(`alloc-bar-${cat}`);
    const invEl = document.getElementById(`alloc-inv-${cat}`);
    const curEl = document.getElementById(`alloc-cur-${cat}`);
    const remEl = document.getElementById(`alloc-rem-${cat}`);
    if (barEl) { barEl.style.width = barW + '%'; barEl.style.background = over ? 'var(--red)' : ALLOC_COLORS[cat]; }
    if (invEl) invEl.textContent = currentAmt > 0 ? `${c}${currentAmt.toLocaleString('en-US', {maximumFractionDigits:0})}` : '—';
    if (curEl) { curEl.textContent = currentPct.toFixed(1) + '%'; curEl.style.color = over ? 'var(--red)' : 'var(--text2)'; }
    if (remEl) {
      if (effectiveTotal === 0) { remEl.textContent = ''; return; }
      remEl.textContent = over
        ? `${t('inv_overby')} ${c}${(currentAmt - targetAmt).toLocaleString('en-US', {maximumFractionDigits:0})}`
        : `${t('inv_free')}: ${c}${remaining.toLocaleString('en-US', {maximumFractionDigits:0})}`;
      remEl.style.color = over ? 'var(--red)' : 'var(--text3)';
    }
  });

  // Cash row
  const cashTarget = portfolioTotal * ALLOC_CASH_TARGET;
  const cashPct = portfolioTotal > 0 ? (cash / portfolioTotal * 100) : 0;
  const cashBarW = cashTarget > 0 ? Math.min(cash / cashTarget * 100, 100) : 0;
  const cashOver = portfolioTotal > 0 && cash > cashTarget;
  const cashBarEl = document.getElementById('alloc-bar-cash');
  const cashCurEl = document.getElementById('alloc-cur-cash');
  const cashRemEl = document.getElementById('alloc-rem-cash');
  if (cashBarEl) { cashBarEl.style.width = cashBarW + '%'; cashBarEl.style.background = '#2dd4bf'; }
  const cashInvEl = document.getElementById('alloc-inv-cash');
  if (cashInvEl) cashInvEl.textContent = cash > 0 ? c + cash.toLocaleString('en-US', {maximumFractionDigits:0}) : '—';
  // The donut clamps cash to the room the allocations leave; printing the raw
  // figure here made the same screen show two different cash percentages.
  const cashShown = invDonutPcts(byCatValue, portfolioTotal, cash).cash;
  if (cashCurEl) {
    cashCurEl.textContent = cashShown.toFixed(1) + '%';
    cashCurEl.style.color = 'var(--text2)';
    cashCurEl.title = Math.abs(cashShown - cashPct) > 0.05
      ? `מזומן פנוי הוא ${cashPct.toFixed(1)}% מהתיק, אך ההקצאות כבר תופסות את שאר הטבעת` : '';
  }

  // Uncategorized holdings get their own row instead of silently vanishing.
  const noneAmt = byCatValue.none || 0;
  const noneRow = document.getElementById('alloc-row-none');
  if (noneRow) noneRow.style.display = noneAmt > 0 ? '' : 'none';
  if (noneAmt > 0) {
    const nonePct = effectiveTotal > 0 ? noneAmt / effectiveTotal * 100 : 0;
    const nb = document.getElementById('alloc-bar-none');
    const ni = document.getElementById('alloc-inv-none');
    const nc = document.getElementById('alloc-cur-none');
    if (nb) nb.style.width = Math.min(nonePct, 100) + '%';
    if (ni) ni.textContent = `${c}${noneAmt.toLocaleString('en-US', {maximumFractionDigits:0})}`;
    if (nc) nc.textContent = nonePct.toFixed(1) + '%';
  }
  // The cash row had a target and a bar but an empty remaining column, so it
  // was the one row that never said whether it was on plan. Excess cash is not
  // a risk breach the way an over-weight category is, so it stays grey — but a
  // shortfall means the buffer has been spent down and is worth naming.
  if (cashRemEl) {
    if (portfolioTotal === 0) { cashRemEl.textContent = ''; }
    else {
      cashRemEl.textContent = cashOver
        ? `עודף: ${c}${(cash - cashTarget).toLocaleString('en-US', {maximumFractionDigits:0})}`
        : `חסר: ${c}${(cashTarget - cash).toLocaleString('en-US', {maximumFractionDigits:0})}`;
      cashRemEl.style.color = cashOver ? 'var(--text3)' : 'var(--yellow, #fbbf24)';
    }
  }

  const symOf = i => (tbody.querySelector(`tr[data-idx="${i}"] .inv-sym-chip`)?.textContent
    || tbody.querySelector(`tr[data-idx="${i}"] .inv-sym-input`)?.value || '').trim();
  const money0 = n => c + Math.round(n).toLocaleString('en-US');
  const money2 = n => c + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  rowData.forEach(({ i, cat, cost }) => {
    const remEl = document.getElementById(`inv-catrem-${i}`);
    if (!remEl) return;
    if (!cat || portfolioTotal === 0) { remEl.textContent = '—'; remEl.title = ''; remEl.style.color = ''; return; }
    const inputs = tbody.querySelector(`tr[data-idx="${i}"]`)?.querySelectorAll('input');
    const price = +(inputs?.[4]?.value) || +(inputs?.[3]?.value) || 0;
    const info = invRoomInfo({ portfolioTotal, target: ALLOC_TARGETS[cat], catValue: byCatValue[cat], price, cost });
    const sub = info.over > 0
      ? `עודף ${money0(info.over)} מעל היעד`
      : [info.shares != null ? `≈${info.shares} מניות` : '', info.tranches != null ? `${info.tranches.toFixed(1)} פעימות` : ''].filter(Boolean).join(' · ');
    remEl.innerHTML = `<span style="display:block">${info.over > 0 ? t('inv_over') : money0(info.free)}</span>` +
      (sub ? `<span style="display:block;font-size:11px;font-weight:500;color:var(--text3)">${sub}</span>` : '');
    const others = rowData.filter(r => r.cat === cat && r.i !== i).map(r => symOf(r.i)).filter(Boolean);
    remEl.title = [
      `יעד הקטגוריה: ${money2(info.catAmt)} (${(ALLOC_TARGETS[cat] * 100).toFixed(0)}% מהתיק)`,
      `מושקע כרגע בקטגוריה: ${money2(byCatValue[cat])}`,
      info.over > 0 ? `עודף מעל היעד: ${money2(info.over)}` : `נשאר להשקיע: ${money2(info.free)}`,
      cost > 0 ? `פעימה = עלות הפוזיציה הנוכחית: ${money2(cost)}` : '',
      others.length ? `הסכום משותף עם: ${others.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    remEl.style.color = info.over > 0 ? 'var(--red)' : 'var(--green)';
  });

  invUpdateDonut(byCatValue, effectiveTotal, cash);
  invRenderDeposits(invLoad().deposits || [], totalCurrentValue);

  // Summary bar
  const costEl = document.getElementById('inv-sum-cost');
  const valEl2 = document.getElementById('inv-sum-value');
  const pnlEl2 = document.getElementById('inv-sum-pnl');
  if (costEl) costEl.textContent = totalCost > 0 ? cur + totalCost.toLocaleString('en-US',{maximumFractionDigits:0}) : '—';
  if (valEl2) valEl2.textContent = totalCurrentValue > 0 ? cur + totalCurrentValue.toLocaleString('en-US',{maximumFractionDigits:0}) : '—';
  if (pnlEl2) {
    if (totalUnrealizedPnL !== null) {
      const sign = totalUnrealizedPnL >= 0 ? '+' : '';
      const pct  = pnlCost > 0 ? (totalUnrealizedPnL / pnlCost * 100).toFixed(1) : null;
      pnlEl2.textContent = `${sign}${cur}${Math.abs(totalUnrealizedPnL).toLocaleString('en-US',{maximumFractionDigits:0})}${pct !== null ? ` (${sign}${pct}%)` : ''}`;
      pnlEl2.classList.remove('pnl-pos', 'pnl-neg');
      pnlEl2.classList.add(totalUnrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg');
    } else { pnlEl2.textContent = '—'; pnlEl2.classList.remove('pnl-pos', 'pnl-neg'); }
  }

  // Both calculators read the live table, but nothing re-rendered them, so with
  // a modal open the caps and ✓/⚠ marks froze while quotes moved underneath —
  // then jumped on the next keystroke.
  if (document.getElementById('inv-calc-modal')?.classList.contains('open')) invCalcRender();
  if (document.getElementById('inv-position-modal')?.classList.contains('open')) invSizerRender();
}

function invGetCurrentData() {
  const tbody = document.getElementById('inv-tbody');
  const rows = tbody ? tbody.querySelectorAll('tr[data-idx]') : [];
  const holdings = [];
  const known = (_invData && _invData.holdings) || [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const cat = row.querySelector('.inv-cat-sel')?.value || '';
    holdings.push({
      // The DOM carries values, not identity. Without carrying the row's id
      // across, every save would look like "delete everything, insert new
      // everything" and the stable ids this table exists for would last exactly
      // one edit. data-idx is the index the rest of this function relies on.
      id:           known[+row.dataset.idx]?.id,
      symbol:       (inputs[0]?.value || '').toUpperCase().trim(),
      sector:       (inputs[1]?.value || '').trim(),
      cat,
      entryShares:  +(inputs[2]?.value) || 0,
      entryPrice:   +(inputs[3]?.value) || 0,
      currentPrice: +(inputs[4]?.value) || 0,
    });
  });
  return {
    // Deliberately NOT filtered. Callers index this array with the DOM's
    // data-idx, so dropping blank rows here shifted every later holding down
    // one — invDeleteRow(i) then removed a different position than the × that
    // was clicked, and selling out of one row could delete another. Blank rows
    // are stripped at save time instead, where no index depends on them.
    portfolioTotal: document.getElementById('inv-portfolio-total')?.value || '',
    holdings,
    deposits: invLoad().deposits || []
  };
}

function invStripBlank(holdings) {
  return (holdings || []).filter(h => h.symbol || h.entryShares || h.entryPrice);
}

function invEditRow(i) {
  const data = invGetCurrentData();
  if (data.holdings[i]) { data.holdings[i].locked = false; _invData = data; invRenderRows(data.holdings); }
}

async function invLockRow(i) {
  const gen = _invReloadGen;
  const data = invGetCurrentData();
  if (!data.holdings[i]) return;
  data.holdings[i].locked = true;
  const ok = await invSaveData(data);
  if (gen !== _invReloadGen || !ok) return;
  if (ok) toast('נשמר ✓', 'success');
  invRenderRows(data.holdings);
  invRecalc();
  // Committing a row is when its symbol becomes real — without this the new
  // holding sat with no price and no P&L until the next 60s tick.
  invFetchPrices();
}

function invAddRow() {
  const data = invGetCurrentData();
  data.holdings.push({ symbol:'', entryShares:0, entryPrice:0, locked: false });
  // _invData is the source of truth invGetCurrentData() reads ids from (known[idx]),
  // and what the realtime handler's invInit()->invRenderRows() redraws from on ANY
  // postgres_changes event for this user's investments/investment_holdings rows —
  // including a delayed echo of their own earlier save. Without this line, the new
  // blank row exists only in the DOM until the first autosave fires; a realtime
  // event landing in that window wiped it out from under the user mid-edit, with
  // no error and nothing to see after a refresh — the "I added it, it showed, then
  // it was gone" report.
  if (_invData) _invData.holdings = data.holdings;
  invRenderRows(data.holdings);
  const tbody = document.getElementById('inv-tbody');
  if (tbody) {
    const newRow = tbody.querySelector('tr[data-idx="' + (data.holdings.length - 1) + '"]');
    newRow?.querySelector('input')?.focus();
  }
}

// 8% under the entry. supabase/functions/_shared/stop_alert.ts holds the same
// number for the Telegram alert; change both.
const INV_STOP_FACTOR = 0.92;
function invStopHit(price, entry) {
  return +entry > 0 && +price > 0 && +price <= +entry * INV_STOP_FACTOR;
}
const _invStopNotified = new Set();
function invNotifyStopHit(sym, price, stop) {
  if (!sym || _invStopNotified.has(sym)) return;
  _invStopNotified.add(sym);
  toast(`${sym} הגיעה לסטופ — מחיר ${price.toFixed(2)}, סטופ ${stop.toFixed(2)}`, 'error');
}

async function invFetchPrices(save = true) {
  const tbody = document.getElementById('inv-tbody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr[data-idx]')];
  const symbols = [];
  rows.forEach(row => {
    const symInput = row.querySelector('input');
    const sym = symInput?.value?.trim().toUpperCase();
    if (sym) symbols.push({ row, sym });
  });
  if (!symbols.length) return;

  const token = await _getToken();
  if (!token) return;
  let updated = 0;
  await Promise.all(symbols.map(async ({ row, sym }) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/finnhub?path=quote&symbol=${encodeURIComponent(sym)}`,
        { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await r.json();
      const price = data.c || data.pc;
      if (!price) return;
      // invRenderRows() replaces #inv-tbody wholesale, so a row captured before
      // the await can be detached by the time the quote lands. Writing to it
      // updated nothing, then invRecalc()+invAutoSave() persisted the live DOM
      // with the prices still at 0.
      if (!row.isConnected) return;
      const inputs = row.querySelectorAll('input');
      const priceInput = inputs[4];
      if (priceInput) { priceInput.value = price; updated++; }
    } catch {}
  }));

  if (updated > 0) {
    _invPricesUpdatedAt = Date.now();
    invRecalc();
    if (save) invAutoSave();
  }
  // Repaint the age indicator on every tick, not only on success. It used to be
  // inside the `updated > 0` block, so a rate-limited or failing feed left it
  // frozen at "just now" while the prices — and every % derived from them —
  // silently aged.
  invUpdatePricesTimestamp();
}

let _invPricesUpdatedAt = null;
function invUpdatePricesTimestamp() {
  const el = document.getElementById('inv-prices-updated');
  if (!el || !_invPricesUpdatedAt) return;
  const mins = Math.round((Date.now() - _invPricesUpdatedAt) / 60000);
  el.textContent = mins === 0 ? t('inv_just_now') : `${mins} min ago`;
}

let _invPosRowIdx = null;
let _invPosSym = '';
let _invPosCat = '';

// Recomputed on every render rather than snapshotted when the modal opens: the
// portfolio value field is editable and the 60s quote tick keeps moving the
// cash figure, so a frozen context sized the order off one portfolio total
// while judging the caps against another.
function invSizerCtx(catOverride) {
  const cat = catOverride !== undefined ? catOverride : (_invPosCat || '');
  const totals = invAccumulate([...document.querySelectorAll('#inv-tbody tr[data-idx]')].map(r => {
    const inp = r.querySelectorAll('input');
    return { cat: r.querySelector('.inv-cat-sel')?.value || '',
             entryShares: inp[2]?.value, entryPrice: inp[3]?.value, currentPrice: inp[4]?.value };
  }));
  // "100,000" here used to be NaN, which zeroed every cap and painted two red
  // warnings on a perfectly valid order.
  const portfolioTotal = invParseTotal(document.getElementById('inv-portfolio-total')?.value);
  return {
    cat, portfolioTotal,
    holdingsValueUsd: totals.totalCurrentValue,
    catCostUsd: cat ? (totals.byCatValue[cat] || 0) : 0,
    catTargetFrac: cat ? (ALLOC_TARGETS[cat] || 0) : 0,
    cashUsd: Math.max(0, portfolioTotal - totals.totalCurrentValue),
  };
}

function invSizerInputs() {
  const price = +(document.getElementById('inv-pos-price')?.value) || 0;
  const fx = invFxLoad();
  const ctx = invSizerCtx();
  // The field takes a % below entry, not a $ stop price — a fixed $ value
  // meant nothing without also knowing the entry price it was measured
  // against, and invPositionSize's own risk math already needs that price.
  const stopPct = +(document.getElementById('inv-sz-stop')?.value) || 0;
  return {
    portfolioValue: +(document.getElementById('inv-sz-portfolio')?.value) || 0,
    portfolioCurrency: document.getElementById('inv-sz-currency')?.value || '$',
    fxRate: fx?.rate || 0,
    pctOfPortfolio: +(document.getElementById('inv-sz-pct')?.value) || 0,
    price,
    stop: stopPct > 0 && price > 0 ? price * (1 - stopPct / 100) : 0,
    portfolioTotalUsd: ctx.portfolioTotal,
    catCostUsd: ctx.catCostUsd,
    catTargetFrac: ctx.catTargetFrac,
    cashUsd: ctx.cashUsd,
  };
}

// Shared by the in-row sizer and the standalone calculator so the two can never
// disagree about what the same numbers mean.
function invSizerPaint(out, inp) {
  const r = invPositionSize(inp);
  if (r.error === 'no-fx') {
    // Deliberately no number: sizing a real order off a guessed rate is worse
    // than showing nothing.
    out.innerHTML = `<span style="color:var(--red)">אין שער דולר/שקל זמין — לא ניתן לחשב כמות.</span>
      <span style="color:var(--text3)">נסה שוב בעוד רגע או עבור לדולר.</span>`;
    return r;
  }
  if (r.error) { out.style.display = 'none'; return r; }

  const fx = invFxLoad();
  const stale = fx && Date.now() - fx.ts > 86400_000;
  const conv = inp.portfolioCurrency === '₪'
    ? `${(inp.portfolioValue * inp.pctOfPortfolio / 100).toLocaleString('en-US',{maximumFractionDigits:0})} ₪ ÷ ${fx.rate.toFixed(4)}${stale ? ' <span style="color:var(--yellow,#fbbf24)">(שער ישן)</span>' : ''} = `
    : '';
  const ok  = v => v ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">⚠</span>';
  const cap = (label, within, detail) => `${ok(within)} ${label} <span style="color:var(--text3)">${detail}</span>`;

  out.innerHTML = `
    <div>${conv}<b class="sensitive">$${r.amountUsd.toLocaleString('en-US',{maximumFractionDigits:2})}</b> ÷ $${fmtPrice(inp.price)} →
      <b style="color:var(--accent);font-size:15px">${r.shares}</b> מניות</div>
    <div class="sensitive">גודל בפועל $${r.positionUsd.toLocaleString('en-US',{maximumFractionDigits:0})}${
      r.actualPct !== null ? ` · <b>${r.actualPct.toFixed(1)}%</b> מהתיק בפועל` : ''}</div>
    ${r.riskUsd !== null ? `<div class="sensitive">סיכון סטופ $${r.riskUsd.toLocaleString('en-US',{maximumFractionDigits:0})} · ${r.riskPct.toFixed(2)}% מהתיק · סטופ ב-$${fmtPrice(inp.stop)}</div>` : ''}
    <div>${cap('יעד קטגוריה', r.withinTarget, `נשאר $${r.catRoomUsd.toLocaleString('en-US',{maximumFractionDigits:0})} · עד ${r.maxSharesByTarget} מניות`)}</div>
    <div>${cap('מזומן פנוי', r.withinCash, `$${inp.cashUsd.toLocaleString('en-US',{maximumFractionDigits:0})} · עד ${r.maxSharesByCash} מניות`)}</div>`;
  applyPrivacy();
  return r;
}

function invSizerRender() {
  const out = document.getElementById('inv-sz-out');
  if (!out) return;
  const inp = invSizerInputs();
  const mode = document.getElementById('inv-position-modal')?.dataset.mode || 'buy';
  if (mode !== 'buy' || !inp.portfolioValue || !inp.pctOfPortfolio) { out.style.display = 'none'; return; }
  out.style.display = 'block';
  invSizerPaint(out, inp);
}

// ── Standalone calculator ──────────────────────────────────────────────────
function invCalcInputs() {
  const cat = document.getElementById('ic-cat')?.value || 'blue';
  const ctx = invSizerCtx(cat);
  const portfolioValue = +(document.getElementById('ic-portfolio')?.value) || 0;
  const currency = document.getElementById('ic-currency')?.value || '$';
  const fxRate = invFxLoad()?.rate || 0;

  // The portfolio typed here is the one being sized against, so every cap has
  // to be measured against it too. Reading the order size from this field while
  // judging the caps against the tab's total let a 500k entry report "50% of
  // portfolio" and still pass a cash check run against 100k.
  const totalUsd = currency === '₪'
    ? (fxRate > 0 ? portfolioValue / fxRate : 0)
    : portfolioValue;

  // Same % stop — see invSizerInputs's comment.
  const icPrice = +(document.getElementById('ic-price')?.value) || 0;
  const icStopPct = +(document.getElementById('ic-stop')?.value) || 0;
  return {
    portfolioValue, portfolioCurrency: currency, fxRate,
    pctOfPortfolio: +(document.getElementById('ic-pct')?.value) || 0,
    price: icPrice,
    stop: icStopPct > 0 && icPrice > 0 ? icPrice * (1 - icStopPct / 100) : 0,
    portfolioTotalUsd: totalUsd,
    catCostUsd: ctx.catCostUsd,
    catTargetFrac: ctx.catTargetFrac,
    cashUsd: Math.max(0, totalUsd - ctx.holdingsValueUsd),
  };
}

function invCalcRender() {
  const out = document.getElementById('ic-out');
  const tOut = document.getElementById('ic-tranche-out');
  if (!out) return;
  const inp = invCalcInputs();
  if (!inp.portfolioValue || !inp.pctOfPortfolio || !inp.price) {
    out.style.display = 'none'; if (tOut) tOut.style.display = 'none'; return;
  }
  out.style.display = 'block';
  const r = invSizerPaint(out, inp);
  if (!tOut) return;

  const n = +(document.getElementById('ic-tranches')?.value) || 1;
  const parts = (r && !r.error) ? invSplitEntries(r.shares, inp.price, n) : [];
  if (parts.length < 2) { tOut.style.display = 'none'; return; }
  tOut.style.display = 'block';

  const totalShares = parts.reduce((s, e) => s + e.shares, 0);
  const totalUsd    = parts.reduce((s, e) => s + e.usd, 0);
  const short = parts.length < n;
  const risk = invTrancheRisk(parts, inp.price, inp.stop);
  const hasRisk = risk.length > 0;
  const totalLoss = hasRisk ? risk[risk.length - 1].cum : 0;
  const lossPct = hasRisk && inp.portfolioTotalUsd > 0 ? totalLoss / inp.portfolioTotalUsd * 100 : null;
  const usd = v => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  // Without the isolate, RTL bidi reorders a leading minus to the end and
  // "−$88" renders as "$88−", which reads as a footnote mark, not a loss.
  const ltr = 'direction:ltr;unicode-bidi:isolate;';
  const cols = hasRisk ? '1fr 1fr 1fr' : '1fr 1fr';
  tOut.innerHTML = `
    <div style="font-weight:700;color:var(--text2);margin-bottom:5px">חלוקה ל-${parts.length} פעימות</div>
    <div style="display:grid;grid-template-columns:${cols};gap:8px;color:var(--text3);font-size:11px;padding-bottom:3px">
      <span>כניסה</span><span style="text-align:center">עלות</span>
      ${hasRisk ? `<span style="${ltr}display:flex;gap:4px" title="ההפסד אם הסטופ נפגע — לפעימה הזו, ובמצטבר על כל מה שכבר נקנה"><span>בסטופ</span><span>·</span><span>מצטבר</span></span>` : ''}
    </div>
    ${parts.map((e, i) => `
      <div style="display:grid;grid-template-columns:${cols};gap:8px;padding:2px 0">
        <span><span style="color:var(--text3)">כניסה ${i + 1}:</span> <b>${e.shares}</b> מניות</span>
        <span class="sensitive" style="color:var(--text3);text-align:center">${usd(e.usd)}</span>
        ${hasRisk ? `<span class="sensitive" style="color:#e11d48;text-align:left;${ltr}">−${usd(risk[i].loss)}<span style="color:var(--text3)"> · −${usd(risk[i].cum)}</span></span>` : ''}
      </div>`).join('')}
    <div style="display:grid;grid-template-columns:${cols};gap:8px;margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.07)">
      <span style="color:var(--text2)">סה"כ <b>${totalShares}</b> מניות</span>
      <span class="sensitive" style="color:var(--text2);text-align:center">${usd(totalUsd)}</span>
      ${hasRisk ? `<span class="sensitive" style="color:#e11d48;font-weight:700;text-align:left;${ltr}">−${usd(totalLoss)}${lossPct !== null ? `<span style="color:var(--text3);font-weight:400"> · ${lossPct.toFixed(2)}%</span>` : ''}</span>` : ''}
    </div>
    ${!hasRisk ? '<div style="color:var(--text3);margin-top:5px">הזן סטופ כדי לראות כמה כל פעימה מסכנת</div>' : ''}
    ${short ? `<div style="color:var(--yellow,#fbbf24);margin-top:5px">רק ${r.shares} מניות בסך הכל — לא ניתן לחלק ל-${n} כניסות</div>` : ''}`;
  applyPrivacy();
}

// Fetching the quote is what makes this usable for a stock you do not own yet.
async function invCalcFetchPrice() {
  const sym = (document.getElementById('ic-sym')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9._\-]/g, '');
  if (!sym) return;
  const priceEl = document.getElementById('ic-price');
  try {
    const token = await _getToken();
    if (!token) return;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/finnhub?path=quote&symbol=${encodeURIComponent(sym)}`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) { toast('לא ניתן למשוך מחיר — הזן ידנית', 'error'); return; }
    const data = await res.json();
    const p = +data.c || 0;
    if (!p) { toast(`אין ציטוט ל-${sym} — הזן מחיר ידנית`, 'error'); return; }
    priceEl.value = p;
    invCalcRender();
  } catch { toast('לא ניתן למשוך מחיר — הזן ידנית', 'error'); }
}

function invCalcOpen() {
  // Same comma trap as invSizerCtx: `+"32,253"` is NaN, which left this field
  // blank and the whole calculator showing nothing.
  document.getElementById('ic-portfolio').value = invSizerCtx('').portfolioTotal || '';
  document.getElementById('ic-currency').value = '$';
  ['ic-sym', 'ic-price', 'ic-stop'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  // Open on the room left in the selected category, same rule as the in-row sizer.
  const applyCat = () => {
    const ctx = invSizerCtx(document.getElementById('ic-cat').value);
    const room = ctx.portfolioTotal > 0
      ? Math.max(0, (ctx.catTargetFrac * ctx.portfolioTotal - ctx.catCostUsd) / ctx.portfolioTotal * 100) : 0;
    document.getElementById('ic-pct').value = room ? room.toFixed(1) : '';
    invCalcRender();
  };
  document.getElementById('ic-cat').onchange = applyCat;
  document.getElementById('ic-tranches').value = '1';
  ['ic-portfolio', 'ic-pct', 'ic-price', 'ic-stop', 'ic-tranches'].forEach(id => {
    const e = document.getElementById(id); if (e) e.oninput = invCalcRender;
  });
  // Flipping the currency must convert the amount, not just relabel it. The
  // field is prefilled in dollars, so leaving it untouched turned a $32,253
  // portfolio into ₪32,253 (~$11k) and quietly sized the order ~3x too small.
  let icPrevCur = '$';
  document.getElementById('ic-currency').onchange = async (e) => {
    const next = e.target.value;
    const fx = await invFxRefresh();
    const el = document.getElementById('ic-portfolio');
    const v = +el.value || 0;
    if (v && fx?.rate > 0 && next !== icPrevCur) {
      el.value = next === '₪' ? Math.round(v * fx.rate) : Math.round(v / fx.rate);
    }
    icPrevCur = next;
    invCalcRender();
  };
  const symEl = document.getElementById('ic-sym');
  symEl.onchange = invCalcFetchPrice;
  symEl.onblur = invCalcFetchPrice;
  applyCat();
  document.getElementById('ic-out').style.display = 'none';
  invFxRefresh().then(invCalcRender);
  document.getElementById('inv-calc-modal').classList.add('open');
  setTimeout(() => symEl.focus(), 80);
}

function invCalcClose() {
  document.getElementById('inv-calc-modal')?.classList.remove('open');
}

function invSizerApply() {
  const r = invPositionSize(invSizerInputs());
  if (r.error === 'no-fx') { toast('אין שער דולר/שקל — לא ניתן להציע כמות', 'error'); return; }
  if (r.error || r.suggestedShares === null) { toast('הכנס מחיר ואחוז תחילה', 'error'); return; }
  const qtyEl = document.getElementById('inv-pos-qty');
  qtyEl.value = r.suggestedShares;
  qtyEl.dispatchEvent(new Event('input'));
  toast(r.suggestedShares > 0 ? `הוצע: ${r.suggestedShares} מניות` : 'אין מקום לקנייה בקטגוריה הזו', r.suggestedShares > 0 ? 'success' : 'error');
}

function invToggleBuyRow(i) {
  _invPosRowIdx = i;
  _invPosSym = '';
  const tbody = document.getElementById('inv-tbody');
  const mainRow = tbody?.querySelector(`tr[data-idx="${i}"]`);
  if (!mainRow) return;
  const inputs = mainRow.querySelectorAll('input');
  const sym = inputs[0]?.value || '';
  // On an unlocked row the symbol is whatever has been typed so far, so it can
  // legitimately still be empty — the calculator needs one to price anything.
  if (!sym.trim()) { toast('הכנס סימבול לשורה תחילה', 'error'); return; }
  _invPosSym = sym.toUpperCase().trim();
  const oldQty   = +(inputs[2]?.value) || 0;
  const oldPrice = +(inputs[3]?.value) || 0;
  const cur = invGetCurrency();

  document.getElementById('inv-pos-modal-title').textContent = sym;
  const currentPrice = +(inputs[4]?.value) || 0;
  document.getElementById('inv-pos-qty').value = '';
  document.getElementById('inv-pos-price').value = '';
  document.getElementById('inv-pos-current-price').value = currentPrice || '';
  document.getElementById('inv-pos-date').value = _todayLocal();
  document.getElementById('inv-pos-result').style.display = 'none';
  invSetPosMode('buy');

  const updatePreview = () => {
    const qty   = +(document.getElementById('inv-pos-qty')?.value) || 0;
    const price = +(document.getElementById('inv-pos-price')?.value) || 0;
    const mode  = document.getElementById('inv-position-modal')?.dataset.mode || 'buy';
    const res   = document.getElementById('inv-pos-result');
    if (!qty) { res.style.display = 'none'; return; }
    res.style.display = 'block';
    if (mode === 'buy' && price) {
      const totalQty = oldQty + qty;
      const avg = (oldQty * oldPrice + qty * price) / totalQty;
      res.innerHTML = `כמות חדשה: <b>${totalQty}</b> &nbsp;|&nbsp; שער ממוצע חדש: <b>${cur}${avg.toFixed(2)}</b>`;
    } else if (mode === 'sell') {
      const remaining = oldQty - qty;
      res.innerHTML = remaining > 0
        ? `כמות שתישאר: <b>${remaining}</b>`
        : `<span style="color:var(--red)">הפוזיציה תיסגר לחלוטין</span>`;
    } else { res.style.display = 'none'; }
  };

  document.getElementById('inv-pos-qty').oninput   = updatePreview;
  document.getElementById('inv-pos-price').oninput = updatePreview;

  // Seed the sizer: price defaults to the live quote, and the desired % opens
  // on whatever room this holding's category has left against its target.
  _invPosCat = mainRow.querySelector('.inv-cat-sel')?.value || '';
  const ctx = invSizerCtx();
  const roomPct = ctx.portfolioTotal > 0
    ? Math.max(0, (ctx.catTargetFrac * ctx.portfolioTotal - ctx.catCostUsd) / ctx.portfolioTotal * 100) : 0;
  document.getElementById('inv-sz-portfolio').value = ctx.portfolioTotal || '';
  document.getElementById('inv-sz-currency').value = '$';
  document.getElementById('inv-sz-pct').value = roomPct ? roomPct.toFixed(1) : '';
  document.getElementById('inv-sz-stop').value = '';
  document.getElementById('inv-pos-price').value = currentPrice || '';
  ['inv-sz-portfolio','inv-sz-pct','inv-sz-stop','inv-pos-price'].forEach(id => {
    const el = document.getElementById(id); if (el) el.oninput = invSizerRender;
  });
  document.getElementById('inv-sz-currency').onchange = () => { invFxRefresh().then(invSizerRender); invSizerRender(); };
  invFxRefresh().then(invSizerRender);
  invSizerRender();

  const modal = document.getElementById('inv-position-modal');
  modal.dataset.mode = 'buy';
  modal.classList.add('open');
  setTimeout(() => document.getElementById('inv-pos-qty')?.focus(), 80);
}

function invSetPosMode(mode) {
  document.getElementById('inv-pos-buy-btn')?.classList.toggle('buy-active',  mode === 'buy');
  document.getElementById('inv-pos-buy-btn')?.classList.toggle('sell-active', false);
  document.getElementById('inv-pos-sell-btn')?.classList.toggle('sell-active', mode === 'sell');
  document.getElementById('inv-pos-sell-btn')?.classList.toggle('buy-active',  false);
  const priceGroup = document.getElementById('inv-pos-price-group');
  if (priceGroup) priceGroup.style.display = mode === 'sell' ? 'none' : '';
  const sizer = document.getElementById('inv-pos-sizer');
  if (sizer) sizer.style.display = mode === 'sell' ? 'none' : '';
  const modal = document.getElementById('inv-position-modal');
  if (modal) modal.dataset.mode = mode;
  document.getElementById('inv-pos-qty')?.dispatchEvent(new Event('input'));
}

function invClosePositionModal() {
  document.getElementById('inv-position-modal')?.classList.remove('open');
  _invPosRowIdx = null;
}

function invConfirmPositionModal() {
  const i = _invPosRowIdx;
  if (i === null) return;
  const mode  = document.getElementById('inv-position-modal')?.dataset.mode || 'buy';
  const qty   = +(document.getElementById('inv-pos-qty')?.value) || 0;
  const price = +(document.getElementById('inv-pos-price')?.value) || 0;
  // min="0" on the input is not enforced without a form submit. A negative sell
  // quantity read as `oldQty - (-5)` minted five free shares at an unchanged
  // average price; a negative buy price dragged the weighted average through
  // zero.
  if (!(qty > 0)) { toast('הכנס כמות חיובית', 'error'); return; }
  if (mode === 'buy' && !(price > 0)) { toast('הכנס מחיר חיובי', 'error'); return; }

  const tbody = document.getElementById('inv-tbody');
  const mainRow = tbody?.querySelector(`tr[data-idx="${i}"]`);
  if (!mainRow) return;
  const inputs = mainRow.querySelectorAll('input');
  // A debounced autosave can merge duplicates and renumber every data-idx while
  // this modal is open, so the row now at index i may be a different holding.
  if ((inputs[0]?.value || '').toUpperCase().trim() !== _invPosSym) {
    toast('הטבלה השתנתה בינתיים — פתח מחדש את החלון', 'error');
    invClosePositionModal();
    return;
  }
  const oldQty   = +(inputs[2]?.value) || 0;
  const oldPrice = +(inputs[3]?.value) || 0;
  if (mode === 'sell' && qty > oldQty) { toast(`כמות גדולה מהאחזקה (${oldQty})`, 'error'); return; }
  const cur = invGetCurrency();

  invClosePositionModal();

  const newCurrentPrice = +(document.getElementById('inv-pos-current-price')?.value) || 0;
  if (newCurrentPrice && inputs[4]) inputs[4].value = newCurrentPrice;

  if (mode === 'buy') {
    const totalQty = oldQty + qty;
    const avgPrice = totalQty > 0 ? (oldQty * oldPrice + qty * price) / totalQty : price;
    if (inputs[2]) inputs[2].value = totalQty;
    // Rounded to 4dp this value went straight back into the DOM and invRecalc
    // read it back as the cost basis, so every later % derived from a truncated
    // average. 6dp keeps the field readable without feeding rounding into P&L.
    if (inputs[3]) inputs[3].value = parseFloat(avgPrice.toFixed(6));
    invRecalc(); invAutoSave();
    toast(`עודכן: ${totalQty} מניות @ ${cur}${avgPrice.toFixed(2)} ממוצע`, 'success');
  } else {
    const newQty = oldQty - qty;
    if (newQty <= 0) {
      invDeleteRow(i);
      toast('פוזיציה הוסרה', 'success');
      return;
    }
    if (inputs[2]) inputs[2].value = newQty;
    invRecalc(); invAutoSave();
    toast(`עודכן: ${newQty} מניות נותרו`, 'success');
  }
}

function invDeleteRow(i) {
  const data = invGetCurrentData();
  const sym = data.holdings[i]?.symbol || 'החזקה זו';
  if (!confirm(`למחוק את ${sym}?`)) return;
  data.holdings.splice(i, 1);
  invRenderRows(data.holdings);
  // invRenderRows only paints rows. Without this the summary, allocation bars,
  // donut and per-row percentages kept counting the deleted position.
  invRecalc();
  invSaveData(data);
}

function invMergeDuplicates(holdings) {
  const merged = [];
  holdings.forEach(h => {
    if (!h.symbol) { merged.push(h); return; }
    const existing = merged.find(m => m.symbol === h.symbol);
    if (existing) {
      const totalShares = existing.entryShares + h.entryShares;
      const totalCost   = (existing.entryShares * existing.entryPrice) + (h.entryShares * h.entryPrice);
      existing.entryShares = totalShares;
      existing.entryPrice  = totalShares > 0 ? totalCost / totalShares : 0;
      if (!existing.sector && h.sector) existing.sector = h.sector;
      if (!existing.cat && h.cat) existing.cat = h.cat;
    } else {
      merged.push({ ...h });
    }
  });
  return merged;
}

function invAutoSave() {
  if (!_invData) return;
  invMarkDirty();
  clearTimeout(_invSaveTimer);
  _invSaveTimer = setTimeout(() => {
    _invSaveTimer = null;
    if (!_invData) return;
    const data = invGetCurrentData();
    const merged = invMergeDuplicates(data.holdings);
    if (merged.length !== data.holdings.length) {
      data.holdings = merged;
      invRenderRows(merged);
    }
    invSaveData(data);
  }, 800);
}

function invAutoSector(idx) {
  const tbody = document.getElementById('inv-tbody');
  const row = tbody?.querySelector(`tr[data-idx="${idx}"]`);
  if (!row) return;
  const symEl = row.querySelector('.inv-sym-input');
  const sectorEl = row.querySelector('.inv-sector-input');
  autoFillSector('inv-' + idx, symEl, sectorEl, sector => {
    if (!row.isConnected) return;
    sectorEl.value = sector;
    const catSel = row.querySelector('.inv-cat-sel');
    if (catSel && !catSel.value) catSel.value = _sectorRiskCat(sector);
    invRecalc();
  });
}

let _invSaveTotalTimer = null;
function invAutoSaveTotal() {
  if (_invData) invMarkDirty();
  const val = document.getElementById('inv-portfolio-total')?.value || '';
  if (_invData) _invData.portfolioTotal = val;
  clearTimeout(_invSaveTotalTimer);
  _invSaveTotalTimer = setTimeout(() => {
    _invSaveTotalTimer = null;
    // The total now lives on investments.portfolio_total, per active portfolio
    // — goes through the same guarded save queue as everything else on the tab
    // rather than a separate ad hoc update.
    if (_invData) invSaveData(invGetCurrentData());
  }, 500);
}

function invUpdateDonut(byCat, portfolioTotal, cash = 0) {
  const C = 314.159;
  // Cash = real free cash share. The remainder (unrealized gains) stays unfilled.
  const pcts = invDonutPcts(byCat, portfolioTotal, cash);
  // Includes uncategorised cost — the centre label reads "invested", and money
  // in a holding with no category is still invested.
  const totalAllocated = pcts.blue + pcts.green + pcts.yellow + pcts.none;

  const order = ['blue', 'green', 'yellow', 'none', 'cash'];
  let offset = 0;
  order.forEach(key => {
    const el = document.getElementById(`donut-${key}`);
    if (!el) return;
    // Clamped to the room left on the ring. Unclamped, blue 60% + green 55%
    // pushed yellow's offset past 100% so it wrapped around and painted over
    // blue — an over-allocated portfolio drew a ring that read as under-full.
    const slice = Math.max(0, Math.min(pcts[key], 100 - offset));
    const len = slice / 100 * C;
    el.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${C}`);
    el.setAttribute('stroke-dashoffset', `${(-offset / 100 * C).toFixed(2)}`);
    offset += slice;
  });

  const lbl = document.getElementById('donut-label-pct');
  if (lbl) lbl.textContent = totalAllocated.toFixed(0) + '%';
  // (No leg-* legend elements exist in the markup; the loop that wrote them was
  // dead code and has been removed.)
}

function invAddDeposit() {
  const month    = document.getElementById('inv-dep-month')?.value;
  const amount   = +(document.getElementById('inv-dep-amount')?.value) || 0;
  if (!month || !amount) { toast('Enter month and amount', 'error'); return; }
  // Read holdings from the DOM (precise) — never from stale localStorage.
  const data = invGetCurrentData();
  if (!data.deposits) data.deposits = [];
  data.deposits.push({ month, amount });
  data.deposits.sort((a, b) => b.month.localeCompare(a.month));
  const totalElD = document.getElementById('inv-portfolio-total');
  // The third read of this field, missed when the other two were fixed. It is
  // type="text" so "100,000" is a legal entry, and `+"100,000"` is NaN — which
  // made a 2,000 deposit *replace* the total with 2,000 instead of adding to it,
  // then persisted that to user_settings.
  const newTotal = invParseTotal(totalElD?.value) + amount;
  if (totalElD) totalElD.value = newTotal;
  data.portfolioTotal = String(newTotal);
  invSaveData(data);
  invRenderDeposits(data.deposits);
  invRecalc();
  document.getElementById('inv-dep-amount').value = '';
}

function invDeleteDeposit(idx) {
  const deposits = invLoad().deposits || [];
  if (!deposits.length) return;
  if (!confirm('למחוק הפקדה זו?')) return;
  deposits.splice(idx, 1);
  // Holdings from the DOM (precise) — avoid clobbering DB with stale localStorage.
  const data = invGetCurrentData();
  data.deposits = deposits;
  invSaveData(data);
  invRenderDeposits(deposits);
  // Without this the P&L box renders "—" (invRenderDeposits was called with no
  // current value) until something else happens to recalc.
  invRecalc();
}

function invRenderDeposits(deposits = [], totalCurrentValue = 0) {
  const listEl = document.getElementById('dep-list');
  if (!listEl) return;
  const totalDeposited = deposits.reduce((s, d) => s + (+d.amount || 0), 0);

  const totalEl = document.getElementById('dep-total-val');
  const pnlEl   = document.getElementById('dep-pnl-val');

  const cur = invGetCurrency();
  if (totalEl) totalEl.textContent = cur + totalDeposited.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (pnlEl) {
    if (totalCurrentValue > 0 && totalDeposited) {
      // Deposits fund cash as well as holdings, so measuring them against the
      // value of the holdings alone booked every uninvested shekel as a loss.
      const portfolioNow = (+String(document.getElementById('inv-portfolio-total')?.value || '')
                              .replace(/[^\d.]/g, '')) || totalCurrentValue;
      const pnl    = Math.max(portfolioNow, totalCurrentValue) - totalDeposited;
      const pnlPct = (pnl / totalDeposited * 100).toFixed(1);
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + cur + Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ` (${pnl >= 0 ? '+' : ''}${pnlPct}%)`;
      pnlEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
      pnlEl.textContent = '—';
      pnlEl.style.color = '';
    }
  }

  if (!deposits.length) { listEl.innerHTML = ''; return; }
  const heMonth = m => {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  };
  let cumul = totalDeposited;
  listEl.innerHTML = `<table class="inv-dep-table"><thead><tr><th>${t('inv_dep_month')}</th><th>${t('inv_dep_amount')}</th><th>${t('inv_dep_cumulative')}</th><th></th></tr></thead><tbody>${
    deposits.map((d, i) => {
      const row = `<tr><td>${heMonth(d.month)}</td><td class="sensitive">${cur}${(+d.amount).toLocaleString('en-US',{maximumFractionDigits:0})}</td><td class="sensitive">${cur}${cumul.toLocaleString('en-US',{maximumFractionDigits:0})}</td><td><button class="inv-dep-del" onclick="invDeleteDeposit(${i})">×</button></td></tr>`;
      cumul -= +d.amount;
      return row;
    }).join('')
  }</tbody></table>`;
}

// ─────────────────────────────────────────────
