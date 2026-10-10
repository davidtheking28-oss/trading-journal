// SUPABASE CLIENT
// ─────────────────────────────────────────────
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
let _currentUser = null;
let _currentSession = null;

// Client-side error capture. The client_errors table already had the exact
// shape this needs (kind, message, source, lineno, colno, stack, app, ua,
// user_id) and an RLS policy that already allows an anonymous or
// self-scoped insert — nothing existed on the client to actually write to
// it, so every JS error a user hit was invisible unless they reported it
// themselves. Throttled to one insert per distinct message per page load so
// a loop of the same error doesn't spam the table.
const _reportedErrors = new Set();
function _reportClientError(kind, message, extra = {}) {
  try {
    const key = kind + ':' + String(message).slice(0, 200);
    if (_reportedErrors.has(key)) return;
    _reportedErrors.add(key);
    _sb.from('client_errors').insert({
      user_id: _currentUser?.id ?? null,
      kind, message: String(message).slice(0, 2000), app: 'dashboard',
      ua: navigator.userAgent, ...extra,
    }).then(() => {}, () => {});
  } catch {}
}
window.addEventListener('error', (e) => {
  _reportClientError('error', e.message, {
    source: e.filename || null, lineno: e.lineno || null, colno: e.colno || null,
    stack: e.error?.stack ? String(e.error.stack).slice(0, 4000) : null,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  _reportClientError('unhandledrejection', reason?.message || String(reason), {
    stack: reason?.stack ? String(reason.stack).slice(0, 4000) : null,
  });
});

// Helper — get current JWT access token.
// Serve from the cached session on the hot path so concurrent startup calls don't
// all hit getSession() at once (supabase-js v2's Web Locks can return a null
// session under that contention → spurious 401s). Fall back to getSession() when
// the cached token is missing or within 60s of expiry — that path auto-refreshes.
async function _getToken() {
  const now = Math.floor(Date.now() / 1000);
  const s = _currentSession;
  if (s?.access_token && s.expires_at && s.expires_at > now + 60) return s.access_token;
  const { data: { session } } = await _sb.auth.getSession();
  if (session) _currentSession = session;
  return session?.access_token ?? '';
}

// Soft 401 recovery for edge functions: if a /functions/v1/ call comes back 401,
// force one session refresh and retry with the fresh token before the caller sees
// the error. Covers every edge-function fetch site centrally. Other fetches pass through.
const _origFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await _origFetch(input, init);
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  if (res.status !== 401 || !url.includes('/functions/v1/')) return res;
  try {
    const { data: { session } } = await _sb.auth.refreshSession();
    if (!session) return res;
    _currentSession = session;
    const retryInit = { ...(init || {}) };
    retryInit.headers = { ...(init?.headers || {}), 'Authorization': `Bearer ${session.access_token}` };
    return await _origFetch(input, retryInit);
  } catch {
    return res;
  }
};

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────
let _authMode = 'login';

// ─────────────────────────────────────────────
// LEGAL / POLICY DOCUMENTS — open standalone pages (single source of truth)
// ─────────────────────────────────────────────
const LEGAL_PAGES = { privacy: 'privacy.html', terms: 'terms.html', accessibility: 'accessibility.html' };
const LEGAL_PAGES_EN = { privacy: 'privacy-en.html', terms: 'terms-en.html', accessibility: 'accessibility.html' };
function openLegal(type) {
  const url = (_lang === 'en' ? LEGAL_PAGES_EN : LEGAL_PAGES)[type];
  if (url) window.open(url, '_blank', 'noopener');
}

function authSetMode(mode) {
  _authMode = mode;
  const isReg = mode === 'register';
  document.getElementById('auth-first').style.display     = isReg ? '' : 'none';
  if (!isReg) document.getElementById('auth-first').value = '';
  document.getElementById('auth-pass2').style.display     = isReg ? '' : 'none';
  document.getElementById('auth-consent-row').style.display = isReg ? 'flex' : 'none';
  if (!isReg) document.getElementById('auth-consent').checked = false;
  document.getElementById('auth-pass').autocomplete       = isReg ? 'new-password' : 'current-password';
  document.getElementById('auth-submit-btn').textContent  = isReg ? 'הרשמה' : 'כניסה';
  document.getElementById('auth-forgot-btn').style.display= isReg ? 'none' : '';
  document.getElementById('auth-tab-login').style.background    = isReg ? 'transparent' : '#4f46e5';
  document.getElementById('auth-tab-login').style.color         = isReg ? 'var(--text2)' : '#fff';
  document.getElementById('auth-tab-register').style.background = isReg ? '#4f46e5' : 'transparent';
  document.getElementById('auth-tab-register').style.color      = isReg ? '#fff' : 'var(--text2)';
  document.getElementById('auth-tab-login').textContent = isReg ? 'הרשמה' : 'כניסה';
  document.getElementById('auth-switch-to-register').style.display = isReg ? 'none' : '';
  document.getElementById('auth-switch-to-login').style.display    = isReg ? '' : 'none';
  document.getElementById('auth-strength').style.display = 'none';
  document.getElementById('auth-strength-bar').style.width = '0';
  _authMsg('', '');
}

function authPasswordStrength(val) {
  if (_authMode !== 'register') return;
  const el  = document.getElementById('auth-strength');
  const bar = document.getElementById('auth-strength-bar');
  const txt = document.getElementById('auth-strength-txt');
  if (!val) { el.style.display = 'none'; return; }
  el.style.display = '';
  const score = [val.length >= 8, /[A-Z]/.test(val), /[0-9]/.test(val), /[^A-Za-z0-9]/.test(val)].filter(Boolean).length;
  const levels = [
    { w: '25%', color: '#e11d48', label: 'חלשה' },
    { w: '50%', color: '#f59e0b', label: 'בינונית' },
    { w: '75%', color: '#3b82f6', label: 'טובה' },
    { w: '100%', color: '#0d9488', label: 'חזקה' },
  ];
  const lvl = levels[score - 1] || levels[0];
  bar.style.width      = lvl.w;
  bar.style.background = lvl.color;
  txt.style.color      = lvl.color;
  txt.textContent      = lvl.label;
}

function _authMsg(text, type) {
  const el = document.getElementById('auth-msg');
  if (!text) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.background = type === 'error' ? 'rgba(255,107,138,.12)' : 'rgba(45,212,160,.12)';
  el.style.color      = type === 'error' ? 'var(--red)' : 'var(--green)';
  el.textContent = text;
}

async function authSubmit() {
  const email = (document.getElementById('auth-email').value || '').trim();
  const pass  = (document.getElementById('auth-pass').value  || '');
  if (!email || !pass) { _authMsg('נא למלא אימייל וסיסמה', 'error'); return; }

  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    if (_authMode === 'register') {
      const first = (document.getElementById('auth-first').value || '').trim();
      const pass2 = document.getElementById('auth-pass2').value || '';
      if (!first) { _authMsg('נא להזין שם פרטי', 'error'); document.getElementById('auth-first').focus(); return; }
      if (pass !== pass2) { _authMsg('הסיסמאות אינן תואמות', 'error'); return; }
      if (pass.length < 8) { _authMsg('סיסמה חייבת להכיל לפחות 8 תווים', 'error'); return; }
      if (!document.getElementById('auth-consent').checked) { _authMsg('יש לאשר את תנאי השימוש ומדיניות הפרטיות', 'error'); return; }
      const { error } = await _sb.auth.signUp({ email, password: pass, options: { data: { first_name: first, full_name: first } } });
      if (error) throw error;
      _authMsg('נשלח אימייל אישור — בדוק את תיבת הדואר שלך', 'success');
    } else {
      const { data, error } = await _sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      await _onAuthSuccess(data.user);
    }
  } catch (e) {
    const msg = e.message || '';
    let friendly = 'שגיאה — נסה שוב';
    if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials') || msg.includes('Invalid email or password')) friendly = 'אימייל או סיסמה שגויים';
    else if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('User already registered')) friendly = 'אימייל זה כבר רשום — נסה להתחבר';
    else if (msg.includes('Email not confirmed') || msg.includes('not confirmed')) friendly = 'יש לאשר את האימייל תחילה — בדוק את תיבת הדואר';
    else if (msg.includes('invalid format') || msg.includes('Invalid email')) friendly = 'כתובת אימייל לא תקינה';
    else if (msg.includes('Too many requests') || msg.includes('rate limit')) friendly = 'יותר מדי ניסיונות — המתן דקה ונסה שוב';
    else if (msg.includes('Password') && msg.includes('characters')) friendly = 'הסיסמה חייבת להכיל לפחות 8 תווים';
    else if (msg) friendly = msg;
    _authMsg(friendly, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = _authMode === 'register' ? 'הרשמה' : 'כניסה';
  }
}

