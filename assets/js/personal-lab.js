// Personal lab: automatic chart analysis and optional habit experiments.
// Market data is read through the shared cache; no broker writes.
function labDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : null;
}
function labShift(date, days) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
function labToday(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = name => parts.find(p => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function labMeasure(experiment, trades, nowDate) {
  const e = experiment;
  const seen = new Set();
  const valid = trades.filter(trade => {
    const key = trade.id == null ? trade : String(trade.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return !trade.deleted && trade.type === e.asset_scope && labDate(trade.entryDate) && trade.entryDate <= nowDate;
  });
  const measure = (start, end) => {
    const rows = valid.filter(trade => trade.entryDate >= start && trade.entryDate < end);
    const days = new Map();
    for (const row of rows) days.set(row.entryDate, (days.get(row.entryDate) || 0) + 1);
    const documented = row => e.template === 'setup_documented' ? SETUP_OPTIONS.includes(row.setupType) : !!String(row.entryReason || '').trim();
    const daily = e.template === 'daily_limit';
    const denominator = daily ? days.size : rows.length;
    const numerator = daily ? [...days.values()].filter(count => count <= e.target).length : rows.filter(documented).length;
    const realized = rows.filter(isClosed);
    return { records: rows.length, activityDays: days.size, numerator, denominator,
      adherence: denominator ? numerator / denominator * 100 : null,
      realizedRecords: realized.length, net: realized.reduce((sum, row) => sum + calcTotal(row), 0),
      missingIds: daily ? [] : rows.filter(row => !documented(row)).map(row => row.id) };
  };
  const current = measure(e.start_date, e.end_date);
  const baseline = measure(labShift(e.start_date, -30), e.start_date);
  const daysElapsed = Math.max(0, Math.min(30, Math.floor((Date.parse(nowDate) - Date.parse(e.start_date)) / 86400000)));
  return { current, baseline, daysElapsed, daysRemaining: 30 - daysElapsed, pendingStart: nowDate < e.start_date,
    smallSample: current.records < 20 || baseline.records < 20 || (e.template === 'daily_limit' && (current.activityDays < 5 || baseline.activityDays < 5)) };
}

const _lab = { user: null, generation: 0, revision: 0, pending: null, loaded: false, error: '', active: null,
  history: [], historyLoaded: false, historyLimit: 20, historyMore: false, busy: false, step: 0,
  draft: { template: 'daily_limit', asset_scope: 'stock', target: 3 }, choice: 'inconclusive', note: '', notice: '' };
const _labAuto = { sequence: 0, limit: 4, cache: new Map(), openCharts: new Set(), summaryOpen: false, tradesOpen: false };
const LAB_TEMPLATES = {
  daily_limit: { he: 'פחות עסקאות, יותר כוונה', en: 'Fewer trades, more intention',
    descHe: 'בחר תקרה יומית ובדוק בכמה ימי פעילות נשארת בתוכה.', descEn: 'Set a daily limit and track how often you stay within it.', icon: '01' },
  setup_documented: { he: 'לכל עסקה יש סטאפ', en: 'A setup for every trade',
    descHe: 'הפוך את תיעוד הסטאפ להרגל שאפשר למדוד.', descEn: 'Build a measurable habit of documenting your setup.', icon: '02' },
  reason_documented: { he: 'לדעת למה נכנסתי', en: 'Know why you entered',
    descHe: 'בדוק שלכל עסקה ביומן יש סיבת כניסה מתועדת.', descEn: 'Check that every journal trade has a documented entry reason.', icon: '03' }
};
function labText(he, en) { return _lang === 'he' ? he : en; }
function labTitle(template) { const item = LAB_TEMPLATES[template]; return item ? item[_lang === 'he' ? 'he' : 'en'] : ''; }
function labConclusion(choice) {
  const labels = { keep: ['להמשיך בכלל', 'Keep the rule'], adjust: ['לנסות שינוי', 'Try an adjustment'], inconclusive: ['ללא מסקנה', 'No conclusion'] };
  return labels[choice] ? labText(...labels[choice]) : '';
}
function labActive() { return _lab.active; }
function labPauseAutomatic() { _labAuto.sequence++; }
function labReset() {
  _labAuto.sequence++; _labAuto.limit = 4; _labAuto.cache.clear(); _labAuto.openCharts.clear(); _labAuto.summaryOpen=false; _labAuto.tradesOpen=false;
  _lab.generation++; _lab.revision++;
  Object.assign(_lab, { user: null, pending: null, loaded: false, error: '', active: null, history: [], historyLoaded: false,
    historyLimit: 20, historyMore: false, busy: false, step: 0, draft: { template: 'daily_limit', asset_scope: 'stock', target: 3 }, choice: 'inconclusive', note: '', notice: '' });
  for (const id of ['personal-lab', 'personal-lab-overview']) {
    const host = document.getElementById(id); if (host) host.replaceChildren();
  }
}
function labLoad({ force = false, history = false, more = false } = {}) {
  const user = _currentUser;
  if (!user || _legalReadyUserId !== user.id) return Promise.resolve(false);
  if (_lab.user !== user) { labReset(); _lab.user = user; }
  if (_lab.pending) return _lab.pending.then(success => {
    if (!success || _currentUser !== user || _lab.user !== user) return false;
    return history && !_lab.historyLoaded ? labLoad({ history: true }) : _lab.loaded;
  });
  if (_lab.loaded && !force && (!history || _lab.historyLoaded) && !more) return Promise.resolve(true);
  const generation = _lab.generation, revision = _lab.revision;
  const current = () => _currentUser === user && _lab.generation === generation && _lab.revision === revision;
  const columns = 'id,user_id,template,asset_scope,target,timezone,start_date,end_date,status,summary_choice,summary_note,summary_metrics,completed_at,created_at,updated_at';
  // Start after the promise is assigned, including when the SDK throws before await.
  const pending = Promise.resolve().then(async () => {
    try {
      const query = _sb.from('personal_experiments').select(columns).eq('user_id', user.id).eq('status', 'active').limit(1);
      const { data, error } = await query;
      if (!current()) return false;
      if (error) throw error;
      const active = data?.[0] || null;
      if (_lab.active?.id !== active?.id) { _lab.choice = 'inconclusive'; _lab.note = ''; }
      _lab.active = active; _lab.loaded = true; _lab.error = '';
      if (history) {
        const limit = more ? _lab.historyLimit + 20 : _lab.historyLimit;
        const result = await _sb.from('personal_experiments').select(columns).eq('user_id', user.id).neq('status', 'active')
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
        if (!current()) return false;
        if (result.error) throw result.error;
        _lab.history = (result.data || []).slice(0, limit); _lab.historyMore = (result.data || []).length > limit;
        _lab.historyLimit = limit; _lab.historyLoaded = true;
      }
      return true;
    } catch {
      if (current()) _lab.error = labText('לא ניתן לטעון את המעבדה. נסה שוב.', 'The lab could not load. Please retry.');
      return false;
    } finally {
      if (_lab.pending === pending) { _lab.pending = null; labRender(); labRenderOverview(); }
    }
  });
  _lab.pending = pending;
  return pending;
}
async function labMutate(name, params) {
  const user = _currentUser;
  if (!user || _legalReadyUserId !== user.id || _lab.busy) return false;
  if (_lab.user !== user) { labReset(); _lab.user = user; }
  const generation = _lab.generation;
  _lab.revision++; _lab.pending = null; _lab.busy = true; _lab.error = ''; _lab.notice = '';
  labRender();
  try {
    const { data, error } = await _sb.rpc(name, params);
    if (_currentUser !== user || generation !== _lab.generation) return false;
    if (error) {
      if (error.code === 'PT409') {
        _lab.loaded = false; _lab.historyLoaded = false;
        _lab.notice = labText('הניסוי השתנה במכשיר אחר. הנתונים נטענו מחדש; בדוק אותם לפני פעולה נוספת.', 'This experiment changed on another device. Review the reloaded data before trying again.');
        await labLoad({ force: true, history: true });
      }
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id || row.user_id !== user.id) throw new Error('Invalid experiment receipt');
    if (_lab.active?.id !== row.id || row.status !== 'active') _lab.choice = 'inconclusive';
    _lab.active = row.status === 'active' ? row : null;
    if (row.status !== 'active') _lab.history = [row, ..._lab.history.filter(item => item.id !== row.id)];
    _lab.loaded = true; _lab.historyLoaded = false; _lab.step = 0; _lab.note = '';
    _lab.notice = labText('נשמר בחשבון שלך', 'Saved to your account');
    return true;
  } catch {
    if (_currentUser === user && generation === _lab.generation) _lab.error = labText('הפעולה לא אושרה. הקלט נשמר — אפשר לנסות שוב.', 'The operation was not confirmed. Your input is preserved; you can retry.');
    return false;
  } finally {
    if (_currentUser === user && generation === _lab.generation) {
      _lab.revision++; _lab.busy = false; labRender(); labRenderOverview();
    }
  }
}
function labStart(config) {
  return labMutate('start_personal_experiment', { p_template: config.template, p_asset_scope: config.asset_scope,
    p_target: config.template === 'daily_limit' ? Number(config.target) : 100, p_timezone: config.timezone });
}
function labFinish(id, updatedAt, choice, note) {
  return labMutate('finish_personal_experiment', { p_id: id, p_expected_updated_at: updatedAt, p_choice: choice, p_note: note });
}
function labCancel(id, updatedAt) {
  return labMutate('cancel_personal_experiment', { p_id: id, p_expected_updated_at: updatedAt });
}
function labInvalidate() {
  _lab.revision++; _lab.pending = null; _lab.loaded = false; _lab.historyLoaded = false;
  const visible = typeof document.hidden !== 'undefined' && !document.hidden;
  if (visible && (document.querySelector('#tab-overview.active') || (document.querySelector('#tab-statistics.active') && document.getElementById('personal-lab-disclosure')?.open))) {
    labLoad({ force: true, history: !!document.querySelector('#tab-statistics.active') });
  }
}
function labTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'; } catch { return 'Asia/Jerusalem'; }
}
function labPercent(value) { return value == null ? '—' : new Intl.NumberFormat(_lang === 'he' ? 'he-IL' : 'en-US', { maximumFractionDigits: 0 }).format(value) + '%'; }
function labMoney(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value); }
function labRange(e) { return `${e.start_date} — ${labShift(e.end_date, -1)}`; }
function labButton(action, label, primary = false) {
  return `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" data-lab-action="${action}"${_lab.busy ? ' disabled' : ''}>${label}</button>`;
}
function labMetricsHTML(metrics, experiment, compact = false) {
  const c = metrics.current, b = metrics.baseline;
  const daily = experiment.template === 'daily_limit';
  const denominator = daily ? labText('ימי פעילות', 'active days') : labText('עסקאות', 'records');
  const metricLabel = daily ? labText('עמידה בכלל', 'Adherence') : labText('שלמות התיעוד', 'Documentation completeness');
  const primary = '<div class="lab-metric"><span>' + metricLabel + '</span><strong>' + labPercent(c.adherence) + '</strong><small><bdi dir="ltr">' + c.numerator + ' / ' + c.denominator + '</bdi> ' + denominator + '</small></div>';
  const secondary = '<div class="lab-metric"><span>' + labText('בתקופת ההשוואה', 'Previous 30 days') + '</span><strong>' + labPercent(b.adherence) + '</strong><small><bdi dir="ltr">' + b.numerator + ' / ' + b.denominator + '</bdi> ' + denominator + '</small></div>' +
    '<div class="lab-metric"><span>' + labText('תוצאה ממומשת נטו', 'Net realized result') + '</span><strong class="sensitive" dir="ltr">' + labMoney(c.net) + '</strong><small>' + c.realizedRecords + ' ' + labText('רשומות עם מימוש', 'records with realized results') + '</small></div>';
  const note = '<p class="lab-footnote">' + labText('השוואת נטו לתקופה הקודמת:', 'Previous period net:') + ' <span class="sensitive" dir="ltr">' + labMoney(b.net) + '</span> · ' + b.realizedRecords + ' ' + labText('רשומות עם מימוש', 'realized records') + '</p>' +
    '<p class="lab-footnote">' + labText('ההשוואה תיאורית ואינה מוכיחה שהכלל גרם לשינוי. סגירה חלקית נכללת בתוצאה הממומשת.', 'This descriptive comparison cannot show that the rule caused a change. Partial exits count toward realized results.') + '</p>';
  const empty = c.records === 0 ? '<p class="lab-footnote" role="status">' + labText('אין עדיין עסקאות למדידה בתקופה זו. המדדים יתעדכנו לאחר רישום או ייבוא עסקאות.', 'There are no trade records to measure in this period. Metrics update after recording or importing trades.') + '</p>' : '';
  const warning = metrics.smallSample ? '<p class="lab-footnote">' + labText('מדגם קטן: הנתונים עדיין ראשוניים.', 'Small sample: these results are preliminary.') + '</p>' : '';
  const missing = c.missingIds?.length || 0;
  const nextAction = missing && metrics.daysRemaining > 0 ? '<div class="lab-next-action"><div><strong>' + labText('מה נשאר להשלים?', 'What needs attention?') + '</strong><p>' + missing + ' ' + labText('עסקאות מחכות להשלמת תיעוד.', 'records need documentation.') + '</p></div>' + labButton('review-missing', labText('השלם תיעוד', 'Complete documentation'), true) + '</div>' : '';
  if (!compact) return empty + '<div class="lab-metrics">' + primary + secondary + '</div>' + warning + note;
  return empty + '<div class="lab-metrics lab-metrics-primary">' + primary + '</div>' + warning + nextAction +
    '<details class="lab-analysis" data-lab-section="analysis-' + esc(experiment.id || '') + '"><summary>' + labText('השוואה ותוצאות', 'Comparison and results') + '</summary><div class="lab-metrics lab-metrics-secondary">' + secondary + '</div>' + note + '</details>';
}

function labRenderOverview() {
  const host = document.getElementById('personal-lab-overview');
  if (!host) return;
  if (!_currentUser || _legalReadyUserId !== _currentUser.id || _lab.user !== _currentUser) { host.replaceChildren(); return; }
  host.className = 'lab-overview';
  if (_lab.error) {
    host.innerHTML = `<span role="status">${_lab.error}</span>${labButton('reload', labText('נסה שוב', 'Retry'))}`;
  } else if (!_lab.loaded) {
    host.innerHTML = `<span role="status">${labText('טוען את המעבדה…', 'Loading your lab…')}</span>`;
  } else {
    const e = _lab.active;
    if (!e) {
      let dismissed = false;
      try { dismissed = localStorage.getItem('lab-invite-' + _currentUser.id) === '1'; } catch {}
      if (dismissed) { host.replaceChildren(); host.className = ''; return; }
      host.innerHTML = `<div><span class="lab-eyebrow">${labText('המעבדה האישית', 'Personal lab')}</span><strong>${labText('שינוי קטן. תהליך שאפשר למדוד.', 'One small change. A process you can measure.')}</strong></div><div class="lab-actions">${labButton('open', labText('בחר ניסוי ראשון', 'Choose your first experiment'), true)}${labButton('dismiss', labText('הסתר', 'Dismiss'))}</div>`;
    } else {
      const today = labToday(e.timezone);
      const measure = labMeasure(e, [], today);
      host.innerHTML = `<div><span class="lab-eyebrow">${labText('הניסוי שלך', 'Your experiment')}</span><strong>${labTitle(e.template)}</strong><small>${measure.pendingStart ? labText('מתחיל ב־', 'Starts ') + e.start_date : today >= e.end_date ? labText('מוכן לסיכום', 'Ready to review') : measure.daysRemaining + ' ' + labText('ימים נותרו', 'days remaining')}</small></div><div class="lab-overview-progress"><progress max="30" value="${measure.daysElapsed}" aria-label="${labText('ימים בניסוי', 'Experiment days')}"></progress></div>${labButton('open', labText('לניסוי שלי', 'View experiment'), true)}`;
    }
  }
  labBind(host);
}
function labRender() {
  const host = document.getElementById('personal-lab');
  if (!host) return;
  const reviewDetails=host.querySelector('#lab-review-summary > details.lab-recurring-observations');
  if(reviewDetails)_labAuto.summaryOpen=reviewDetails.open;
  const tradeList=host.querySelector('#lab-trades-disclosure');
  if(tradeList)_labAuto.tradesOpen=tradeList.open;
  host.querySelectorAll('.lab-auto-chart[data-chart-key]').forEach(el=>{
    if(el.open)_labAuto.openCharts.add(el.dataset.chartKey);else _labAuto.openCharts.delete(el.dataset.chartKey);
  });
  const opened = new Set([...host.querySelectorAll('details[data-lab-section][open]')].map(el => el.dataset.labSection));
  const focused = host.contains(document.activeElement) ? document.activeElement : null;
  const focusId = focused?.id;
  const selection = focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
  if (!_currentUser || _legalReadyUserId !== _currentUser.id || _lab.user !== _currentUser) { host.replaceChildren(); return; }
  const header = `<div class="lab-header"><div><h2 id="personal-lab-title" tabindex="-1">${labText('המעבדה האישית', 'Your personal lab')}</h2></div></div>`;
  let body = '';
  if (_lab.error) body += `<p class="lab-warning" role="alert">${_lab.error}</p>${labButton('reload', labText('רענן נתונים', 'Reload data'))}`;
  if (_lab.notice) body += `<p class="lab-footnote" role="status">${_lab.notice}</p>`;
  if (!_lab.loaded && !_lab.error) body += `<p role="status">${labText('טוען ניסויים…', 'Loading experiments…')}</p>`;
  else if (_lab.loaded && _lab.active) body += labActiveHTML(_lab.active);
  else if (_lab.loaded) body += labCreateHTML();
  if (_lab.history.length) body += `<details class="lab-history" data-lab-section="history"><summary>${labText('ניסויים קודמים', 'Previous experiments')} (${_lab.history.length})</summary>${_lab.history.map(e => `<article class="lab-history-item"><div class="lab-history-heading"><h3>${labTitle(e.template)}</h3><span>${e.status === 'completed' ? labText('הושלם', 'Completed') : labText('בוטל', 'Cancelled')}</span></div><p class="lab-footnote"><bdi dir="ltr">${esc(labRange(e))}</bdi> · ${e.asset_scope === 'stock' ? labText('מניות', 'Stocks') : labText('קריפטו', 'Crypto')}</p>${e.template === 'daily_limit' ? `<p class="lab-footnote">${labText('הכלל שנבדק: עד ', 'Rule tested: up to ')}${Number(e.target)} ${labText('רשומות ביום', 'records per day')}</p>` : ''}${e.summary_choice ? `<p class="lab-conclusion">${labText('המסקנה שלך: ', 'Your conclusion: ')}<strong>${labConclusion(e.summary_choice)}</strong></p>` : ''}${e.summary_metrics ? labMetricsHTML(e.summary_metrics, e) : ''}${e.summary_note ? `<p>${esc(e.summary_note)}</p>` : ''}${e.summary_metrics ? `<p class="lab-footnote">${labText('צילום נתונים קבוע נכון ל־', 'Snapshot saved at ')}${esc(e.summary_metrics.computed_at || e.completed_at)}. ${labText('עריכות וייבוא מאוחר אינם משנים סיכום זה.', 'Edits and late imports do not change this summary.')}</p>` : ''}</article>`).join('')}${_lab.historyMore ? labButton('more', labText('טען עוד', 'Load more')) : ''}</details>`;
  const automatic = '<section id="lab-auto-analysis" aria-labelledby="lab-auto-title"><h3 id="lab-auto-title" hidden>' + labText('הסטאפ שלך — בדיקה אוטומטית', 'Your setup — automatic review') + '</h3><div id="lab-auto-results" class="lab-auto-results"></div></section>';
  host.className = 'lab-panel'; host.innerHTML = header + automatic + '<details class="lab-experiments" data-lab-section="experiments"><summary>' + labText('ניסוי הרגלים · אופציונלי', 'Habit experiment · optional') + '</summary>' + body + '</details>';
  host.setAttribute('aria-busy', String(_lab.busy));
  host.querySelectorAll('details[data-lab-section]').forEach(el => { el.open = opened.has(el.dataset.labSection); });
  labBind(host);
  void labRenderAutomatic();
  const replacement = focusId ? document.getElementById(focusId) : null;
  if (replacement) {
    replacement.focus({ preventScroll: true });
    if (selection && typeof replacement.setSelectionRange === 'function') replacement.setSelectionRange(...selection);
  }
}
async function labRenderAutomatic() {
  const host = document.getElementById('lab-auto-results');
  const user = _currentUser, sourceDB = db, generation = _lab.generation;
  const sequence = ++_labAuto.sequence;
  const current = () => host?.isConnected && _currentUser === user && _lab.user === user && _legalReadyUserId === user?.id && db === sourceDB && _lab.generation === generation && _labAuto.sequence === sequence && document.getElementById('tab-statistics')?.classList.contains('active') && document.getElementById('personal-lab-disclosure')?.open && !document.hidden;
  if (!host || !current()) return;
  if (!_dbLoaded) { host.textContent = labText('ממתין לטעינת העסקאות…', 'Waiting for journal data…'); return; }
  const trades = [...sourceDB.stocks, ...sourceDB.crypto].filter(tradeSnapshotEligible)
    .sort((a,b) => String(b.closeDate).localeCompare(String(a.closeDate)) || String(b.id).localeCompare(String(a.id)));
  if (!trades.length) { host.textContent = labText('לאחר סגירת עסקה, הניתוח שלה יופיע כאן אוטומטית.', 'Once a trade closes, its analysis will appear here automatically.'); return; }
  const visible = trades.slice(0, _labAuto.limit);
  const conclusion=document.createElement('div');conclusion.className='lab-review-summary lab-auto-count';conclusion.id='lab-review-summary';
  conclusion.textContent=labText('מנתח ','Analyzing ')+visible.length+labText(' מתוך ',' of ')+trades.length+labText(' עסקאות סגורות · החדשות תחילה…',' closed trades · newest first…');conclusion.setAttribute('role','status');host.append(conclusion);
  const tradeList=document.createElement('details');tradeList.id='lab-trades-disclosure';tradeList.className='lab-trades-disclosure';tradeList.open=_labAuto.tradesOpen;
  const tradeToggle=document.createElement('summary');tradeToggle.textContent=labText('בדיקת העסקאות','Review trades')+' ('+visible.length+')';
  const tradeRows=document.createElement('div');tradeRows.className='lab-trade-rows';
  tradeList.append(tradeToggle,tradeRows);host.append(tradeList);
  tradeList.addEventListener('toggle',()=>{if(current())_labAuto.tradesOpen=tradeList.open;});
  const reviewed=[];
  const jobs = visible.map(trade => {
    const snapshot = {...trade,t:(trade.t || []).map(target=>({...target}))};
    const fingerprint = tradeSnapshotFingerprint(snapshot);
    const valid = () => current() && [...sourceDB.stocks,...sourceDB.crypto].some(row=>row.type===snapshot.type && String(row.id)===String(snapshot.id) && !row.deleted && tradeSnapshotFingerprint(row)===fingerprint);
    const card = document.createElement('article'); card.className = 'lab-auto-trade';card.dataset.labTradeKey=snapshot.type+':'+snapshot.id;
    const title = document.createElement('h4'); title.className = 'sensitive';title.tabIndex=-1;title.textContent = snapshot.symbol + ' · ' + snapshot.entryDate;
    const recorded = document.createElement('p');recorded.className='lab-footnote sensitive';recorded.textContent = labText('הסטאפ שתיעדת: ', 'Recorded setup: ') + (SETUP_LABELS[snapshot.setupType] || labText('לא תועד — הבדיקה פועלת גם בלעדיו', 'Not recorded — analysis still runs'));
    const content = document.createElement('div');content.textContent=labText('מנתח את נתוני הגרף…', 'Analyzing chart data…');content.setAttribute('role','status');
    card.append(title,content);tradeRows.append(card);
    return {snapshot,fingerprint,valid,content,recorded};
  });
  if (visible.length < trades.length) {
    const more=document.createElement('button');more.type='button';more.className='btn btn-secondary lab-auto-more';more.textContent=labText('הצג עוד עסקאות', 'Show more trades');
    more.onclick=()=>{if(!current())return;const previous=visible.length;_labAuto.limit+=4;labRender();document.querySelectorAll('#lab-auto-analysis .lab-auto-trade h4')[previous]?.focus();};tradeRows.append(more);
  }
  let cursor=0;
  const worker = async () => {
    while (cursor < jobs.length && current()) {
      const {snapshot,fingerprint,valid,content,recorded}=jobs[cursor++];
      try {
        await loadTradeSnapshotFeature();if(!valid())continue;
        let data=_labAuto.cache.get(fingerprint);
        if (!data || data.expiresAt<=Date.now()) {
          const symbol=snapshot.type==='crypto' ? _cryptoBaseSymbol(snapshot.symbol.replace(/-USD$/i,'')).toUpperCase()+'-USD' : snapshot.symbol;
          const raw=await _fetchPivotBars(symbol);if(!valid())continue;
          const bars=Array.isArray(raw) ? raw.map(row=>row && ({...row})) : null;
          if(!valid())continue;
          data={bars,image:null,expiresAt:Date.now()+5*60*1000};
          if(_labAuto.cache.size>=100)_labAuto.cache.delete(_labAuto.cache.keys().next().value);
          _labAuto.cache.set(fingerprint,data);
        }
        if(!valid())continue;
        reviewed.push({trade:snapshot,result:tradeSetupSuggestion(snapshot,data.bars)});
        content.replaceChildren();content.removeAttribute('role');
        renderTradeSetupSuggestion(content,snapshot,data.bars,valid,{compact:true});
        content.querySelector('.lab-auto-explanation')?.append(recorded);
        if(data.bars?.length) labAppendChart(content,snapshot,data,valid);
        if(!data.bars?.length){
          const retry=document.createElement('button');retry.type='button';retry.className='btn btn-secondary';retry.textContent=labText('נסה לטעון שוב את נתוני הגרף', 'Retry chart data');
          retry.onclick=()=>{if(!valid())return;_labAuto.cache.delete(fingerprint);labRender();};content.append(retry);
        }
        applyPrivacy();
      } catch {
        if(!valid())continue;
        if(!reviewed.some(row=>row.trade.type===snapshot.type && String(row.trade.id)===String(snapshot.id)))reviewed.push({trade:snapshot,result:{status:'unknown',reason:'load'}});
        content.textContent=labText('הניתוח לא נטען. נתוני העסקה לא שונו.', 'Analysis could not load. Trade data is unchanged.');
        const retry=document.createElement('button');retry.type='button';retry.className='btn btn-secondary';retry.textContent=labText('נסה שוב','Retry');retry.onclick=()=>{if(valid())labRender();};content.append(retry);
      }
    }
  };
  await Promise.all([worker(),worker()]);
  if(current()){
    conclusion.removeAttribute('role');conclusion.innerHTML=labReviewSummaryHTML(labReviewSummary(reviewed,trades.length),_labAuto.summaryOpen)+labPersonalComparisonHTML(labPersonalComparison(reviewed));
    const details=conclusion.querySelector('details.lab-recurring-observations');
    details?.addEventListener('toggle',()=>{if(current())_labAuto.summaryOpen=details.open;});
    conclusion.querySelectorAll('[data-lab-example]').forEach(button=>button.addEventListener('click',()=>{
      if(!current())return;
      tradeList.open=true;_labAuto.tradesOpen=true;
      [...host.querySelectorAll('[data-lab-trade-key]')].find(card=>card.dataset.labTradeKey===button.dataset.labExample)?.querySelector('h4')?.focus();
    }));
  }
}
function labPersonalComparison(rows) {
  const unique=new Map();
  for(const row of rows){
    const t=row?.trade,r=row?.result;
    if(!t || t.id==null || t.deleted || !['stock','crypto'].includes(t.type) || t.ls==='S' || !SETUP_OPTIONS.includes(t.setupType) || !Number.isFinite(Number(t.entryPrice)) || !(Number(t.entryPrice)>0) || !Number.isFinite(Number(t.exitPrice)) || !(Number(t.exitPrice)>0) || !(Number(t.shares)>0))continue;
    if(!Number.isFinite(r?.distancePct) || !(r.status==='possible' || (r.status==='unmatched' && ['distance','shape'].includes(r.reason))))continue;
    unique.set(t.type+':'+t.id,row);
  }
  const groups=new Map();
  for(const {trade,result} of unique.values()){
    const net=calcTotal(trade);
    if(!Number.isFinite(net) || net===0)continue;
    const key=trade.type+':'+trade.setupType;
    if(!groups.has(key))groups.set(key,{type:trade.type,setup:trade.setupType,winning:[],losing:[],examples:[]});
    groups.get(key)[net>0?'winning':'losing'].push(result.distancePct);
    groups.get(key).examples.push({id:String(trade.id),symbol:String(trade.symbol||''),entryDate:String(trade.entryDate||''),won:net>0});
  }
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
  return [...groups.values()].filter(g=>g.winning.length>=5 && g.losing.length>=5).map(g=>({type:g.type,setup:g.setup,wins:g.winning.length,losses:g.losing.length,winMedian:median(g.winning),lossMedian:median(g.losing),examples:[g.examples.find(e=>e.won),g.examples.find(e=>!e.won)]}));
}
function labPersonalComparisonHTML(groups) {
  let html='<details class="lab-personal-comparison"><summary>'+labText('השוואה לעסקאות המרוויחות שלך','Compare with your winning trades')+'</summary>';
  if(!groups.length)return html+'<p class="lab-footnote">'+labText('עדיין חסרות עסקאות להשוואה: נדרשות 5 מרוויחות ו־5 מפסידות עם נתונים מתאימים, באותו סטאפ וסוג נכס.','More comparable trades needed: 5 winners and 5 losers with suitable data, in the same setup and asset type.')+'</p></details>';
  for(const g of groups){
    const label=(typeof SETUP_LABELS!=='undefined'?SETUP_LABELS[g.setup]:g.setup)||g.setup;
    html+='<p><strong>'+esc(label)+' · '+(g.type==='stock'?labText('מניות','Stocks'):labText('קריפטו','Crypto'))+'</strong></p><p class="sensitive">'+labText('מרחק חציוני משיא 20 הנרות שלפני הכניסה: ','Median distance from the prior 20-bar high: ')+g.winMedian.toFixed(1)+'% '+labText('ב־','in ')+g.wins+labText(' עסקאות מרוויחות, לעומת ',' winning trades, versus ')+g.lossMedian.toFixed(1)+'% '+labText('ב־','in ')+g.losses+labText(' עסקאות מפסידות.',' losing trades.')+'</p>';
    html+='<div class="lab-actions">'+g.examples.map(e=>'<button type="button" class="btn btn-secondary btn-sm sensitive" data-lab-example="'+esc(g.type+':'+e.id)+'">'+esc(e.symbol+' · '+e.entryDate+' · '+(e.won?labText('מרוויחה','Winner'):labText('מפסידה','Loser')))+'</button>').join('')+'</div>';
  }
  return html+'<p class="lab-footnote">'+labText('זהו הבדל במדגם שנבדק, ואינו הוכחה לטעות או לסיבת ההפסד. השיא המחושב אינו נקודת פריצה מאומתת; רווח אינו אישור שהעסקה עמדה בכללים. אחוז שלילי מציין כניסה מתחת לשיא. עסקאות מאוזנות וללא נתונים מתאימים לא נכללו.','This is a difference in the reviewed sample, not proof of a mistake or the cause of a loss. The calculated high is not a verified pivot; profit does not establish rule compliance. Negative values mean entry below the high. Breakeven and non-comparable trades were excluded.')+'</p></details>';
}
function labReviewSummary(rows, total) {
  const unique=new Map();
  for(const row of rows){
    const trade=row?.trade;
    if(!trade || trade.id==null || trade.deleted || !['stock','crypto'].includes(trade.type))continue;
    unique.set(trade.type+':'+trade.id,row);
  }
  const reviewed=[...unique.values()];
  const known=reviewed.filter(row=>['possible','unmatched'].includes(row.result?.status));
  const observations=new Map();
  for(const row of known){
    const t=row.trade,r=row.result;
    if(!Number.isFinite(r.distancePct) || !(r.status==='possible' || ['distance','shape'].includes(r.reason)))continue;
    // A pullback/reversal is not intended to break a prior high. Missing setup
    // stays a separate unknown cohort; never infer its intent from the outcome.
    if(t.setupType && !['vcp','breakout'].includes(t.setupType))continue;
    const symbol=String(t.symbol||'').trim().toUpperCase();
    const key=t.type+':'+(symbol && labDate(t.entryDate)?symbol+':'+t.entryDate:String(t.id));
    // Repeated imports/fills on the same entry day are not independent examples.
    if(!observations.has(key))observations.set(key,row);
    else {
      const previous=observations.get(key);
      if(previous && ((previous.trade.setupType||'unknown')!==(t.setupType||'unknown') || previous.result.distancePct!==r.distancePct))observations.set(key,null);
    }
  }
  const distance=[...observations.values()].filter(Boolean),groups=new Map();
  for(const row of distance){
    const key=row.trade.type+':'+(row.trade.setupType||'unknown');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const patterns=[];
  for(const group of groups.values())for(const key of ['above','below']){
    const examples=group.filter(row=>key==='above'?row.result.distancePct>3:row.result.distancePct<0).sort((a,b)=>String(b.trade.entryDate||'').localeCompare(String(a.trade.entryDate||'')) || String(a.trade.id).localeCompare(String(b.trade.id)));
    if(examples.length>=2)patterns.push({key,count:examples.length,comparableCount:group.length,assetType:group[0].trade.type,setupKey:group[0].trade.setupType||'unknown',examples:examples.map(row=>({id:String(row.trade.id),type:row.trade.type,symbol:row.trade.symbol || '',entryDate:row.trade.entryDate || ''}))});
  }
  const available=Number.isInteger(total)&&total>=reviewed.length?total:reviewed.length;
  return {reviewed:reviewed.length,total:available,unknown:reviewed.length-known.length,distanceChecked:distance.length,partial:reviewed.length<available,patterns};
}
function labPatternScope(pattern) {
  if(!pattern.assetType)return '';
  const asset=pattern.assetType==='stock'?labText('מניות','Stocks'):labText('קריפטו','Crypto');
  const setup=pattern.setupKey==='unknown'?labText('סטאפ לא מתועד','Setup not recorded'):(typeof SETUP_LABELS!=='undefined'?SETUP_LABELS[pattern.setupKey]:pattern.setupKey)||pattern.setupKey;
  return asset+' · '+setup;
}
function labPrimaryFindingHTML(report) {
  const pattern=[...report.patterns].filter(p=>p.count>=2).sort((a,b)=>b.count-a.count || a.key.localeCompare(b.key) || String(a.assetType||'').localeCompare(String(b.assetType||'')) || String(a.setupKey||'').localeCompare(String(b.setupKey||'')))[0];
  let html='<section class="lab-primary-finding" aria-labelledby="lab-primary-title"><h3 id="lab-primary-title">'+labText('לפני העסקה הבאה','Before your next trade')+'</h3>';
  if(!pattern)return html+'<p>'+labText('אין כרגע מספיק דוגמאות כדי לבחור דפוס חוזר. פתח את בדיקת העסקאות והרחב את המדגם.','There are not enough repeated examples to choose a pattern. Open the trade review and expand the sample.')+'</p><small>'+labText('אין בכך אישור שלא היו טעויות.','This does not establish that there were no mistakes.')+'</small></section>';
  const finding=pattern.key==='above'
    ? labText('הכניסה הייתה יותר מ־3% מעל שיא 20 הנרות הקודמים.','Entry was more than 3% above the prior 20-bar high.')
    : labText('הכניסה הייתה מתחת לשיא 20 הנרות הקודמים.','Entry was below the prior 20-bar high.');
  const check=pattern.key==='above'
    ? labText('השווה את מחיר הכניסה לנקודת הפריצה שתכננת ולמרחק המרבי שהגדרת.','Compare your entry price with your planned pivot and the maximum distance you defined.')
    : labText('בדוק אם הכניסה הייתה מעל נקודת הפריצה שתכננת, או שזו הייתה כניסה מוקדמת מכוונת.','Check whether entry was above your planned pivot or was an intentional early entry.');
  const cohort=labPatternScope(pattern);
  if(cohort)html+='<small>'+esc(cohort)+'</small>';
  html+='<p class="sensitive"><strong>'+pattern.count+labText(' מתוך ',' of ')+(pattern.comparableCount??report.distanceChecked)+labText(' עסקאות עם נתונים מתאימים במדגם: ',' comparable trades in this sample: ')+finding+'</strong></p><p>'+check+'</p>';
  html+='<small>'+labText('חשד לבדיקה, לא טעות מאומתת. השיא המחושב אינו בהכרח נקודת הפריצה שלך.','A review candidate, not a verified mistake. The calculated high is not necessarily your pivot.')+'</small>';
  html+='<div class="lab-actions">'+pattern.examples.slice(0,2).map(e=>'<button type="button" class="btn btn-secondary btn-sm sensitive" data-lab-example="'+esc(e.type+':'+e.id)+'">'+labText('בדוק דוגמה: ','Review example: ')+esc(e.symbol+' · '+e.entryDate)+'</button>').join('')+'</div>';
  return html+'</section>';
}
function labReviewSummaryHTML(report, expanded = false) {
  let html='<p class="lab-footnote">'+labText('נבדקו ','Reviewed ')+report.reviewed+labText(' מתוך ',' of ')+report.total+labText(' עסקאות סגורות. ',' closed trades. ')+report.unknown+labText(' ללא מספיק מידע לקביעה.',' without enough evidence.')+'</p>';
  if(report.partial)html+='<p class="lab-footnote">'+labText('זהו סיכום חלקי. הצג עוד עסקאות כדי להרחיב את הבדיקה.','This is a partial review. Show more trades to expand coverage.')+'</p>';
  html=labPrimaryFindingHTML(report)+html;
  if(!report.patterns.length)return html;
  html+='<details class="lab-recurring-observations"'+(expanded?' open':'')+'><summary>'+labText('מה חוזר בעסקאות שנבדקו?','What repeats in reviewed trades?')+' ('+report.patterns.length+')</summary><p class="lab-footnote">'+labText('תצפית חוזרת אינה הוכחה לטעות. הסף של 3% הוא סף הבדיקה, ולא כלל אישי שהגדרת. בדוק את הדוגמאות מול תוכנית הכניסה שלך.','A repeated observation is not proof of a mistake. The 3% threshold belongs to this check, not a personal rule you defined. Compare the examples with your entry plan.')+'</p>';
  for(const pattern of report.patterns){
    html+='<small class="lab-footnote">'+esc(labPatternScope(pattern))+'</small>';
    html+='<p><strong>'+pattern.count+labText(' מתוך ',' of ')+(pattern.comparableCount??report.distanceChecked)+labText(' עסקאות עם נתוני מרחק מתאימים — ',' trades with comparable distance data — ')+(pattern.key==='above'?labText('כניסה יותר מ־3% מעל שיא 20 הנרות הקודמים','Entry more than 3% above the prior 20-bar high'):labText('כניסה מתחת לשיא 20 הנרות הקודמים','Entry below the prior 20-bar high'))+'</strong></p><div class="lab-actions">';
    html+=pattern.examples.slice(0,3).map(example=>'<button type="button" class="btn btn-secondary btn-sm sensitive" data-lab-example="'+esc(example.type+':'+example.id)+'">'+esc(example.symbol+' · '+example.entryDate)+'</button>').join('')+'</div>';
  }
  return html+'</details>';
}
function labAppendChart(content, trade, data, valid) {
  const key=trade.type+'-'+trade.id;
  const chart=document.createElement('details');chart.className='lab-auto-chart';chart.dataset.chartKey=key;
  const summary=document.createElement('summary');summary.textContent=labText('צפה בגרף הכניסה והיציאה','View entry and exit chart');
  const body=document.createElement('div');chart.append(summary,body);content.append(chart);
  let busy=false;
  const draw=async()=>{
    if(!valid() || !chart.open || busy || body.querySelector('img'))return;
    busy=true;body.textContent=labText('טוען גרף…','Loading chart…');body.setAttribute('role','status');
    try {
      if(!data.image){
        if(!data.imagePending)data.imagePending=tradeSnapshotImage(trade,data.bars);
        data.image=await data.imagePending;
      }
      if(!valid() || !chart.open)return;
      if(!data.image)throw new Error('Chart unavailable');
      body.replaceChildren();body.removeAttribute('role');
      const button=document.createElement('button');button.type='button';button.className='ss-auto-chart-button sensitive';button.setAttribute('aria-label',labText('הגדל גרף — ','Enlarge chart — ')+trade.symbol);
      const image=document.createElement('img');image.src=data.image;image.alt=labText('גרף עסקה עם כניסה ויציאה — ','Entry and exit chart — ')+trade.symbol;
      button.append(image);button.onclick=()=>{if(valid())openLightbox(data.image);};body.append(button);
    } catch {
      if(!valid() || !chart.open)return;
      body.textContent=labText('הגרף אינו זמין כרגע. תוצאת הניתוח נשארת מוצגת.','Chart unavailable. The analysis remains visible.');
      const retry=document.createElement('button');retry.type='button';retry.className='btn btn-secondary';retry.textContent=labText('נסה שוב','Retry');retry.onclick=()=>void draw();body.append(retry);
    } finally {busy=false;data.imagePending=null;}
  };
  chart.addEventListener('toggle',()=>{
    if(!valid())return;
    if(chart.open){_labAuto.openCharts.add(key);void draw();}else _labAuto.openCharts.delete(key);
  });
  chart.open=_labAuto.openCharts.has(key);
  if(chart.open)void draw();
}
function labCreateHTML() {
  if (!_lab.step) return '<div class="lab-templates">' + Object.entries(LAB_TEMPLATES).map(([id, item]) =>
    '<button type="button" class="lab-template" data-lab-template="' + id + '"><span class="lab-template-copy"><span class="lab-template-title">' + labTitle(id) + '</span><span class="lab-template-description">' + item[_lang === 'he' ? 'descHe' : 'descEn'] + '</span></span><span class="lab-template-link">' + labText('בחירה ←', 'Choose →') + '</span></button>'
  ).join('') + '</div><p class="lab-footnote">' + labText('בוחרים הרגל אחד ל־30 ימים. אין צורך לסחור יותר כדי להשלים ניסוי.', 'Choose one habit for 30 days. You do not need to trade more to complete an experiment.') + '</p>';
  const d = _lab.draft;
  if (_lab.step === 1) return `<div class="lab-form"><span class="lab-eyebrow">${labText('שלב 1 מתוך 2 · הגדרה', 'Step 1 of 2 · Configure')}</span><h3>${labTitle(d.template)}</h3><label for="lab-scope">${labText('באיזה יומן מתמקדים?', 'Which journal?')}</label><select id="lab-scope"><option value="stock"${d.asset_scope === 'stock' ? ' selected' : ''}>${labText('מניות', 'Stocks')}</option><option value="crypto"${d.asset_scope === 'crypto' ? ' selected' : ''}>${labText('קריפטו', 'Crypto')}</option></select>${d.template === 'daily_limit' ? `<label for="lab-target">${labText('מקסימום רשומות עסקאות ביום (1–10)', 'Maximum trade records per day (1–10)')}</label><input id="lab-target" type="number" min="1" max="10" step="1" value="${Number(d.target)}">` : `<p class="lab-footnote">${labText('היעד: תיעוד מלא ב־100% מהעסקאות. נמדדת שלמות התיעוד הנוכחי, ולא מתי הוא נכתב.', 'Target: complete documentation for 100% of records. This measures current completeness, not when documentation was written.')}</p>`}<div class="lab-actions">${labButton('review', labText('המשך לסקירה', 'Review'), true)}${labButton('back', labText('חזרה', 'Back'))}</div></div>`;
  const start = labShift(labToday(labTimezone()), 1);
  return `<div class="lab-form"><span class="lab-eyebrow">${labText('שלב 2 מתוך 2 · לפני שמתחילים', 'Step 2 of 2 · Before you start')}</span><h3>${labTitle(d.template)}</h3><dl class="lab-review"><div><dt>${labText('יומן', 'Journal')}</dt><dd>${d.asset_scope === 'stock' ? labText('מניות', 'Stocks') : labText('קריפטו', 'Crypto')}</dd></div><div><dt>${labText('היעד', 'Target')}</dt><dd>${d.template === 'daily_limit' ? d.target + ' ' + labText('רשומות ביום לכל היותר', 'records per day maximum') : '100% ' + labText('תיעוד', 'documented')}</dd></div><div><dt>${labText('תאריכים', 'Dates')}</dt><dd dir="ltr">${start} — ${labShift(start, 29)}</dd></div><div><dt>${labText('אזור זמן', 'Time zone')}</dt><dd>${esc(labTimezone())}</dd></div></dl><p class="lab-footnote">${labText('הניסוי מתחיל מחר. ההגדרות נשארות קבועות; אפשר לבטל. הוא אינו חוסם עסקאות או שולח פקודות לברוקר.', 'Your experiment starts tomorrow. Settings remain fixed; cancellation is available. It does not block trades or send broker orders.')}</p><div class="lab-actions">${labButton('start', _lab.busy ? labText('שומר…', 'Saving…') : labText('מתחילים את הניסוי', 'Start experiment'), true)}${labButton('configure', labText('עריכת ההגדרה', 'Edit configuration'))}</div></div>`;
}
function labActiveHTML(e) {
  const today = labToday(e.timezone), m = labMeasure(e, [...db.stocks, ...db.crypto], today);
  let html = `<div class="lab-active-heading"><div><span class="lab-status">${m.pendingStart ? labText('מתחיל מחר', 'Starts tomorrow') : today >= e.end_date ? labText('זמן לסכם', 'Ready to review') : labText('הניסוי פעיל', 'In progress')}</span><h3>${labTitle(e.template)}</h3><p class="lab-footnote"><bdi dir="ltr">${esc(labRange(e))}</bdi> · ${e.asset_scope === 'stock' ? labText('מניות', 'Stocks') : labText('קריפטו', 'Crypto')} · ${esc(e.timezone)}</p></div><div class="lab-day-count"><strong>${m.daysElapsed}</strong><span>/ 30 ${labText('ימים', 'days')}</span></div></div><progress class="lab-progress" value="${m.daysElapsed}" max="30" aria-label="${labText('ימים בניסוי', 'Experiment days')}"></progress>`;
  html += `<p class="lab-footnote">${e.template === 'daily_limit' ? labText('הכלל: עד ', 'Rule: up to ') + e.target + labText(' רשומות ביום. ימים ללא פעילות אינם נכללים באחוז העמידה.', ' records per day. Inactive days do not inflate adherence.') : labText('היעד: 100% תיעוד. שלמות התיעוד אינה מוכיחה שהוא נכתב לפני הכניסה לעסקה.', 'Target: 100% documented. Completeness does not prove documentation preceded entry.')}</p>`;
  if (!_dbLoaded) html += `<p class="lab-warning" role="status">${labText('נתוני היומן אינם זמינים עדיין. המדדים יוצגו לאחר טעינה מוצלחת.', 'Journal data is not available yet. Metrics will appear after a successful load.')}</p>`;
  else {
    html += labMetricsHTML(m, e, true);
    const missing = m.current.missingIds;

    if (!missing.length && m.current.records > 0 && e.template !== 'daily_limit') html += '<p class="lab-footnote">' + labText('התיעוד בתקופת הניסוי מעודכן. אין כרגע עסקאות להשלמה.', 'Documentation is up to date for this experiment. No records need attention.') + '</p>';
    if (missing.length) html += `<details class="lab-missing" data-lab-section="missing-${esc(e.id)}"><summary>${labText('עסקאות להשלמת תיעוד', 'Records missing documentation')} (${missing.length})</summary><div class="lab-actions">${missing.slice(0, 20).map(id => `<button class="btn btn-secondary btn-sm sensitive" type="button" data-lab-edit="${esc(String(id))}">${esc(([...db.stocks, ...db.crypto].find(row => String(row.id) === String(id)) || {}).symbol || String(id))}</button>`).join('')}</div>${missing.length > 20 ? `<small>${labText('מוצגות 20 הראשונות. יתר העסקאות זמינות ביומן.', 'Showing the first 20. Remaining records are available in the journal.')}</small>` : ''}</details>`;
  }
  if (today >= e.end_date) html += `<div class="lab-form"><h3>${labText('מה לוקחים לניסוי הבא?', 'What will you take forward?')}</h3><label for="lab-choice">${labText('המסקנה שלך', 'Your conclusion')}</label><select id="lab-choice">${[['keep','להמשיך בכלל','Keep the rule'],['adjust','לנסות שינוי','Try an adjustment'],['inconclusive','ללא מסקנה','No conclusion']].map(([value,he,en]) => `<option value="${value}"${_lab.choice === value ? ' selected' : ''}>${labText(he,en)}</option>`).join('')}</select><label for="lab-note">${labText('משהו שתרצה לזכור? (אופציונלי)', 'Anything to remember? (optional)')}</label><textarea id="lab-note" maxlength="500" rows="3">${esc(_lab.note)}</textarea>${labButton('finish', labText('שמור סיכום', 'Save summary'), true)}</div>`;
  return html + `<div class="lab-actions lab-bottom">${labButton('cancel', labText('ביטול הניסוי', 'Cancel experiment'))}<span class="lab-footnote">${labText('המדדים מחושבים מכל תקופת הניסוי, ללא קשר לסינון שמעל.', 'Metrics use the experiment period independently of the filters above.')}</span></div>`;
}
function labOpenDocumentation(id) {
  if (!_currentUser || _lab.user !== _currentUser || _legalReadyUserId !== _currentUser.id || !_lab.active) return;
  const experiment = _lab.active;
  const missing = labMeasure(experiment, [...db.stocks, ...db.crypto], labToday(experiment.timezone)).current.missingIds;
  if (!missing.some(value => String(value) === String(id))) return;
  const trade = [...db.stocks, ...db.crypto].find(row => String(row.id) === String(id));
  if (!trade) return;
  openModal(trade.type, trade);
  const setup = experiment.template === 'setup_documented';
  const group = document.getElementById(setup ? 'm-setup-pills' : 'm-er-pills');
  if (!group) return;
  const help = document.createElement('p');
  help.id = 'lab-documentation-help';
  help.className = 'lab-footnote';
  help.textContent = setup
    ? labText('מה חסר? בחר את הסטאפ שלפיו נכנסת לעסקה (למשל VCP או פריצה), ואז לחץ על שמירת העסקה. אם אינך זוכר, אפשר לבטל בלי לבחור.', 'What is missing? Choose the setup used for this entry (such as VCP or breakout), then save the trade. If you do not remember, cancel without choosing.')
    : labText('מה חסר? בחר את סיבת הכניסה לעסקה, ואז לחץ על שמירת העסקה. אם אינך זוכר, אפשר לבטל בלי לבחור.', 'What is missing? Choose the entry reason, then save the trade. If you do not remember, cancel without choosing.');
  group.before(help);
  group.setAttribute('aria-describedby', help.id);
  group.scrollIntoView({ block: 'center' });
  group.querySelector('button')?.focus({ preventScroll: true });
}
function labResetDocumentation() {
  document.getElementById('lab-documentation-help')?.remove();
  for (const id of ['m-setup-pills', 'm-er-pills']) document.getElementById(id)?.removeAttribute('aria-describedby');
}
function labBind(host) {
  host.querySelectorAll('[data-lab-template]').forEach(button => button.addEventListener('click', () => {
    _lab.draft.template = button.dataset.labTemplate; _lab.step = 1; _lab.error = ''; labRender();
    document.getElementById('lab-scope')?.focus();
  }));
  host.querySelectorAll('[data-lab-action]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.labAction;
    if (action === 'open') { const disclosure=document.getElementById('personal-lab-disclosure');if(disclosure)disclosure.open=true;switchTab('statistics'); await labLoad({ history: true }); const experiments=document.querySelector('#personal-lab .lab-experiments');if(experiments)experiments.open=true;document.getElementById('personal-lab')?.scrollIntoView({ block: 'start' }); }
    if (action === 'dismiss') { try { localStorage.setItem('lab-invite-' + _currentUser.id, '1'); } catch {} labRenderOverview(); }
    if (action === 'reload') { await labLoad({ force: true, history: !!document.querySelector('#tab-statistics.active') }); }
    if (action === 'more') await labLoad({ history: true, more: true });
    if (action === 'back') { _lab.step = 0; labRender(); host.querySelector('[data-lab-template]')?.focus(); }
    if (action === 'configure') { _lab.step = 1; labRender(); document.getElementById('lab-scope')?.focus(); }
    if (action === 'review') {
      const input = document.getElementById('lab-target');
      if (input && (!input.reportValidity() || !Number.isInteger(Number(input.value)))) return;
      _lab.step = 2; labRender(); host.querySelector('[data-lab-action="start"]')?.focus();
    }
    if (action === 'review-missing' && _lab.active) {
      const missing = labMeasure(_lab.active, [...db.stocks, ...db.crypto], labToday(_lab.active.timezone)).current.missingIds;
      if (missing.length) labOpenDocumentation(missing[0]);
    }
    if (action === 'start' && await labStart({ ..._lab.draft, timezone: labTimezone() })) document.getElementById('personal-lab-title')?.focus({ preventScroll: true });
    if (action === 'finish' && _lab.active) await labFinish(_lab.active.id, _lab.active.updated_at, _lab.choice, _lab.note);
    if (action === 'cancel' && _lab.active && confirm(labText('לבטל את הניסוי? הוא יישמר בהיסטוריה.', 'Cancel this experiment? It will remain in history.'))) await labCancel(_lab.active.id, _lab.active.updated_at);
  }));
  for (const [id, handler] of [
    ['lab-scope', el => { _lab.draft.asset_scope = el.value; }],
    ['lab-target', el => { _lab.draft.target = Number(el.value); }],
    ['lab-choice', el => { _lab.choice = el.value; }],
    ['lab-note', el => { _lab.note = el.value; }]
  ]) { const input = host.querySelector('#' + id); input?.addEventListener('input', () => handler(input)); }
  host.querySelectorAll('[data-lab-edit]').forEach(button => button.addEventListener('click', () => {
    labOpenDocumentation(button.dataset.labEdit);
  }));
}