async function authGoogle() {
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) _authMsg(error.message, 'error');
}

async function authForgotPassword() {
  const email = (document.getElementById('auth-email').value || '').trim();
  if (!email) { _authMsg('הכנס אימייל לשחזור', 'error'); return; }
  const { error } = await _sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (error) { _authMsg(error.message, 'error'); return; }
  _authMsg('נשלח לינק לאיפוס סיסמה לאימייל', 'success');
}

async function authSignOut() {
  if (invHasUnsavedChanges() && !confirm('יש שינויים בהשקעות שטרם נשמרו. לצאת ולבטל אותם?')) return;
  _teardownRealtimeSync();
  _invResetSession();
  resetTradeSnapshots();
  await _sb.auth.signOut();
  _currentUser = null;
  if (_ovLiveTimer) { clearInterval(_ovLiveTimer); _ovLiveTimer = null; }
  // Investments kept a 60s quote timer running past sign-out, firing a request
  // per holding every minute with no token. Its caches survived too, so signing
  // into a second account showed the previous user's holdings and missed rows
  // until a full reload — missedRender()/invInit() both read the warm cache.
  if (_invPriceTimer) { clearInterval(_invPriceTimer); _invPriceTimer = null; }
  _invData = null;
  _invPricesUpdatedAt = null;
  _missedList = [];
  _missedLoaded = false;
  Object.keys(_missedQuotes).forEach(k => delete _missedQuotes[k]);
  db = JSON.parse(JSON.stringify(SEED));
  _dbLoaded = false;
  // The screener iframe is loaded once per page load and never touched again,
  // so its document — its own Supabase client and its one-shot _ssoApplied flag
  // — survived sign-out. Signing in as a different user then had its tj:session
  // dropped by that flag, and the frame kept showing the previous user's
  // watchlist. Dropping src makes the guarded `if (!f.src)` reload it fresh.
  const _sf = document.getElementById('screener-frame');
  if (_sf) _sf.removeAttribute('src');
  document.getElementById('auth-overlay').style.display = 'flex';
  toast('יצאת מהחשבון', 'info');
}

// ─────────────────────────────────────────────
// ONBOARDING WIZARD
// ─────────────────────────────────────────────
function onboardingCheck(userId) {
  if (localStorage.getItem('ob_done_' + userId)) return;
  const el = document.getElementById('ob-overlay');
  el.style.display = 'flex';
  onboardingStep(1);
}

function onboardingStep(n) {
  [1,2,3].forEach(i => {
    document.getElementById('ob-step-' + i).style.display = i === n ? '' : 'none';
    document.getElementById('ob-dot-' + i).style.background = i === n ? 'var(--accent)' : i < n ? 'rgba(79,131,255,0.4)' : 'rgba(148,163,184,0.2)';
  });
}

function onboardingDone() {
  localStorage.setItem('ob_done_' + _currentUser?.id, '1');
  document.getElementById('ob-overlay').style.display = 'none';
  _saveUserSettings({ onboarding_done: true }); // persist across devices
}

function onboardingOpenTrade() {
  onboardingDone();
  openModal('stock');
}

function onboardingGoSettings() {
  onboardingDone();
  const settingsBtn = document.querySelector('.tab-btn[aria-label="Settings"]');
  if (settingsBtn) switchTab('ibkr', settingsBtn);
}

const ADMIN_ID = '9f9ffff4-0936-446c-b816-410b50894e8b';

function _timeGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 22) return 'ערב טוב';
  return 'לילה טוב';
}

// First name as saved in Settings (falls back to the display name's first word,
// then the email handle). Shown in the header in place of the "TJ" mark on mobile.
function _firstName(user) {
  return (user?.user_metadata?.first_name || '').trim()
      || (user?.user_metadata?.full_name || '').trim().split(/\s+/)[0]
      || (user?.email || '').split('@')[0]
      || '';
}
function _setHeaderGreeting(name) {
  const hg = document.getElementById('header-greeting');
  if (hg) hg.textContent = `${_timeGreeting()} ${(name || '').trim()}`.trim();
}

// Block the app until a signed-in user has a first name on record. Covers
// Google sign-ins and any account made before the registration field existed.
function _maybeRequireName(user) {
  const m = user?.user_metadata || {};
  if ((m.first_name && m.first_name.trim()) || (m.full_name && m.full_name.trim())) return;
  const gate = document.getElementById('name-gate');
  if (!gate) return;
  gate.style.display = 'flex';
  setTimeout(() => document.getElementById('name-gate-input')?.focus(), 120);
}
async function nameGateSave() {
  const input = document.getElementById('name-gate-input');
  const msg = document.getElementById('name-gate-msg');
  const first = (input.value || '').trim();
  if (!first) { msg.textContent = 'נא להזין שם פרטי'; msg.style.display = ''; input.focus(); return; }
  try {
    await _sb.auth.updateUser({ data: { first_name: first, full_name: first } });
    if (_currentUser?.user_metadata) { _currentUser.user_metadata.first_name = first; _currentUser.user_metadata.full_name = first; }
    _setHeaderGreeting(first);
    const el = document.getElementById('header-user-name'); if (el) el.textContent = first;
    document.getElementById('name-gate').style.display = 'none';
  } catch {
    msg.textContent = 'שגיאה — נסה שוב'; msg.style.display = '';
  }
}

// One-time diagnostic: prints a timing breakdown of the login boot sequence
// to the console 6s after auth succeeds (long enough to catch the slow
// trailing fetches). Temporary — added 2026-09-13 to find what's actually
// slow, since code review alone couldn't tell without real numbers. Safe to
// remove once that's answered; it's read-only (performance API + console.log).
function _logBootTiming(t0) {
  setTimeout(() => {
    const entries = performance.getEntriesByType('resource')
      .map(e => ({ name: e.name.replace(location.origin, '').slice(0, 70), startMs: Math.round(e.startTime), durationMs: Math.round(e.duration) }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 20);
    console.log('%c[BOOT TIMING] paste this whole block back', 'color:#818cf8;font-weight:700');
    console.log('page navigation → auth confirmed:', Math.round(t0), 'ms');
    console.log('auth confirmed → login sequence done:', Math.round(performance.now() - t0), 'ms');
    console.table(entries);
  }, 6000);
}

async function _onAuthSuccess(user) {
  const _bootT0 = performance.now();
  if (_currentUser?.id !== user.id) { _invResetSession(); resetTradeSnapshots(); }
  _currentUser = user;
  const _displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'ChartRoom';
  _setHeaderGreeting(_firstName(user));
  const _nameEl = document.getElementById('header-user-name');
  if (_nameEl) {
    _nameEl.textContent = _displayName;
    const greetEl = document.getElementById('time-greeting');
    if (greetEl) { greetEl.textContent = _timeGreeting(); setTimeout(() => { greetEl.style.opacity = '1'; }, 600); }
    _nameEl.title = 'לחץ לשינוי שם';
    _nameEl.style.cursor = 'pointer';
    _nameEl.onclick = async () => {
      const n = prompt('שם תצוגה:', _nameEl.textContent);
      if (!n || !n.trim()) return;
      _nameEl.textContent = n.trim();
      await _sb.auth.updateUser({ data: { full_name: n.trim() } });
      _setHeaderGreeting(n.trim().split(/\s+/)[0]);
      toast('שם עודכן ✓', 'success');
    };
  }
  document.getElementById('auth-overlay').style.display = 'none';
  _maybeRequireName(user);
  await Promise.all([loadDB(), loadUserSettings()]);
  _setupRealtimeSync(); // keep every open device in step (computer ⇆ phone)
  loadCryptoSymbolsFromCoinGecko(); // background — don't delay startup or broker sync

  // Show admin-only UI elements
  const isAdmin = user.id === ADMIN_ID;
  const fhKey = document.getElementById('finnhub-key-section');
  const fhRow = document.getElementById('finnhub-key-row');
  if (fhKey) fhKey.style.display = isAdmin ? '' : 'none';
  // Regular users rely on the shared Finnhub key (edge-function secret) — hide the
  // personal-key field from them; data still flows via the fallback shared key.
  if (fhRow) fhRow.style.display = isAdmin ? '' : 'none';
  // The whole Data Sources section is config/status only — nothing for regular
  // users to do (keys are centralized, data loads in the background). Hide it.
  const dataSec = document.getElementById('s-data-sources');
  if (dataSec) dataSec.style.display = isAdmin ? '' : 'none';
  // Trade Confirmation Query ID (near-real-time IBKR sync) is a real, working
  // field — but it adds a second query ID + a cron track a regular user has no
  // reason to configure. Keep it admin-only so the broker section stays simple
  // for everyone else; the daily Activity sync already covers them.
  const flexAdvToggle = document.getElementById('flex-advanced-toggle');
  if (flexAdvToggle) flexAdvToggle.style.display = isAdmin ? '' : 'none';
  if (!isAdmin) { const fa = document.getElementById('flex-advanced'); if (fa) fa.style.display = 'none'; }
  const syncBtn = document.getElementById('flex-sync-btn');
  if (syncBtn) syncBtn.style.display = '';
  // Post-load UI setup
  initFilters();
  applyPrivacy();
  loadStockSymbols();
  _autoFlexSync();
  _autoBybitSync();
  if (window._flexSyncTimer) clearInterval(window._flexSyncTimer);
  window._flexSyncTimer = setInterval(() => { _autoFlexSync(); }, 10 * 60 * 1000);
  if (window._bybitSyncTimer) clearInterval(window._bybitSyncTimer);
  window._bybitSyncTimer = setInterval(() => { _autoBybitSync(); }, 30 * 60 * 1000);
  loadFearGreed();
  loadCryptoFearGreed();
  // ttLoad() is NOT called here on purpose (2026-08-26). Measured at boot it was
  // the single slowest request on the page — 2.3s — fetching Market Pulse data
  // for a tab the user is almost never on at login. switchTab('themes') already
  // loads it on demand, and _restoreLastTab() goes through switchTab, so a user
  // whose last tab really was Market Pulse still gets it.
  langInit();
  // Offer localStorage migration on first login
  await offerMigration();
  onboardingCheck(user.id);
  // A full page reload (tab discarded by the browser while backgrounded, or a
  // real navigation back to this page) always lands on the default Overview
  // tab — the markup's only `.tab-content.active` by default. _restoreLastTab
  // existed but was never called, so every reload silently dropped whichever
  // tab (the embedded screener, statistics, etc.) the user was actually on.
  _restoreLastTab();
  const _activeTabEl = document.querySelector('.tab-content.active');
  if (_activeTabEl) _maybeShowTabIntro(_activeTabEl.id.replace('tab-', ''), _activeTabEl);
  _maybeShowOrderIdNotice();
  _maybeShowFlexWindowNotice();
  _maybeShowBrokerSyncNotice();
  _logBootTiming(_bootT0);
  console.log('%c ChartRoom ','background:#818cf8;color:#fff;font-weight:700;font-size:13px;border-radius:var(--r-sm);padding:2px 6px');
  console.log('%cRunning in the browser — treat other users\' data with respect.','color:#8896a8;font-size:11px');
}

// ─────────────────────────────────────────────
// DATA MIGRATION (localStorage → Supabase)
// ─────────────────────────────────────────────
async function offerMigration() {
  const localRaw = localStorage.getItem(KEY);
  if (!localRaw) return;

  let localDb;
  try { localDb = JSON.parse(localRaw); } catch { return; }
  const localTrades = [...(localDb.stocks || []), ...(localDb.crypto || [])].filter(t => !t.deleted);
  if (!localTrades.length) return;

  // Only offer if Supabase has no trades yet
  const { count } = await _sb.from('trades').select('id', { count: 'exact', head: true }).eq('user_id', _currentUser.id);
  if (count > 0) return;

  const ok = confirm(`נמצאו ${localTrades.length} עסקאות מקומיות — להעביר לענן?\n(הנתונים המקומיים יישארו כגיבוי)`);
  if (!ok) return;

  try {
    // Migrate trades in chunks of 100
    const rows = localTrades.map(t => _tradeToRow(t));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await _sb.from('trades').insert(rows.slice(i, i + 100));
      if (error) throw error;
    }

    // Migrate missed opportunities
    const localMissed = JSON.parse(localStorage.getItem('tj-missed-v1') || '[]');
    if (localMissed.length) {
      const missedRows = localMissed.map(r => ({
        user_id: _currentUser.id,
        symbol: r.sym,
        date: r.date,
        price: r.price,
        sector: r.sector || '',
        note: r.note || ''
      }));
      await _sb.from('missed_opportunities').insert(missedRows);
    }

    // Purge the old plaintext AI keys. The AI feature is gone; these are only
    // still removed so a key left in localStorage from an older build doesn't
    // sit there indefinitely.
    localStorage.removeItem('tj-ai-key');
    localStorage.removeItem('groq-inv-key');

    toast(`✓ ${localTrades.length} עסקאות הועברו לענן`, 'success');
    await loadDB();
  } catch(e) {
    toast('שגיאה בהעברת נתונים: ' + e.message, 'error');
    console.error('[migration]', e);
  }
}

// ─────────────────────────────────────────────
