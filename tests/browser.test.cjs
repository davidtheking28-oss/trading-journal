const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve, extname, sep } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(__dirname, '..');
let server, browser, base, stamp = 0;
const sdk = readFileSync(resolve(__dirname, 'fixtures/supabase-browser.js'), 'utf8');

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/__test_rpc') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const params = JSON.parse(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ updated_at: 'stamp-' + ++stamp, holdings: params.p_holdings.map((h, i) => ({ id: h.id, position: i })) }));
      });
      return;
    }
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      let content = readFileSync(file);
      if (file.endsWith('dashboard.html')) content = Buffer.from(content.toString()
        .replaceAll('__SUPABASE_URL__', 'https://test.supabase.co')
        .replaceAll('__SUPABASE_ANON__', 'test-key')
        .replace(/integrity="[^"]*"/g, ''));
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(r => server.close(r));
});

async function open(t) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('Browser error:', e.message); });
  t.after(() => assert.deepEqual(errors, [], 'browser JavaScript errors'));
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.includes('supabase-js@')) return route.fulfill({ contentType: 'text/javascript', body: sdk });
    if (url.includes('chart.js@') && process.env.DESKTOP_REAL_CHARTS) return route.continue();
    if (url.includes('chart.js@')) return route.fulfill({ contentType: 'text/javascript', body: 'window.Chart=class { static defaults={};static getChart(){return null} constructor(el,cfg){this.data=cfg.data;this.options=cfg.options;this.canvas=el;} update(){}resize(){}destroy(){} };' });
    if (!url.startsWith(base)) return route.fulfill({ contentType: 'application/json', body: '{}' });
    await route.continue();
  });
  await page.goto(base + '/dashboard.html');
  await page.waitForLoadState('networkidle');
  return page;
}

async function login(page, email = 'a@example.test') {
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-pass').fill('test-password');
  await page.locator('#auth-submit-btn').click();
  await page.locator('#auth-overlay').waitFor({ state: 'hidden' });
  await page.locator('#auth-submit-btn').waitFor({ state: 'attached' });
  await page.waitForFunction(() => !document.getElementById('auth-submit-btn').disabled);
}

async function revealLab(page) {
 if (!await page.locator('#personal-lab-disclosure').evaluate(el=>el.open)) await page.locator('#personal-lab-toggle').click();
 await page.locator('.lab-experiments > summary').waitFor();
 if (!await page.locator('.lab-experiments').evaluate(el=>el.open)) await page.locator('.lab-experiments > summary').click();
 await page.evaluate(()=>{_labAuto.tradesOpen=true;const list=document.getElementById('lab-trades-disclosure');if(list)list.open=true;});
}

test('statistics show only the lab button until it is opened and closing pauses analysis',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(async()=>{
  cookieDecline();await loadPersonalLabFeature();await loadTradeSnapshotFeature();window.__labRuns=0;
  const original=tradeSetupSuggestion;tradeSetupSuggestion=(...args)=>{__labRuns++;return original(...args);};
  _fetchPivotBars=async()=>[];
  db.stocks=[{id:98701,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:101,exitPrice:102,shares:2,closedShares:2,t:[]}];_dbLoaded=true;switchTab('statistics');
 });
 await page.locator('#personal-lab-toggle').waitFor();
 assert.equal(await page.locator('#personal-lab-disclosure').evaluate(el=>el.open),false);
 assert.equal(await page.locator('#personal-lab').isVisible(),false);
 assert.equal(await page.evaluate(()=>__labRuns),0);
 await page.locator('#personal-lab-toggle').focus();await page.keyboard.press('Enter');
 await page.locator('#lab-auto-analysis .ss-setup-review').waitFor({state:'attached'});
 assert.equal(await page.locator('#lab-trades-disclosure').evaluate(el=>el.open),false);
 assert.equal(await page.locator('.lab-auto-trade').first().isVisible(),false);
 assert.ok((await page.locator('#personal-lab').boundingBox()).height<650,'closed trade list keeps the lab short');
 await page.locator('#lab-trades-disclosure > summary').click();
 await page.locator('#lab-auto-analysis .ss-setup-review').waitFor();
 assert.equal(await page.locator('.lab-experiments').evaluate(el=>el.open),false);
 assert.ok(await page.evaluate(()=>__labRuns)>0);
 await page.locator('#personal-lab-toggle').click();
 assert.equal(await page.locator('#personal-lab').isVisible(),false);
 await page.evaluate(()=>{_currentUser={id:'other'};resetPersonalLab();});
 assert.equal(await page.locator('#personal-lab-disclosure').evaluate(el=>el.open),false);
});

test('broker collection notices are localized and credentials require an explicit save', async t => {
  const page = await open(t);
  assert.equal(await page.locator('#auth-privacy-notice').isVisible(), true);
  await page.evaluate(() => { setLang('en'); authSetMode('register'); });
  assert.match(await page.locator('#auth-privacy-notice').innerText(), /Google sign-in/);
  assert.match(await page.locator('#auth-consent-text').innerText(), /does not authorize marketing messages or charges/);
  assert.equal(await page.locator('#auth-consent-privacy-link').getAttribute('href'), 'privacy-en.html');
  await page.evaluate(() => { setLang('he'); authSetMode('login'); });
  await login(page);
  await page.evaluate(() => {
    switchTab('ibkr');
    toggleExpand('s-bybit-body', 's-bybit-row');
    window.brokerSecretWrites = 0;
    const original = _sb.rpc.bind(_sb);
    _sb.rpc = (name, params) => {
      if (name === 'set_broker_secret') { window.brokerSecretWrites++; return Promise.resolve({ error: null, data: null }); }
      return original(name, params);
    };
    setLang('he');
  });
  assert.match(await page.locator('#bybit-privacy-note').innerText(), /החיבור לבחירתך/);
  assert.equal(await page.locator('#bybit-privacy-note a').getAttribute('href'), 'privacy.html#privacy-section-5');
  await page.locator('#bybit-api-key').fill('test-only-key');
  await page.locator('#bybit-api-secret').fill('test-only-secret');
  await page.locator('#bybit-api-secret').blur();
  assert.equal(await page.evaluate(() => window.brokerSecretWrites), 0);
  await page.locator('#s-bybit-body button[onclick="bybitSave()"]').click();
  await page.waitForFunction(() => window.brokerSecretWrites === 2);
  assert.equal(await page.locator('#bybit-api-secret').inputValue(), '');
  await page.evaluate(() => setLang('en'));
  assert.match(await page.locator('#bybit-privacy-note').innerText(), /Connecting is optional/);
  assert.equal(await page.locator('#bybit-privacy-note a').getAttribute('href'), 'privacy-en.html#privacy-section-5');
  assert.equal(await page.locator('#ibkr-privacy-note a').getAttribute('href'), 'privacy-en.html#privacy-section-5');
  for (const id of ['flex-query-id', 'flex-confirm-query-id', 'bybit-api-secret']) {
    assert.equal(await page.locator('#' + id).getAttribute('onblur'), null);
  }
});

test('journal registration links cannot create new shared Auth accounts',async t=>{
 const page=await open(t);
 await page.evaluate(()=>{window.__signupCalls=0;_sb.auth.signUp=async()=>{__signupCalls++;return {error:null};};authSetMode('register');});
 assert.equal(await page.evaluate(()=>_authMode),'login');
 assert.match(await page.locator('#auth-msg').innerText(),/משתמשים קיימים/);
 assert.equal(await page.locator('#auth-switch-to-register').isVisible(),false);
 await page.screenshot({path:'docs/private-journal-login.png'});
 await page.evaluate(()=>{_authMode='register';return authSubmit();});
 assert.equal(await page.evaluate(()=>__signupCalls),0);
});

test('journal access denies unapproved accounts before legal or data loading and fails closed',async t=>{
 const page=await open(t);
 await page.evaluate(()=>{__test.journalDenied=true;__testDB.legal_acceptances=[];});
 await page.locator('#auth-email').fill('a@example.test');await page.locator('#auth-pass').fill('test-password');await page.locator('#auth-submit-btn').click();
 await page.waitForFunction(()=>document.getElementById('auth-msg').textContent.includes('למשתמשים קיימים'));
 assert.equal(await page.locator('#app').evaluate(el=>el.inert),true);
 assert.equal(await page.locator('#legal-acceptance-dialog').count(),0);
 assert.equal(await page.evaluate(()=>_dbLoaded),false);
 await page.evaluate(()=>{__test.journalDenied=false;__test.journalAccessFailure=true;});
 await page.locator('#auth-submit-btn').click();
 await page.waitForFunction(()=>document.getElementById('auth-msg').textContent.includes('לא ניתן לבדוק'));
 assert.equal(await page.evaluate(()=>_legalReadyUserId),null);
});

test('legal acknowledgement requires age confirmation, survives save failure and is account scoped', async t => {
  const page = await open(t);
  await page.evaluate(() => { window.__testDB.legal_acceptances = []; window.__test.legalSaveFailure = true; });
  await page.locator('#auth-email').fill('a@example.test');
  await page.locator('#auth-pass').fill('test-password');
  await page.locator('#auth-submit-btn').click();
  const gate = page.locator('#legal-acceptance-dialog');
  await gate.waitFor({state:'visible'});
  assert.equal(await page.locator('#auth-overlay').isVisible(), true, 'no journal access before acknowledgement');
  assert.equal(await page.locator('#app').evaluate(el => el.inert), true);
  assert.equal(await page.evaluate(() => _legalReadyUserId), null, 'screener session is not authorized yet');
  await page.locator('#legal-acceptance-save').click();
  assert.ok(await page.locator('#legal-acceptance-error').textContent());
  await page.locator('#legal-acceptance-check').check();
  await page.locator('#legal-acceptance-save').click();
  await page.waitForFunction(() => document.getElementById('legal-acceptance-error').textContent.includes('לא נשמר'));
  assert.equal(await gate.isVisible(), true);
  await page.evaluate(() => { window.__test.legalSaveFailure = false; });
  await page.locator('#legal-acceptance-save').click();
  await page.locator('#auth-overlay').waitFor({state:'hidden'});
  assert.equal(await page.locator('#app').evaluate(el => el.inert), false);
  assert.deepEqual(await page.evaluate(() => window.__testDB.legal_acceptances.map(r => r.user_id)), ['user-a']);
  await page.evaluate(() => authSignOut());
  await page.locator('#auth-email').fill('b@example.test');
  await page.locator('#auth-pass').fill('test-password');
  await page.locator('#auth-submit-btn').click();
  await gate.waitFor({state:'visible'});
  assert.equal(await page.locator('#legal-acceptance-check').isChecked(), false);
  await page.locator('#legal-acceptance-leave').click();
  await gate.waitFor({state:'detached'});
  assert.equal(await page.evaluate(() => _currentUser), null);
});

test('provider sessions cannot skip legal acknowledgement and an obsolete save cannot unlock another account', async t => {
  const page = await open(t);
  await login(page);
  await page.evaluate(() => {
    window.__testDB.legal_acceptances = [];
    const rpc = _sb.rpc;
    _sb.rpc = async (name, params) => {
      if (name === 'accept_legal_documents') await new Promise(resolve => { window.__finishLegalSave = resolve; });
      return rpc(name, params);
    };
    // The shared post-auth path also handles Google sessions; no password form is involved.
    window.__providerBoot = _onAuthSuccess({id:'user-a',email:'oauth@example.test',user_metadata:{full_name:'Provider User'}});
  });
  await page.locator('#legal-acceptance-dialog').waitFor({state:'visible'});
  await page.locator('#legal-acceptance-check').check();
  await page.locator('#legal-acceptance-save').click();
  await page.waitForFunction(() => typeof window.__finishLegalSave === 'function');
  await page.evaluate(() => {
    _currentUser = {id:'user-b'};
    _closeLegalPrompt();
    window.__finishLegalSave();
  });
  await page.evaluate(() => window.__providerBoot);
  assert.equal(await page.evaluate(() => _currentUser.id), 'user-b');
  assert.equal(await page.locator('#legal-acceptance-dialog').count(), 0);
});
async function investments(page) {
  await page.locator('[onclick="switchTab(\'investments\',this)"]:visible').first().click();
  await page.locator('#inv-tbody .inv-sym-chip').first().waitFor();
}

test('investment quotes batch unique symbols and ignore obsolete portfolio responses', async t => {
  const page = await open(t);
  await login(page); await investments(page);
  await page.evaluate(() => {
    clearInterval(_invPriceTimer);
    invRenderRows(['AAA', 'BBB', 'AAA'].map(symbol => ({ symbol, entryShares: 1, entryPrice: 100, currentPrice: 100 })));
  });
  const requests = [];
  await page.route('**/functions/v1/finnhub?**', async route => {
    requests.push(new URL(route.request().url()).searchParams.get('symbols'));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ AAA: { c: 120 }, BBB: { c: 140 } }) });
  });
  await page.evaluate(() => invFetchPrices(false));
  assert.deepEqual(requests, ['AAA,BBB']);
  const prices = () => page.evaluate(() => [...document.querySelectorAll('#inv-tbody tr[data-idx]')].map(row => Number(row.querySelectorAll('input')[4].value)));
  assert.deepEqual(await prices(), [120, 140, 120]);
  let release, announce;
  const requested = new Promise(resolve => { announce = resolve; });
  await page.route('**/functions/v1/finnhub?**', async route => {
    await new Promise(resolve => { release = resolve; announce(); });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ AAA: { c: 999 }, BBB: { c: 999 } }) });
  });
  const pending = page.evaluate(() => invFetchPrices(false));
  await requested;
  await page.evaluate(() => { _invReloadGen++; });
  release();
  await pending;
  assert.deepEqual(await prices(), [120, 140, 120]);
});

test('investment refresh avoids hidden pages and inactive tabs', async t => {
  const page = await open(t);
  await login(page); await investments(page);
  const result = await page.evaluate(async () => {
    clearInterval(_invPriceTimer);
    const originalInterval = window.setInterval;
    const originalFetch = invFetchPrices;
    let tick, calls = 0;
    window.setInterval = callback => { tick = callback; return 0; };
    invFetchPrices = () => { calls++; };
    try {
      await invInit();
      calls = 0;
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      tick();
      const hiddenCalls = calls;
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      tick();
      const visibleCalls = calls;
      document.getElementById('tab-investments').classList.remove('active');
      tick();
      const inactiveCalls = calls;
      tick = null;
      await invInit();
      return { hiddenCalls, visibleCalls, inactiveCalls, inactiveTimer: tick === null };
    } finally {
      delete document.hidden;
      window.setInterval = originalInterval;
      invFetchPrices = originalFetch;
    }
  });
  assert.deepEqual(result, { hiddenCalls: 0, visibleCalls: 1, inactiveCalls: 1, inactiveTimer: true });
});

test('login and investment editing render without script-loading errors', async t => {
  const page = await open(t);
  await login(page); await investments(page);
  assert.equal(await page.locator('#inv-portfolio-lbl').textContent(), 'תיק א');
  assert.equal(await page.locator('#inv-tbody .inv-sym-chip').first().textContent(), 'AAA');
  await page.locator('#inv-portfolio-total').fill('1500');
  await page.waitForFunction(() => document.getElementById('inv-save-status').dataset.state === 'saved');
  assert.equal(await page.evaluate(() => __testDB.investments[0].portfolio_total), 1500);
});

test('switch while saving persists changes only in the original portfolio', async t => {
  const page = await open(t); await login(page); await investments(page);
  await page.evaluate(() => { __test.delay = 400; });
  await page.locator('#inv-portfolio-total').fill('1700');
  await page.locator('#inv-portfolio-dd > button').click();
  await page.locator('#inv-portfolio-menu button').filter({ hasText: 'תיק ב' }).click();
  await page.waitForFunction(() => document.getElementById('inv-portfolio-lbl').textContent === 'תיק ב');
  assert.equal(await page.locator('#inv-tbody .inv-sym-chip').first().textContent(), 'BBB');
  assert.deepEqual(await page.evaluate(() => __testDB.investments.slice(0,2).map(r => r.portfolio_total)), [1700,1000]);
  assert.equal(await page.evaluate(() => __test.calls.every(c => c.p_portfolio_id === 'portfolio-a')), true);
});

test('offline save shows failure, warns on unload, and retry persists the edit', async t => {
  const page = await open(t); await login(page); await investments(page);
  await page.context().setOffline(true);
  await page.locator('#inv-portfolio-total').fill('1900');
  await page.waitForFunction(() => document.getElementById('inv-save-status').dataset.state === 'error');
  assert.equal(await page.locator('#inv-save-retry').isVisible(), true);
  assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
  assert.equal(await page.evaluate(() => __testDB.investments[0].portfolio_total), 1000);
  await page.context().setOffline(false);
  await page.locator('#inv-save-retry').click();
  await page.waitForFunction(() => document.getElementById('inv-save-status').dataset.state === 'saved');
  assert.equal(await page.evaluate(() => __testDB.investments[0].portfolio_total), 1900);
  assert.equal(await page.evaluate(() => invHasUnsavedChanges()), false);
});

test('signing into a second account replaces portfolio choices and holdings', async t => {
  const page = await open(t); await login(page); await investments(page);
  await page.locator('#signout-btn').click();
  await page.locator('#auth-overlay').waitFor({ state: 'visible' });
  await login(page, 'b@example.test'); await investments(page);
  assert.equal(await page.locator('#inv-portfolio-lbl').textContent(), 'תיק ג');
  assert.equal(await page.locator('#inv-tbody .inv-sym-chip').first().textContent(), 'CCC');
  assert.equal(await page.locator('#inv-portfolio-menu').textContent().then(s => s.includes('תיק א')), false);
});

test('sign-out warns about an unsaved edit and cancel keeps the account open', async t => {
  const page = await open(t); await login(page); await investments(page);
  await page.context().setOffline(true);
  await page.locator('#inv-portfolio-total').fill('2200');
  await page.waitForFunction(() => document.getElementById('inv-save-status').dataset.state === 'error');
  const dialog = page.waitForEvent('dialog');
  const click = page.locator('#signout-btn').click();
  const prompt = await dialog;
  assert.equal(prompt.type(), 'confirm');
  await prompt.dismiss(); await click;
  assert.equal(await page.locator('#auth-overlay').isVisible(), false);
  assert.equal(await page.locator('#inv-portfolio-total').inputValue(), '2200');
  page.once('dialog', d => d.accept());
  await page.locator('#signout-btn').click();
  await page.locator('#auth-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => invHasUnsavedChanges()), false);
});

test('holding edits show unsaved state and commit with the same row identity', async t => {
  const page = await open(t); await login(page); await investments(page);
  await page.locator('#inv-tbody .inv-edit-btn').first().click();
  await page.locator('#inv-tbody .inv-sym-input').first().fill('XYZ');
  assert.equal(await page.evaluate(() => invHasUnsavedChanges()), true);
  assert.equal(await page.locator('#inv-save-status').getAttribute('data-state'), 'pending');
  await page.locator('#inv-tbody .inv-lock-btn').first().click();
  await page.waitForFunction(() => document.getElementById('inv-save-status').dataset.state === 'saved');
  assert.deepEqual(await page.evaluate(() => {
    const h = __testDB.investment_holdings.find(r => r.portfolio_id === 'portfolio-a');
    return { id: h.id, symbol: h.symbol };
  }), { id: 'holding-a', symbol: 'XYZ' });
});

test('the quantity calculator adds the sized position to the portfolio, and tops up a held symbol at the average cost', async t => {
  const page = await open(t); await login(page); await page.evaluate(() => cookieDecline()); await investments(page);
  await page.evaluate(() => invCalcOpen());
  await page.evaluate(() => {
    document.getElementById('ic-portfolio').value = 10000;
    document.getElementById('ic-sym').value = 'NEWQ';
    document.getElementById('ic-price').value = 50;
    document.getElementById('ic-pct').value = 10;
    document.getElementById('ic-cat').value = 'yellow';
    invCalcRender();
  });
  const add = page.locator('#ic-add');
  assert.equal(await add.isDisabled(), false);
  const label = await add.textContent();
  const shares = Number(label.match(/(\d+) מניות/)[1]);
  assert.ok(shares > 0);
  await add.click();
  await page.waitForFunction(() => document.getElementById('inv-save-status').dataset.state === 'saved');
  assert.equal(await page.locator('#inv-calc-modal.open').count(), 0);
  const row = await page.evaluate(() => __testDB.investment_holdings.find(r => r.symbol === 'NEWQ'));
  assert.equal(row.entry_shares, shares);
  assert.equal(row.entry_price, 50);
  await page.evaluate(() => invCalcOpen());
  await page.evaluate(() => {
    document.getElementById('ic-portfolio').value = 10000;
    document.getElementById('ic-sym').value = 'NEWQ';
    document.getElementById('ic-price').value = 100;
    document.getElementById('ic-pct').value = 10;
    invCalcRender();
  });
  const again = Number((await add.textContent()).match(/(\d+) מניות/)[1]);
  await add.click();
  await page.waitForFunction(() => document.getElementById('inv-save-status').dataset.state === 'saved');
  const rows = await page.evaluate(() => __testDB.investment_holdings.filter(r => r.symbol === 'NEWQ'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry_shares, shares + again);
  assert.ok(Math.abs(rows[0].entry_price - (shares * 50 + again * 100) / (shares + again)) < 1e-4);
});

test('the tranche table shows the loss at the stop, using the standard 8% when no stop is typed', async t => {
  const page = await open(t); await login(page); await page.evaluate(() => cookieDecline()); await investments(page);
  await page.evaluate(() => invCalcOpen());
  await page.evaluate(() => {
    document.getElementById('ic-portfolio').value = 10000;
    document.getElementById('ic-sym').value = 'NEWQ';
    document.getElementById('ic-price').value = 100;
    document.getElementById('ic-pct').value = 10;
    document.getElementById('ic-tranches').value = 2;
    document.getElementById('ic-stop').value = '';
    invCalcRender();
  });
  const text = await page.locator('#ic-tranche-out').innerText();
  assert.match(text, /בסטופ 8%/);
  assert.match(text, /−\$80/, 'one tranche of 5 shares at 100 loses 8% = 40; both together 80');
  await page.evaluate(() => { document.getElementById('ic-stop').value = 5; invCalcRender(); });
  const typed = await page.locator('#ic-tranche-out').innerText();
  assert.match(typed, /בסטופ 5%/);
  assert.match(typed, /−\$50/);
});

test('the calculator add button stays disabled without a symbol', async t => {
  const page = await open(t); await login(page); await investments(page);
  await page.evaluate(() => invCalcOpen());
  await page.evaluate(() => {
    document.getElementById('ic-portfolio').value = 10000;
    document.getElementById('ic-sym').value = '';
    document.getElementById('ic-price').value = 50;
    document.getElementById('ic-pct').value = 10;
    invCalcRender();
  });
  assert.equal(await page.locator('#ic-add').isDisabled(), true);
});


test('mobile holding cards expand and remain editable without horizontal page overflow', async t => {
  const page = await open(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.evaluate(() => cookieDecline());
  await page.locator('#cookie-banner').waitFor({ state: 'hidden' });
  await page.evaluate(() => switchTab('investments'));
  const row = page.locator('#inv-tbody tr[data-idx]').first();
  await row.waitFor();
  const details = row.locator('.inv-card-toggle');
  assert.equal(await row.locator('td').nth(3).isVisible(), false);
  await details.click();
  assert.equal(await details.getAttribute('aria-expanded'), 'true');
  assert.equal(await row.locator('td').nth(3).isVisible(), true);
  await details.click();
  await row.locator('.inv-edit-btn').click();
  assert.equal(await page.locator('#inv-tbody tr[data-idx]').first().locator('td').nth(3).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});


test('investment summary precedes configuration in desktop and mobile themes', async t => {
  const page = await open(t); await login(page);
  await page.evaluate(() => cookieDecline());
  await page.locator('#cookie-banner').waitFor({ state: 'hidden' });
  await page.evaluate(() => switchTab('investments'));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => _applyTheme(theme), theme);
      const summary = await page.locator('.inv-summary-bar').boundingBox();
      const config = await page.locator('.inv-config-grid').boundingBox();
      assert.ok(summary.y < config.y);
      assert.ok((await page.locator('.inv-table-wrap').boundingBox()).y < config.y);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.VISUAL_REVIEW_DIR) await page.screenshot({ path: process.env.VISUAL_REVIEW_DIR + '/investments-' + width + '-' + theme + '.png', fullPage: true, animations: 'disabled', timeout: 15000 });
    }
  }
});


test('mobile investments navigation and density preference survive reload', async t => {
  const page = await open(t); await page.setViewportSize({ width: 390, height: 844 });
  await login(page); await page.evaluate(() => cookieDecline());
  await page.locator('#cookie-banner').waitFor({ state: 'hidden' });
  await page.locator('#top-nav [onclick*="investments"]').click();
  await page.locator('#inv-tbody .inv-sym-chip').first().waitFor();
  assert.equal(await page.locator('.inv-summary-unified > div').count(), 4);
  await page.locator('#table-density').selectOption('compact');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.tableDensity), 'compact');
  await page.reload(); await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.tableDensity), 'compact');
  assert.equal(await page.locator('#table-density').inputValue(), 'compact');
});

test('period comparison handles year rollover, fees, scope and absent data', async t => {
  const page = await open(t); await login(page);
  const result = await page.evaluate(() => {
    const tr = (date, exitPrice, commission = 0) => ({ entryDate: date, entryPrice: 10, shares: 10, closedShares: 10, exitPrice, ls: 'L', commission });
    db.stocks = [tr('2026-01-04', 20, 2), tr('2025-12-04', 15, 1)];
    db.crypto = [tr('2026-01-05', 12), tr('2025-12-05', 11)];
    document.getElementById('ov-year').innerHTML = '<option value="2026">2026</option>';
    document.getElementById('ov-month').value = '1';
    ovScope = 'stock'; _tradesScope = 'crypto'; renderPeriodComparison(filterTrades('stock', '1', '2026', true));
    const stock = document.getElementById('cum-period-comparison').textContent;
    ovScope = 'crypto'; _tradesScope = 'stock'; renderPeriodComparison(filterTrades('crypto', '1', '2026', true));
    const crypto = document.getElementById('cum-period-comparison').textContent;
    db.crypto = []; renderPeriodComparison([]);
    const empty = document.getElementById('cum-period-comparison').textContent;
    document.getElementById('ov-year').value = ''; renderPeriodComparison([]);
    return { stock, crypto, empty, all: document.getElementById('cum-period-comparison').textContent, rollover: previousChartPeriod('1', '2026'), annual: previousChartPeriod('', '2026') };
  });
  assert.match(result.stock, /2025-12/); assert.match(result.stock, /\+\$98/); assert.match(result.stock, /\+\$49/);
  assert.match(result.crypto, /\+\$20/); assert.match(result.crypto, /\+\$10/);
  assert.match(result.empty, /שתי התקופות/); assert.equal(result.all, '');
  assert.deepEqual(result.rollover, { month: 12, year: 2025 });
  assert.deepEqual(result.annual, { month: '', year: 2025 });
});


test('desktop tabs render empty and representative data in both themes', async t => {
  const page = await open(t); await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page); await page.evaluate(() => cookieDecline());
  await page.locator('#cookie-banner').waitFor({ state: 'hidden' });
  for (const populated of [false, true]) {
    await page.evaluate(populated => {
      const date = new Date(), month = date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2, '0');
      db.stocks = populated ? Array.from({ length: 12 }, (_, i) => ({ id: 10000 + i, type: 'stock', symbol: ['AAPL','MSFT','NVDA'][i%3], entryDate: month + '-' + String(i+1).padStart(2,'0'), ls: 'L', entryPrice: 100+i, shares: 10, stop: 95, exitPrice: i%4 ? 110-i : 0, closedShares: i%4 ? 10 : 0, closeDate: i%4 ? month+'-15' : '', t: [], commission: 1, ecn: 0, setupType: 'Breakout', entryReason: 'פריצה מעל בסיס', sector: 'Technology', notes_keep: '', notes_improve: '' })) : [];
      _invData = null;
      __testDB.investment_holdings = populated ? [{id:'desktop-holding',user_id:'user-a',portfolio_id:'portfolio-a',symbol:'AAPL',entry_shares:10,entry_price:100,position:0}] : [];
      db.crypto = populated ? [{ ...db.stocks[1], id: 20000, type: 'crypto', symbol: 'BTC' }] : [];
      _missedList = populated ? [{ id:'missed-demo',sym:'AMD',date:month+'-02',price:100,sector:'Technology',note:'פספסתי את הפריצה' }] : [];
      _missedLoaded = true;
      _ttData = populated ? Array.from({length:12},(_,i)=>({name:['Technology','Energy','Financials','Healthcare'][i%4]+' '+(i+1),ticker:'XL'+i,today:(i-5)/3,w1:(i-5)/2,m1:i-5,m3:i-5,ytd:i-5})) : [];
      _ttIndices = populated ? [{name:'S&P 500',ticker:'SPY',today:0.5,w1:1,m1:2,m3:3,ytd:4}] : [];
    }, populated);
    for (const tab of ['overview','stocks','statistics','themes','missed','ibkr','investments','screener']) {
      await page.evaluate(tab => switchTab(tab), tab);
      await page.waitForTimeout(200);
      await page.evaluate(() => { document.getElementById('main-content').scrollTop = 0; });
      assert.equal(await page.locator('#tab-'+tab).isVisible(), true);
      for (const theme of ['dark','light']) {
        await page.evaluate(theme => _applyTheme(theme),theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, tab+' page overflow');
        if(process.env.DESKTOP_REVIEW_DIR) await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/'+tab+'-'+(populated?'data':'empty')+'-'+theme+'.png',animations:'disabled',timeout:15000});
      }
      if (tab === 'stocks' && populated) {
        const table = await page.locator('#stocks-wrap table').boundingBox();
        const lastHeader = await page.locator('#stocks-wrap th').last().boundingBox();
        assert.ok(Math.abs(table.x-lastHeader.x) < 3, 'no unused column at the table edge');
        assert.ok(lastHeader.width < table.width * 0.2, 'actions do not consume the spare table width');
        assert.equal(await page.locator('#stocks-wrap').evaluate(el=>el.scrollWidth <= el.clientWidth), true, 'compact table fits desktop width');
        await page.locator('#stocks-wrap .data-row').first().click();
        await page.locator('#stocks-wrap .expanded-row').first().waitFor();
        assert.equal(await page.locator('#stocks-wrap .expanded-row td').first().getAttribute('colspan'), '12');
        await page.locator('#stocks-wrap .data-row').first().click();
        await page.locator('#st-search').fill('MSFT');
        assert.doesNotMatch(await page.locator('#stocks-wrap').innerText(), /NVDA/);
        assert.match(await page.locator('#trade-filter-summary').innerText(), /MSFT/);
        await page.locator('#trade-filter-summary button').click();
        assert.equal(await page.locator('#st-search').inputValue(), '');
        assert.match(await page.locator('#stocks-wrap').innerText(), /NVDA/);
        await page.locator('#trade-secondary-actions summary').click();
        assert.equal(await page.locator('#st-archive-btn').isVisible(), true);
        await page.locator('#trade-secondary-actions summary').click();
      }
      if (tab === 'investments' && populated) {
        assert.match(await page.locator('#inv-tbody').innerText(), /AAPL/);
        assert.equal(await page.locator('[data-i18n="inv_cash_explanation"]').isVisible(), true);
        assert.match(await page.locator('[data-i18n="inv_cash_explanation"]').innerText(), /אומדן/);
        assert.match(await page.locator('[data-i18n="inv_allocation_explanation"]').innerText(), /היעד/);
      }
      if (tab === 'themes' && populated) {
        await page.locator('#tab-themes .tt-period[data-p="w1"]').click();
        assert.equal(await page.locator('#tt-grid .tt-pct').first().evaluate(el => getComputedStyle(el).direction), 'ltr');
        await page.locator('#tab-themes .tt-period[data-p="today"]').click();
      }
      if (tab === 'statistics' && populated) {
        const toggle = page.locator('#stats-secondary-toggle');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await toggle.click();
        assert.equal(await page.locator('#stats-secondary-content').isVisible(), false);
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await page.evaluate(()=>{window.__monthlyBuilds=0;const original=renderMonthlyTracker;renderMonthlyTracker=(...args)=>{__monthlyBuilds++;return original(...args);};renderStatistics();});
        assert.equal(await page.evaluate(()=>__monthlyBuilds),0,'hidden statistics do not build secondary tables');
        await toggle.click();
        assert.equal(await page.evaluate(()=>__monthlyBuilds),1,'opening builds current secondary tables');
        assert.equal(await page.locator('#stats-secondary-content').isVisible(), true);

        assert.match(await page.locator('#donut-legend-win').innerText(), /33\.3%/);
        assert.match(await page.locator('#donut-legend-loss').innerText(), /66\.7%/);
      }
      if(process.env.DESKTOP_REVIEW_DIR) {
        await page.evaluate(() => {const el=document.getElementById('main-content');el.scrollTop=el.scrollHeight;});
        await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/'+tab+'-'+(populated?'data':'empty')+'-bottom.png',animations:'disabled',timeout:15000});
      }
      if(process.env.DESKTOP_REVIEW_DIR) console.log(tab, populated?'data':'empty', (await page.locator('#tab-'+tab).innerText()).slice(0,550));
    }
    if(populated) {
      await page.evaluate(() => { _tradesScope='crypto';switchTab('stocks'); });
      assert.match(await page.locator('#stocks-wrap').innerText(),/BTC/);
    }
  }
});

test('a holding at its stop is marked in the table and announced once', async t => {
  const page = await open(t); await login(page); await investments(page);
  const row = page.locator('#inv-tbody tr[data-idx]').first();
  const setPrices = (entry, live) => page.evaluate(([e, l]) => {
    const inp = document.querySelectorAll('#inv-tbody tr[data-idx]')[0].querySelectorAll('input');
    inp[3].value = e; inp[4].value = l; invRecalc();
  }, [entry, live]);
  await setPrices('100', '90');
  assert.match(await row.locator('.inv-stop-label').textContent(), /🛑/);
  assert.equal(await page.locator('#toasts .toast').filter({ hasText: 'הגיעה לסטופ' }).count(), 1);
  await page.evaluate(() => invRecalc());
  assert.equal(await page.locator('#toasts .toast').filter({ hasText: 'הגיעה לסטופ' }).count(), 1);
  await setPrices('100', '95');
  assert.doesNotMatch(await row.locator('.inv-stop-label').textContent(), /🛑/);
});

test('Market Pulse refetches the moment the tab becomes visible again (tablet wake-up)', async t => {
  const page = await open(t); await login(page);
  let calls = 0;
  await page.route('**/functions/v1/theme-tracker', route => { calls++; route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ts: Date.now(), indices: [], themes: [{ name: 'Tech', ticker: 'XLK', today: calls, w1: 1, m1: 1, m3: 1, ytd: 1 }] }) }); });
  await page.evaluate(() => switchTab('themes'));
  await page.waitForFunction(() => document.querySelector('#tt-grid .tt-row'));
  const first = calls;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  assert.equal(calls, first, 'hiding the tab must not fetch');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(600);
  assert.equal(calls, first + 1, 'returning to the tab must refetch once');
});

test('overview chart fill avoids forced canvas layout and adapts to chart height', async t => {
  const page = await open(t); await login(page);
  const result = await page.evaluate(() => {
    const canvas = document.getElementById('chart-cum');
    let reads = 0;
    Object.defineProperty(canvas, 'offsetHeight', { configurable: true, get() { reads++; return 320; } });
    try {
      renderCumChart([{ id: 99001, symbol: 'AAPL', entryDate: '2026-10-01', closeDate: '2026-10-02', entryPrice: 100, exitPrice: 110, shares: 5, closedShares: 5, commission: 1, ls: 'L', t: [] }]);
      const fill = charts.cum.data.datasets[0].backgroundColor;
      const first = fill({ chart: { height: 320 } });
      const same = fill({ chart: { height: 320 } });
      const resized = fill({ chart: { height: 160 } });
      return { reads, valid: first instanceof CanvasGradient, reused: same === first, resized: resized !== first };
    } finally { delete canvas.offsetHeight; }
  });
  assert.deepEqual(result, { reads: 0, valid: true, reused: true, resized: true });
});

test('manual TLG parser loads only on selection and retries into the correct preview', async t => {
  const page = await open(t); await login(page);
  assert.equal(await page.evaluate(() => typeof tlgParse), 'undefined');
  let requests = 0;
  await page.route('**/assets/js/file-import.js*', async route => {
    requests++;
    if (requests === 1) return route.abort();
    await route.continue();
  });
  const contents = 'STK_TRD|1|AAPL|Apple|NASDAQ|BUY|O|20261001|090000|USD|5|1|100|500|1\nSTK_TRD|2|AAPL|Apple|NASDAQ|SELL|C|20261002|090000|USD|5|1|110|550|1';
  await page.evaluate(async text => { await tlgLoadFile({ files: [new File([text], 'trades.tlg')] }); }, contents);
  assert.equal(requests, 1);
  assert.equal(await page.evaluate(() => typeof tlgParse), 'undefined');
  await page.locator('#tlg-file-input').setInputFiles({ name: 'trades.tlg', mimeType: 'text/plain', buffer: Buffer.from(contents) });
  await page.waitForFunction(() => document.querySelectorAll('#tlg-preview .ibkr-trade-preview').length === 1);
  assert.deepEqual(await page.evaluate(() => _tlgPending.map(({ symbol, shares, closedShares, entryPrice, exitPrice, commission }) => ({ symbol, shares, closedShares, entryPrice, exitPrice, commission }))), [{ symbol: 'AAPL', shares: 5, closedShares: 5, entryPrice: 100, exitPrice: 110, commission: 2 }]);
  assert.match(await page.locator('#tlg-preview').textContent(), /48\.00/);
  assert.equal(requests, 2);
});

test('missed opportunity views load on demand and retry without losing cached rows', async t => {
  const page = await open(t); await login(page);
  assert.equal(await page.evaluate(() => typeof missedRenderContent), 'undefined');
  let requests = 0;
  await page.route('**/assets/js/missed.js*', async route => {
    requests++;
    if (requests === 1) return route.abort();
    await route.continue();
  });
  await page.evaluate(() => {
    _missedList = [{ id: 'lazy-missed', sym: 'AMD', date: new Date().toISOString().slice(0,10), price: 100, sector: 'Technology', note: 'לא שמתי לב' }];
    _missedLoaded = true;
    switchTab('missed');
  });
  await page.locator('#missed-tbody button').waitFor();
  assert.equal(requests, 1);
  await page.locator('#missed-tbody button').click();
  await page.locator('#missed-row-lazy-missed').waitFor();
  assert.match(await page.locator('#missed-row-lazy-missed').innerText(), /AMD/);
  assert.equal(await page.evaluate(() => _missedList.length), 1);
  await page.evaluate(() => { switchTab('overview'); switchTab('missed'); });
  await page.locator('#missed-row-lazy-missed').waitFor();
  assert.equal(requests, 2);
});

test('delayed missed view loading cannot render a replaced account', async t => {
  const page = await open(t); await login(page);
  let release, announce;
  const requested = new Promise(resolve => { announce = resolve; });
  await page.route('**/assets/js/missed.js*', async route => {
    await new Promise(resolve => { release = resolve; announce(); });
    await route.continue();
  });
  const pending = page.evaluate(async () => {
    document.getElementById('tab-missed').classList.add('active');
    _missedLoaded = false;
    window.__missedReads = 0;
    missedLoad = async () => { __missedReads++; return [{ id: 'old-user-row', sym: 'AMD', date: '2026-10-01', price: 100 }]; };
    await missedRender();
  });
  await requested;
  assert.equal(await page.evaluate(() => __missedReads), 1, 'data loading starts alongside the feature script');
  await page.evaluate(() => { _currentUser = { id: 'replacement' }; });
  release(); await pending;
  assert.equal(await page.locator('#missed-row-old-user-row').count(), 0);
});

test('market theme views load on demand and sector holdings use a separate cache', async t => {
  const page = await open(t); await login(page);
  assert.equal(await page.evaluate(() => typeof ttRenderContent), 'undefined');
  let requests = 0;
  await page.route('**/assets/js/themes.js*', async route => {
    requests++;
    if (requests === 1) return route.abort();
    await route.continue();
  });
  await page.route('**/functions/v1/sector-holdings?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ holdings: [{ symbol: 'AAPL', name: 'Apple', today: 1, w1: 2 }] }) }));
  await page.evaluate(() => {
    _sectorCache.XLK = 'Technology';
    _ttData = [{ name: 'Technology', ticker: 'XLK', today: 1, w1: 2 }]; _ttIndices = [];
    switchTab('themes');
  });
  await page.locator('#tt-grid button').waitFor();
  assert.equal(requests, 1);
  await page.locator('#tt-grid button').click();
  await page.locator('#tt-grid .tt-row').waitFor();
  await page.evaluate(() => sectorModalOpen('XLK', 'Technology'));
  assert.match(await page.locator('#sector-modal-body').textContent(), /AAPL/);
  assert.deepEqual(await page.evaluate(() => ({ sector: _sectorCache.XLK, holding: _sectorHoldingsCache.XLK[0].symbol })), { sector: 'Technology', holding: 'AAPL' });
  await page.evaluate(() => ttSetPeriod('w1'));
  assert.match(await page.locator('#sector-modal-body').textContent(), /2\.00%/);
  await page.evaluate(() => sectorModalClose());
  assert.equal(requests, 2);
});

test('market theme polling skips hidden pages and inactive tabs', async t => {
  const page = await open(t); await login(page);
  const result = await page.evaluate(() => {
    const interval = window.setInterval, load = ttLoad;
    let tick, calls = 0;
    window.setInterval = callback => { tick = callback; return 0; };
    ttLoad = () => { calls++; };
    document.getElementById('tab-themes').classList.add('active');
    try {
      ttStartTimer();
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }); tick();
      const hidden = calls;
      Object.defineProperty(document, 'hidden', { configurable: true, value: false }); tick();
      const visible = calls;
      document.getElementById('tab-themes').classList.remove('active'); tick();
      return { hidden, visible, inactive: calls };
    } finally { delete document.hidden; window.setInterval = interval; ttLoad = load; }
  });
  assert.deepEqual(result, { hidden: 0, visible: 1, inactive: 1 });
});

test('statistics load on demand, retry failures and ignore a tab left during loading', async t => {
  const page = await open(t); await login(page);
  await page.evaluate(() => { _brokerEquityUsd = 0; _brokerEquityTs = Date.now(); });
  assert.equal(await page.evaluate(() => typeof renderStatisticsContent), 'undefined');
  let requests = 0, release, announce;
  const requested = new Promise(resolve => { announce = resolve; });
  const source = readFileSync(resolve(root, 'assets/js/statistics.js'), 'utf8');
  await page.route('**/assets/js/statistics.js*', async route => {
    requests++;
    if (requests === 1) return route.abort();
    await new Promise(resolve => { release = resolve; announce(); });
    await route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__statsRenders=0;const originalStatisticsRender=renderStatisticsContent;renderStatisticsContent=function(){window.__statsRenders++;return originalStatisticsRender();};' });
  });
  await page.evaluate(() => { switchTab('statistics'); renderStatistics(); });
  const retry = page.locator('#stats-feature-status button');
  await retry.waitFor();
  assert.equal(requests, 1);
  await retry.click();
  await requested;
  await page.evaluate(() => switchTab('overview'));
  release();
  await page.waitForFunction(() => typeof renderStatisticsContent === 'function' && !document.getElementById('tab-statistics').hasAttribute('aria-busy'));
  assert.equal(await page.evaluate(() => __statsRenders), 0);
  await page.evaluate(() => switchTab('statistics'));
  assert.equal(await page.evaluate(() => __statsRenders), 1);
  assert.equal(requests, 2);
  assert.equal(await page.locator('#stats-feature-status').count(), 0);
});

test('broker CSV tools load only on file selection and retry into a working preview', async t => {
  const page = await open(t); await login(page);
  assert.equal(await page.evaluate(() => typeof biParseCSV), 'undefined');
  let requests = 0;
  await page.route('**/assets/js/broker-import.js*', async route => {
    requests++;
    if (requests === 1) return route.abort();
    await route.continue();
  });
  const csv = 'Symbol,Side,Quantity,Open Price,Close Price,Date,Commission\nAAPL,Buy,5,100,110,2026-09-02,1';
  await page.evaluate(async csv => {
    document.getElementById('bi-broker').value = 'colmex';
    await brokerLoadFile({ files: [new File([csv], 'trades.csv', { type: 'text/csv' })] });
  }, csv);
  assert.equal(requests, 1);
  assert.equal(await page.evaluate(() => typeof biParseCSV), 'undefined');
  await page.locator('#bi-file-input').setInputFiles({ name: 'trades.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForFunction(() => document.getElementById('bi-mapping').style.display === 'block');
  await page.evaluate(() => biPreview());
  assert.match(await page.locator('#bi-preview').textContent(), /AAPL/);
  assert.deepEqual(await page.evaluate(() => _biTrades.map(({ symbol, entryPrice, exitPrice, closedShares }) => ({ symbol, entryPrice, exitPrice, closedShares }))), [{ symbol: 'AAPL', entryPrice: 100, exitPrice: 110, closedShares: 5 }]);
  assert.equal(requests, 2);
});

test('delayed broker tool loading cannot read a file for a replaced account', async t => {
  const page = await open(t); await login(page);
  let release, announce;
  const requested = new Promise(resolve => { announce = resolve; });
  await page.route('**/assets/js/broker-import.js*', async route => {
    await new Promise(resolve => { release = resolve; announce(); });
    await route.continue();
  });
  const pending = page.evaluate(async () => {
    document.getElementById('bi-broker').value = 'colmex';
    await brokerLoadFile({ files: [new File(['Symbol,Quantity\nAAPL,5'], 'trades.csv')] });
  });
  await requested;
  await page.evaluate(() => { _currentUser = { id: 'replaced-account' }; });
  release();
  await pending;
  assert.equal(await page.evaluate(() => _biRows), null);
  assert.equal(await page.evaluate(() => document.getElementById('bi-mapping').style.display), 'none');
});

test('trade chart feature loads on demand, shares requests and retries a failed load', async t => {
  const page = await open(t); await login(page);
  assert.equal(await page.evaluate(() => typeof tradeSnapshotImage), 'undefined');
  assert.equal(await page.locator('script[src*="trade-charts.js"]').count(), 0);
  let requests = 0;
  await page.route('**/assets/js/trade-charts.js*', async route => {
    requests++;
    if (requests === 1) return route.abort();
    await route.continue();
  });
  assert.deepEqual(await page.evaluate(async () => (await Promise.allSettled([loadTradeSnapshotFeature(), loadTradeSnapshotFeature()])).map(item => item.status)), ['rejected', 'rejected']);
  assert.equal(requests, 1);
  await page.evaluate(() => Promise.all([loadTradeSnapshotFeature(), loadTradeSnapshotFeature()]));
  assert.equal(requests, 2);
  assert.equal(await page.evaluate(() => typeof tradeSnapshotImage), 'function');
  await page.evaluate(() => loadTradeSnapshotFeature());
  assert.equal(requests, 2);
});

test('closed stock trades automatically display one entry and exit image and refresh after editing', async t => {
  const page=await open(t);await login(page);
  await page.evaluate(()=>{
    window.__snapshotCalls=0;
    _fetchPivotBars=async()=>{ __snapshotCalls++;return Array.from({length:280},(_,i)=>{const timestamp=Date.parse('2026-01-01T00:00:00Z')/1000+i*86400;const close=100+(timestamp-Date.parse('2026-09-02T00:00:00Z')/1000)/86400*.15+Math.sin(i*.38)*2.2;return {t:timestamp,o:close+Math.sin(i)*.6,h:close+1.2,l:close-1.1,c:close,v:200000+Math.round(Math.abs(Math.sin(i*.9))*300000)};}).filter(b=>![0,6].includes(new Date(b.t*1000).getUTCDay())); };
    db.stocks=[{id:901,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-09-02',closeDate:'2026-09-04',entryPrice:100,exitPrice:110,shares:5,closedShares:5,t:[]},
      {id:902,type:'stock',symbol:'MSFT',ls:'L',entryDate:'2026-09-02',closeDate:'2026-09-04',entryPrice:100,exitPrice:110,shares:5,closedShares:2,t:[]}];
    db.crypto=[];switchTab('stocks');renderTable('stock');
  });
  assert.equal(await page.locator('.trade-snapshot-cell').count(),0,'no separate chart column');
  await page.locator('#cam-btn-stock-901').click();
  await page.locator('#ss-grid .ss-auto-chart img').waitFor();
  const source=await page.locator('#ss-grid .ss-auto-chart img').getAttribute('src');
  await page.locator('#ss-grid .ss-setup-review').waitFor();
  assert.match(source,/^data:image\/png;base64,/);
  if(process.env.TRADE_SNAPSHOT_REVIEW) await page.screenshot({path:process.env.TRADE_SNAPSHOT_REVIEW,animations:'disabled'});
  await page.locator('#ss-grid .ss-auto-chart-button').click();await page.locator('#ss-lightbox.open').waitFor();
  await page.evaluate(()=>closeLightbox());
  await page.evaluate(async source=>{await saveScreenshot('manual-photo',{key:'manual-photo',tradeKey:'stock-901',dataURL:source,timestamp:Date.now(),name:'manual'});await renderSSGrid();},source);
  assert.equal(await page.locator('#ss-grid .ss-thumb-wrap').count(),0,'modal shows only the automatic chart');
  assert.equal(await page.evaluate(async()=> (await getScreenshots('stock-901')).length),1,'previous manual attachments remain stored');
  assert.equal(await page.locator('#ss-drop-zone, #ss-file-input, #ss-modal .ss-upload-btns').count(),0,'manual upload controls are removed');
  assert.equal(await page.locator('#ss-grid .ss-auto-chart .ss-thumb-del').count(),0,'automatic chart is not deletable as an uploaded screenshot');
  await page.evaluate(()=>{closeSSModal();db.stocks[0].closeDate='2026-09-10';renderTable('stock');});
  await page.locator('#cam-btn-stock-901').click();await page.locator('#ss-grid .ss-auto-chart img').waitFor();
  assert.notEqual(await page.locator('#ss-grid .ss-auto-chart img').getAttribute('src'),source);
  await page.evaluate(()=>closeSSModal());await page.locator('#cam-btn-stock-902').click();
  assert.equal(await page.locator('#ss-grid .ss-auto-chart').count(),0,'partial closure has no completed trade chart');
  await page.evaluate(()=>{
    closeSSModal();
    db.crypto=[{...db.stocks[0],id:901,type:'crypto',symbol:'BTCUSDT.P',entryPrice:0.007672,exitPrice:0.007554}];
    window.__cryptoFeedSymbol='';
    const original=_fetchPivotBars;
    _fetchPivotBars=async symbol=>{window.__cryptoFeedSymbol=symbol;return original(symbol);};
    _tradesScope='all';renderTable('stock');
  });
  await page.locator('#cam-btn-crypto-901').click();
  await page.locator('#ss-grid .ss-auto-chart img').waitFor();
  assert.equal(await page.evaluate(()=>__cryptoFeedSymbol),'BTC-USD','crypto uses a crypto market symbol rather than a stock ticker');
  await page.locator('#ss-grid .ss-auto-chart-button').click();
  await page.locator('#ss-lightbox.open').waitFor();
  await page.evaluate(()=>{closeLightbox();closeSSModal();db.crypto[0].closedShares=2;});
  await page.locator('#cam-btn-crypto-901').click();
  assert.equal(await page.locator('#ss-grid .ss-auto-chart').count(),0,'partial crypto close has no completed chart');

});

test('automatic trade image reports unavailable data and retries without stale account rendering',async t=>{
  const page=await open(t);await login(page);
  await page.evaluate(()=>{
    _fetchPivotBars=async()=>null;
    db.stocks=[{id:903,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-09-02',closeDate:'2026-09-06',entryPrice:100,exitPrice:110,shares:5,closedShares:5,t:[]}];
    db.crypto=[];switchTab('stocks');renderTable('stock');
  });
  await page.locator('#cam-btn-stock-903').click();
  const cell=page.locator('#ss-grid .ss-auto-chart');
  await cell.getByRole('button',{name:/נסה שוב|Retry/}).waitFor();
  await page.evaluate(()=>{
    _fetchPivotBars=()=>new Promise(resolve=>window.__resolveSnapshot=resolve);
  });
  await cell.locator('button').click();
  await page.waitForFunction(()=>!!window.__resolveSnapshot);
  await page.evaluate(()=>{
    _currentUser={id:'different-user'};
    __resolveSnapshot(Array.from({length:10},(_,i)=>({t:Date.parse('2026-09-01T00:00:00Z')/1000+i*86400,o:100,h:115,l:98,c:110})));
  });
  await page.waitForTimeout(150);assert.equal(await cell.locator('img').count(),0);
});

test('trade-chart API path works for two regular accounts and clears the previous account image on sign-out',async t=>{
  const page=await open(t);
  const requests=[];
  const market=Array.from({length:70},(_,i)=>({t:Date.parse('2026-08-01T00:00:00Z')/1000+i*86400,o:100+i*.1,h:102+i*.1,l:98+i*.1,c:101+i*.1,v:100000+i*100})).filter(b=>![0,6].includes(new Date(b.t*1000).getUTCDay()));
  await page.route('**/functions/v1/ohlc*',async route=>{
    requests.push({symbol:new URL(route.request().url()).searchParams.get('symbol'),authorization:route.request().headers().authorization});
    await route.fulfill({contentType:'application/json',body:JSON.stringify({bars:market})});
  });
  const setTrade=async symbol=>{
    await page.evaluate(symbol=>{
      db.stocks=[{id:904,type:'stock',symbol,ls:'L',entryDate:'2026-09-02',closeDate:'2026-09-04',entryPrice:100,exitPrice:110,shares:5,closedShares:5,t:[]}];db.crypto=[];
      switchTab('stocks');renderTable('stock');
    },symbol);
    await page.locator('#cam-btn-stock-904').click();await page.locator('#ss-grid .ss-auto-chart img').waitFor();
    await page.locator('#ss-grid .ss-auto-chart-button').click();await page.locator('#ss-lightbox.open').waitFor();
    return page.locator('#ss-lightbox-img').getAttribute('src');
  };
  await login(page,'a@example.test');assert.equal(await page.evaluate(()=>_currentUser.id),'user-a');
  const firstImage=await setTrade('AAPL');assert.match(firstImage,/^data:image\/png;base64,/);
  await page.evaluate(()=>authSignOut());
  assert.equal(await page.locator('#ss-lightbox').evaluate(el=>el.classList.contains('open')),false,'sign-out must hide the old account chart');
  assert.equal(await page.locator('#ss-lightbox-img').getAttribute('src'),'','sign-out clears the previous image');
  assert.equal(await page.locator('#ss-modal').evaluate(el=>el.classList.contains('open')),false,'sign-out closes screenshots too');
  await login(page,'b@example.test');assert.equal(await page.evaluate(()=>_currentUser.id),'user-b');
  const secondImage=await setTrade('MSFT');assert.match(secondImage,/^data:image\/png;base64,/);assert.notEqual(secondImage,firstImage);
  assert.deepEqual(requests.map(r=>r.symbol),['AAPL','MSFT']);assert.ok(requests.every(r=>r.authorization==='Bearer test-token'),'uses the regular authenticated session token');
  assert.equal(await page.locator('.trade-snapshot-cell img').count(),0);
});

test('large trade journals paginate rows while keeping full summaries and search',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(()=>{const date=new Date().toISOString().slice(0,10);db.stocks=Array.from({length:250},(_,i)=>({id:50000+i,type:'stock',symbol:i===249?'NVDA':'AAPL',entryDate:date,closeDate:date,entryPrice:100,exitPrice:105,shares:10,closedShares:10,commission:0,ls:'L',t:[]}));switchTab('stocks');});
 assert.equal(await page.locator('#stocks-wrap tr.data-row').count(),100);
 assert.match(await page.locator('#st-stats').innerText(),/250/);
 await page.evaluate(()=>changeTradePage('stock',2));
 assert.equal(await page.locator('#stocks-wrap tr.data-row').count(),50);
 await page.locator('#st-search').fill('NVDA');
 assert.equal(await page.locator('#stocks-wrap tr.data-row').count(),1);
 assert.equal(await page.locator('#stocks-wrap .trade-pagination').count(),0);
 assert.match(await page.locator('#stocks-wrap').innerText(),/NVDA/);
});

test('Market Pulse says so when "Today" is still the previous session, and stays quiet once the session is live', async t => {
  const page = await open(t); await login(page);
  let lastBar = '2000-01-03';
  await page.route('**/functions/v1/theme-tracker', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ts: Date.now(), lastBar, indices: [{ name: 'S&P 500', ticker: 'SPY', today: 0.6, w1: 1, m1: 1, m3: 1, ytd: 1 }], themes: [{ name: 'Tech', ticker: 'XLK', today: 1, w1: 1, m1: 1, m3: 1, ytd: 1 }] }) }));
  await page.evaluate(() => switchTab('themes'));
  await page.waitForFunction(() => document.querySelector('#tt-grid .tt-row'));
  assert.equal(await page.locator('#tt-session-note').isVisible(), true, 'stale session must be announced');
  assert.match(await page.locator('#tt-session-note').textContent(), /03\.01/);
  lastBar = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  await page.evaluate(() => ttLoad(true));
  await page.waitForFunction(() => document.getElementById('tt-session-note').style.display === 'none');
});

test('personal lab creates one experiment, preserves failed draft, reloads and clears on account change', async t => {
 const page = await open(t); await login(page);
 await page.evaluate(() => switchTab('statistics'));
 await revealLab(page);
 await page.locator('[data-lab-template="daily_limit"]').click();
 await page.locator('#lab-target').fill('2');
 await page.locator('[data-lab-action="review"]').click();
 await page.evaluate(() => { window.__test.labFailure = true; });
 await page.locator('[data-lab-action="start"]').click();
 await page.locator('#personal-lab [role="alert"]').waitFor();
 assert.match(await page.locator('#personal-lab').innerText(), /לא אושרה|not confirmed/);
 await page.evaluate(() => { window.__test.labFailure = false; });
 await page.locator('[data-lab-action="start"]').click();
 await page.locator('.lab-active-heading').waitFor();
 assert.equal(await page.evaluate(() => window.__testDB.personal_experiments.filter(x=>x.status==='active').length),1);
 const saved = await page.evaluate(() => window.__testDB.personal_experiments);
 await page.reload();
 await page.evaluate(rows => { window.__testDB.personal_experiments=rows; switchTab('statistics'); },saved);
 await revealLab(page);
 await page.locator('.lab-active-heading').waitFor();
 await page.evaluate(() => { switchTab('overview'); });
 assert.match(await page.locator('#personal-lab-overview').innerText(), /לניסוי שלי|View experiment/);
 await page.evaluate(async () => { await _sb.auth.signOut(); });
 assert.equal(await page.locator('#personal-lab').innerText(),'');
 await login(page,'b@example.test');
 await page.evaluate(() => switchTab('statistics'));
 await revealLab(page);await page.locator('.lab-templates').waitFor();
});

test('personal lab active metrics, missing records, privacy and frozen review work in both languages and themes', async t => {
 const page=await open(t);await login(page);await page.evaluate(()=>{cookieDecline();switchTab('statistics');});
 await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.locator('#personal-lab').screenshot({path:resolve(root,'docs/personal-lab-templates.png')});
 await page.evaluate(()=>{
  const today=labToday('Asia/Jerusalem'), start=labShift(today,-12);
  window.__testDB.personal_experiments=[{id:'lab-review',user_id:'user-a',template:'setup_documented',asset_scope:'stock',target:100,timezone:'Asia/Jerusalem',start_date:start,end_date:labShift(start,30),status:'active',updated_at:'stamp-lab',created_at:start}];
  db.stocks=[{id:91001,type:'stock',symbol:'LAB1',entryDate:labShift(start,1),entryPrice:100,shares:10,exitPrice:110,ls:'L',t:[],setupType:'vcp'}, {id:91002,type:'stock',symbol:'LAB2',entryDate:labShift(start,2),entryPrice:100,shares:10,exitPrice:90,ls:'L',t:[],setupType:''}];
  _dbLoaded=true;labInvalidate();
 });
 await page.waitForFunction(()=>document.querySelector('.lab-metric strong')?.textContent==='50%');
 await page.locator('#personal-lab').screenshot({path:resolve(root,'docs/personal-lab-active.png')});
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 await page.addStyleTag({content:'*,*::before,*::after{transition:none !important;animation:none !important}'});
 for(const width of [1280,1024]) for(const lang of ['he','en']) for(const theme of ['dark','light']) {
  await page.setViewportSize({width,height:1000});
  await page.evaluate(({lang,theme})=>{_applyTheme(theme);setLang(lang);labRender();}, {lang,theme});
  const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2}));assert.equal(result.overflow,false);
  const violations=await page.evaluate(async()=> (await axe.run(document.getElementById('personal-lab'),{runOnly:{type:'rule',values:['color-contrast','label','button-name']}})).violations);
  assert.deepEqual(violations,[]);
 }
 await page.evaluate(()=>{privacyMode=true;applyPrivacy();});
 assert.equal(await page.locator('.lab-metric .sensitive').evaluate(el=>getComputedStyle(el).filter),'blur(6px)');
 // A local journal edit must update the lab immediately, without a realtime echo.
 await page.evaluate(()=>{db.stocks[1].setupType='vcp';renderTable('stock');});
 assert.equal(await page.locator('.lab-metric strong').first().innerText(),'100%');
 await page.evaluate(()=>{
  privacyMode=false;applyPrivacy();setLang('he');_applyTheme('dark');
  const e=window.__testDB.personal_experiments[0],today=labToday(e.timezone);
  e.end_date=today;e.start_date=labShift(today,-30);labInvalidate();
  window.__testDB.trades=db.stocks.map(_tradeToRow).map((row,i)=>({...row,id:91001+i}));
 });
 await page.locator('#lab-note').waitFor();await page.locator('#lab-choice').selectOption('keep');await page.locator('#lab-note').fill('בדקתי תהליך, בלי להסיק הבטחה לרווח.');
 await page.locator('#personal-lab').screenshot({path:resolve(root,'docs/personal-lab-review.png')});
 await page.locator('[data-lab-action="finish"]').click();
 await page.locator('.lab-history').waitFor();await page.locator('.lab-history > summary').click();
 assert.match(await page.locator('.lab-history').innerText(),/צילום נתונים קבוע/);
 assert.match(await page.locator('.lab-history').innerText(),/להמשיך בכלל/);
 const before=await page.evaluate(()=>JSON.stringify(window.__testDB.personal_experiments[0].summary_metrics));
 await page.evaluate(()=>{db.stocks[0].exitPrice=1000;renderTable('stock');});
 assert.equal(await page.evaluate(()=>JSON.stringify(window.__testDB.personal_experiments[0].summary_metrics)),before);
 await page.locator('.lab-history').screenshot({path:resolve(root,'docs/personal-lab-summary.png')});
 await page.reload();await page.evaluate(()=>{cookieDecline();switchTab('statistics');});
 await revealLab(page);
 await page.locator('.lab-history > summary').click();
 assert.match(await page.locator('.lab-history').innerText(),/להמשיך בכלל/);
 assert.equal(await page.evaluate(()=>JSON.stringify(window.__testDB.personal_experiments[0].summary_metrics)),before);
});

test('personal lab retries load failures and preserves review input across refresh and server conflicts', async t => {
 const page=await open(t);await login(page);await page.evaluate(()=>{cookieDecline();switchTab('statistics');});
 await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.waitForFunction(()=>typeof _lab!=='undefined'&&_lab.historyLoaded&&!_lab.pending);
 await page.evaluate(()=>{
  const today=labToday('Asia/Jerusalem');
  window.__testDB.personal_experiments=[{id:'qa-conflict',user_id:'user-a',template:'daily_limit',asset_scope:'stock',target:3,timezone:'Asia/Jerusalem',start_date:labShift(today,-30),end_date:today,status:'active',updated_at:'stamp-old',created_at:today}];
  const original=_sb.from.bind(_sb);let fail=true;
  _sb.from=table=>{if(table==='personal_experiments'&&fail){fail=false;throw Error('simulated SDK failure');}return original(table);};
  labInvalidate();
 });
 await page.locator('#personal-lab [role="alert"]').waitFor().catch(async error=>{console.log('LAB QA STATE',await page.evaluate(()=>({hidden:document.hidden,loaded:_lab.loaded,error:_lab.error,pending:!!_lab.pending,history:_lab.historyLoaded,html:document.getElementById('personal-lab').innerText})));throw error;});
 await page.locator('#personal-lab [data-lab-action="reload"]').click();
 await page.locator('#lab-note').fill('הערה שלא רוצים לאבד');await page.locator('#lab-choice').selectOption('keep');
 await page.evaluate(()=>labLoad({force:true,history:true}));
 assert.equal(await page.locator('#lab-note').inputValue(),'הערה שלא רוצים לאבד');
 await page.evaluate(()=>{
  const original=_sb.rpc.bind(_sb);let conflict=true;
  _sb.rpc=async(name,params)=>{
   if(name==='finish_personal_experiment'&&conflict){conflict=false;window.__testDB.personal_experiments[0].updated_at='stamp-new';return {data:null,error:{code:'PT409'}};}
   return original(name,params);
  };
 });
 await page.locator('[data-lab-action="finish"]').click();
 await page.waitForFunction(()=>document.querySelector('#personal-lab')?.textContent.includes('הניסוי השתנה במכשיר אחר'));
 assert.equal(await page.locator('#lab-note').inputValue(),'הערה שלא רוצים לאבד');assert.equal(await page.locator('#lab-choice').inputValue(),'keep');
 await page.locator('[data-lab-action="finish"]').click();
 await page.locator('.lab-history > summary').click();
 assert.match(await page.locator('.lab-history').innerText(),/להמשיך בכלל/);assert.match(await page.locator('.lab-history').innerText(),/הערה שלא רוצים לאבד/);
});

test('personal lab simplified screen has a clear next action, accessible disclosure and stable keyboard focus', async t=>{
 const page=await open(t);await login(page);await page.evaluate(()=>{cookieDecline();switchTab('statistics');});await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.evaluate(()=>{
  const today=labToday('Asia/Jerusalem');
  window.__testDB.personal_experiments=[{id:'polish-active',user_id:'user-a',template:'setup_documented',asset_scope:'stock',target:100,timezone:'Asia/Jerusalem',start_date:labShift(today,-4),end_date:labShift(today,26),status:'active',updated_at:'polish-stamp',created_at:today}];
  db.stocks=[{id:82001,type:'stock',symbol:'AAPL',entryDate:today,entryPrice:100,shares:2,ls:'L',t:[],setupType:''}];_dbLoaded=true;labInvalidate();
 });
 await page.locator('[data-lab-action="review-missing"]').waitFor();
 assert.equal(await page.locator('.lab-analysis').getAttribute('open'),null);
 assert.equal(await page.locator('.lab-analysis .sensitive').first().isVisible(),false);
 await page.locator('[data-lab-action="review-missing"]').focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('#trade-modal').evaluate(el=>el.classList.contains('open')),true);
 assert.equal(await page.locator('#m-setup-pills button').first().evaluate(el=>el===document.activeElement),true);
 assert.match(await page.locator('#lab-documentation-help').innerText(),/סטאפ/);
 await page.screenshot({path:resolve(root,'docs','personal-lab-documentation.png')});
 await page.evaluate(()=>closeModal());
 assert.equal(await page.locator('#lab-documentation-help').count(),0);
 await page.evaluate(()=>{_lab.active.template='reason_documented';labRender();});
 await page.locator('[data-lab-action="review-missing"]').click();
 assert.equal(await page.locator('#m-er-pills button').first().evaluate(el=>el===document.activeElement),true);
 assert.match(await page.locator('#lab-documentation-help').innerText(),/סיבת הכניסה/);
 await page.evaluate(()=>{closeModal();openModal('stock');});
 assert.equal(await page.locator('#lab-documentation-help').count(),0);
 await page.evaluate(()=>{closeModal();_lab.active.template='setup_documented';labRender();});
 await page.locator('.lab-analysis > summary').focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('.lab-analysis').evaluate(el=>el.open),true);
 await page.evaluate(()=>renderTable('stock'));
 assert.equal(await page.locator('.lab-analysis').evaluate(el=>el.open),true);
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 await page.addStyleTag({content:'*,*::before,*::after{transition:none !important;animation:none !important}'});
 for(const theme of ['dark','light']) {
  await page.evaluate(theme=>_applyTheme(theme),theme);
  const violations=await page.evaluate(async()=>(await axe.run(document.getElementById('personal-lab'),{runOnly:{type:'rule',values:['color-contrast','label','button-name']}})).violations);
  assert.deepEqual(violations,[]);
 }
 const size=await page.locator('[data-lab-action="review-missing"]').boundingBox();assert.ok(size.height>=44);
 await page.setViewportSize({width:1024,height:768});
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
 assert.equal(await page.evaluate(()=>document.getElementById('personal-lab').scrollWidth>document.getElementById('personal-lab').clientWidth+2),false);
});

test('bottom navigation is removed and narrow screens retain top navigation and add trade',async t=>{
 const page=await open(t);await login(page);await page.evaluate(()=>cookieDecline());
 assert.equal(await page.locator('.mobile-nav').count(),0);
 for(const width of [390,768,1280]) {
  await page.setViewportSize({width,height:900});
  await page.locator('#top-nav [onclick*="investments"]').click();await page.locator('#tab-investments.active').waitFor();
  await page.locator('#top-nav [onclick*="stocks"]').click();await page.locator('#tab-stocks.active').waitFor();
  assert.equal(await page.locator('#tab-stocks .table-toolbar .btn-primary').first().isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
 }
});

test('setup suggestion explains evidence, requires confirmation and preserves existing documentation',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(async()=>{
  cookieDecline();await loadTradeSnapshotFeature();
  const trade={id:98201,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-03-15',entryPrice:101,shares:2,t:[],setupType:''};
  db.stocks=[trade];
  window.__setupBars=Array.from({length:40},(_,i)=>({t:Date.parse('2026-02-01')/1000+i*86400,o:96+Math.sin(i),h:100,l:94,c:97+Math.sin(i*.5),v:1000}));
  const host=document.createElement('div');host.id='setup-review-test';document.body.append(host);
  renderTradeSetupSuggestion(host,trade,__setupBars,()=>true);
 });
 assert.match(await page.locator('#setup-review-test').innerText(),/פריצה אפשרית/);
 await page.locator('#setup-review-test button').click();
 assert.equal(await page.locator('#m-setup-type').inputValue(),'breakout');
 assert.equal(await page.evaluate(()=>db.stocks[0].setupType),'','suggestion is not a saved fact');
 await page.evaluate(()=>{
  closeModal();const trade=db.stocks[0];trade.setupType='vcp';
  const host=document.getElementById('setup-review-test');host.replaceChildren();renderTradeSetupSuggestion(host,trade,__setupBars,()=>true);
 });
 await page.locator('#setup-review-test button').click();
 assert.equal(await page.locator('#m-setup-type').inputValue(),'vcp','existing documentation remains authoritative');
 await page.evaluate(()=>{
  closeModal();const host=document.getElementById('setup-review-test');host.replaceChildren();renderTradeSetupSuggestion(host,db.stocks[0],__setupBars,()=>false);
 });
 await page.locator('#setup-review-test button').click();
 assert.equal(await page.locator('#trade-modal').evaluate(el=>el.classList.contains('open')),false,'stale account/view callback cannot open a trade');
});

test('confirming a setup preserves imported fees and custom entry reasons',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(()=>{
  cookieDecline();
  const trade={id:98202,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-03-15',entryPrice:101,shares:2,t:[],setupType:'',entryReason:'My custom broker reason',commission:1.25,ecn:3.75,ibkr_id:'test-import-id'};
  db.stocks=[trade];window.__testDB.trades=[{..._tradeToRow(trade),id:trade.id,user_id:'user-a'}];
  openModal('stock',trade);modalSetSetup('breakout');
 });
 await page.locator('#trade-modal [onclick="saveTrade()"]').click();
 await page.locator('#trade-modal.open').waitFor({state:'hidden'});
 const row=await page.evaluate(()=>window.__testDB.trades[0]);
 assert.equal(row.setup_type,'breakout');assert.equal(row.ecn,3.75);assert.equal(row.commission,1.25);
 assert.equal(row.entry_reason,'My custom broker reason');assert.equal(row.ibkr_id,'test-import-id');assert.equal(row.entry_price,101);
});

test('a cached chart and setup explanation use the same market history and refresh together',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(async()=>{
  cookieDecline();await loadTradeSnapshotFeature();window.__chartBuilds=0;
  const trade={id:98203,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:101,exitPrice:102,shares:2,closedShares:2,t:[]};db.stocks=[trade];
  window.__historyVersion=0;
  _fetchPivotBars=async()=>Array.from({length:40},(_,i)=>({t:Date.parse('2026-02-01')/1000+i*86400,o:96+Math.sin(i),h:100+__historyVersion,l:94,c:97+Math.sin(i*.5),v:1000}));
  tradeSnapshotImage=async()=>{__chartBuilds++;const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle=__historyVersion?'red':'blue';ctx.fillRect(0,0,2,2);return canvas.toDataURL();};
  switchTab('stocks');await openSSModal('stock-98203','AAPL');
 });
 await page.locator('.ss-setup-review').waitFor();
 assert.match(await page.locator('.ss-setup-review').innerText(),/1.0%/);
 await page.evaluate(async()=>{__historyVersion=1;await renderSSGrid();});
 await page.locator('.ss-setup-review').waitFor();
 assert.match(await page.locator('.ss-setup-review').innerText(),/1.0%/,'cached explanation must describe the cached image');
 assert.equal(await page.evaluate(()=>__chartBuilds),1);
 await page.evaluate(async()=>{for(const cached of _tradeSnapshotImages.values())cached.expiresAt=0;await renderSSGrid();});
 await page.locator('.ss-setup-review').waitFor();
 assert.equal(await page.evaluate(()=>__chartBuilds),2);
 assert.match(await page.locator('.ss-setup-review').innerText(),/0.0%/);
});

test('personal lab automatically analyzes closed trades without opening the camera or entering a setup',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(()=>{cookieDecline();switchTab('statistics');});await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.evaluate(()=>{
  _fetchPivotBars=async()=>Array.from({length:55},(_,i)=>({t:Date.parse('2026-02-01')/1000+i*86400,o:96+Math.sin(i),h:100,l:94,c:97+Math.sin(i*.5),v:1000}));
  db.stocks=[{id:98301,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:101,exitPrice:102,shares:2,closedShares:2,t:[],setupType:''}];db.crypto=[];_dbLoaded=true;labRender();
 });
 await page.locator('#lab-auto-analysis .ss-setup-review').waitFor();
 assert.match(await page.locator('#lab-auto-analysis').innerText(),/פריצה אפשרית/);
 assert.equal(await page.locator('#lab-auto-analysis .lab-auto-chart').count(),1);
 assert.equal(await page.locator('#lab-auto-analysis .lab-auto-chart').evaluate(el=>el.open),false);
 assert.equal(await page.locator('#lab-auto-analysis img').count(),0,'charts do not crowd the initial results');
 await page.locator('#lab-auto-analysis .lab-auto-chart > summary').focus();await page.keyboard.press('Enter');
 await page.locator('#lab-auto-analysis img').waitFor();
 await page.evaluate(()=>labRender());
 await page.locator('#lab-auto-analysis img').waitFor();
 assert.equal(await page.locator('#lab-auto-analysis .lab-auto-chart').evaluate(el=>el.open),true,'chart disclosure survives refresh');
 assert.equal(await page.locator('#ss-modal.open').count(),0);
 assert.equal(await page.evaluate(()=>db.stocks[0].setupType),'');
 await page.evaluate(()=>{db.stocks[0].setupType='vcp';labRender();});
 await page.locator('.lab-entry-coach').waitFor({state:'attached'});
 assert.equal(await page.locator('.lab-entry-coach').isVisible(),false,'coaching stays folded until requested');
 assert.equal(await page.locator('.lab-structure-review > summary').isVisible(),false,'structural detail does not add another top-level action');
 await page.locator('.lab-auto-explanation > summary').click();
 await page.locator('.lab-structure-review > summary').click();
 assert.match(await page.locator('.lab-structure-review').innerText(),/ממוצע פשוט 21|אין מספיק נתונים/);
 assert.match(await page.locator('.lab-entry-coach').innerText(),/מה זוהה[\s\S]*למה זה חשוב[\s\S]*בפעם הבאה/);
 assert.equal(await page.evaluate(()=>db.stocks[0].setupType),'vcp','coaching never rewrites documentation');
 await page.evaluate(()=>{_currentUser={id:'other-user'};resetPersonalLab();});
 assert.equal(await page.locator('#lab-auto-analysis').count(),0);
});

test('personal lab ignores delayed analysis after account changes and bounds chart loading',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(()=>{cookieDecline();switchTab('statistics');});await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.evaluate(async()=>{
  await loadTradeSnapshotFeature();window.__labRequests=0;window.__labReleases=[];
  _fetchPivotBars=()=>{__labRequests++;return new Promise(resolve=>__labReleases.push(resolve));};
  db.stocks=Array.from({length:6},(_,i)=>({id:98400+i,type:'stock',symbol:'TEST'+i,ls:'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:101,exitPrice:102,shares:2,closedShares:2,t:[],setupType:''}));db.crypto=[];_dbLoaded=true;labRender();
 });
 await page.waitForFunction(()=>__labRequests===2);
 assert.equal(await page.locator('.lab-auto-trade').count(),4);
 assert.match(await page.locator('.lab-auto-count').innerText(),/4.*6/);
 await page.evaluate(()=>{_currentUser={id:'other-user'};resetPersonalLab();__labReleases.forEach(resolve=>resolve([]));});
 await page.waitForFunction(()=>!document.querySelector('#lab-auto-analysis'));
 assert.equal(await page.evaluate(()=>__labRequests),2,'no further requests for the obsolete account');
});

test('personal lab remains compact, accessible and readable without building hidden charts',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(()=>{cookieDecline();switchTab('statistics');});await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.evaluate(async()=>{
  await loadTradeSnapshotFeature();window.__labImageBuilds=0;
  const image=tradeSnapshotImage;tradeSnapshotImage=(...args)=>{__labImageBuilds++;return image(...args);};
  _fetchPivotBars=async()=>Array.from({length:55},(_,i)=>({t:Date.parse('2026-02-01')/1000+i*86400,o:96+Math.sin(i),h:100,l:94,c:97+Math.sin(i*.5),v:1000}));
  db.stocks=Array.from({length:6},(_,i)=>({id:98500+i,type:'stock',symbol:'TEST'+i,ls:'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:101,exitPrice:102,shares:2,closedShares:2,t:[],setupType:''}));db.crypto=[];_dbLoaded=true;labRender();
 });
 await page.waitForFunction(()=>document.querySelectorAll('#lab-auto-analysis .ss-setup-review').length===4);
 assert.equal(await page.evaluate(()=>__labImageBuilds),0);
 assert.equal(await page.locator('.lab-auto-chart[open]').count(),0);
 for(const card of await page.locator('.lab-auto-trade').all()) assert.ok((await card.boundingBox()).height<340,'summary rows should remain easy to scan');
 await page.locator('.lab-auto-more').click();
 await page.waitForFunction(()=>document.querySelectorAll('#lab-auto-analysis .ss-setup-review').length===6);
 assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'H4','show more should focus the newly revealed trade');
 assert.equal(await page.evaluate(()=>__labImageBuilds),0);
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>_applyTheme(theme),theme);
  assert.deepEqual(await page.evaluate(async()=>(await axe.run(document.getElementById('lab-auto-analysis'),{runOnly:{type:'rule',values:['color-contrast','label','button-name']}})).violations),[]);
 }
 for(const width of [1280,1024,768]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>{const el=document.getElementById('lab-auto-analysis');return el.scrollWidth>el.clientWidth+2;}),false);
 }
 await page.setViewportSize({width:1280,height:1000});
 await page.locator('.lab-auto-chart > summary').first().focus();await page.keyboard.press('Enter');
 await page.locator('.lab-auto-chart img').first().waitFor();assert.equal(await page.evaluate(()=>__labImageBuilds),1);
 await page.mouse.move(0,0); // Hover intentionally reveals sensitive data; test the resting state.
 await page.evaluate(()=>{privacyMode=true;applyPrivacy();});
 assert.notEqual(await page.locator('.lab-auto-chart .ss-auto-chart-button').first().evaluate(el=>getComputedStyle(el).filter),'none');
});

test('personal lab keeps the analysis readable when chart rendering fails and retries in place',async t=>{
 const page=await open(t);await login(page);
 await page.evaluate(()=>{cookieDecline();switchTab('statistics');});await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.evaluate(async()=>{
  await loadTradeSnapshotFeature();window.__chartAttempts=0;const original=tradeSnapshotImage;
  tradeSnapshotImage=async(...args)=>{if(++__chartAttempts===1)throw new Error('mock chart failure');return original(...args);};
  _fetchPivotBars=async()=>Array.from({length:55},(_,i)=>({t:Date.parse('2026-02-01')/1000+i*86400,o:96+Math.sin(i),h:100,l:94,c:97+Math.sin(i*.5),v:1000}));
  db.stocks=[{id:98601,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:101,exitPrice:102,shares:2,closedShares:2,t:[],setupType:''}];db.crypto=[];_dbLoaded=true;labRender();
 });
 await page.locator('.lab-auto-chart > summary').click();
 await page.locator('.lab-auto-chart button').waitFor();
 assert.match(await page.locator('.lab-auto-chart').innerText(),/הגרף אינו זמין/);
 assert.match(await page.locator('#lab-auto-analysis .ss-setup-review').innerText(),/פריצה אפשרית/);
 await page.locator('.lab-auto-chart button').click();await page.locator('.lab-auto-chart img').waitFor();
 assert.equal(await page.evaluate(()=>__chartAttempts),2);
});

test('personal comparison shows real cohort counts, explains evidence and links both outcomes',async t=>{
 const page=await open(t);await login(page);await page.evaluate(()=>{cookieDecline();switchTab('statistics');});await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.evaluate(()=>{
  _fetchPivotBars=async()=>Array.from({length:55},(_,i)=>({t:Date.parse('2026-02-01')/1000+i*86400,o:96+Math.sin(i),h:100,l:94,c:97+Math.sin(i*.5),v:1000}));
  db.stocks=Array.from({length:10},(_,i)=>({id:99500+i,type:'stock',symbol:'COHORT'+i,ls:'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:i<5?101:106,exitPrice:i<5?110:95,shares:2,closedShares:2,t:[],setupType:'vcp'}));db.crypto=[];_dbLoaded=true;_labAuto.limit=12;labRender();
 });
 await page.waitForFunction(()=>document.querySelector('.lab-personal-comparison')?.textContent.includes('1.0%'));
 const section=page.locator('.lab-personal-comparison');
 assert.equal(await section.evaluate(el=>el.tagName),'DETAILS');
 assert.equal(await section.evaluate(el=>el.open),false);
 await section.locator(':scope > summary').click();
 const text=await section.innerText();
 assert.match(text,/1\.0%/);assert.match(text,/6\.0%/);assert.match(text,/5 עסקאות מרוויחות/);assert.match(text,/5 עסקאות מפסידות/);
 const review=page.locator('.ss-setup-review').first();
 assert.doesNotMatch(await review.innerText(),/השיא המחושב/);
 assert.ok((await review.innerText()).length<200);
 await review.locator('.lab-auto-explanation > summary').click();
 assert.match(await review.innerText(),/השיא המחושב אינו נקודת פריצה מאומתת/);
 const examples=section.locator('[data-lab-example]');assert.equal(await examples.count(),2);
 for(let i=0;i<2;i++){const button=examples.nth(i),key=await button.getAttribute('data-lab-example');await button.click();assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-lab-trade-key]')?.dataset.labTradeKey),key);}
 await page.evaluate(()=>{_currentUser={id:'other-user'};resetPersonalLab();});assert.equal(await page.locator('.lab-personal-comparison').count(),0);
});

test('lab conclusions show reviewed coverage, trace examples and never call a non-match a verified mistake',async t=>{
 const page=await open(t);await login(page);await page.evaluate(()=>{cookieDecline();switchTab('statistics');});await revealLab(page);await page.locator('.lab-templates').waitFor();
 await page.evaluate(()=>{
  _fetchPivotBars=async()=>Array.from({length:55},(_,i)=>({t:Date.parse('2026-02-01')/1000+i*86400,o:96+Math.sin(i),h:100,l:94,c:97+Math.sin(i*.5),v:1000}));
  db.stocks=Array.from({length:6},(_,i)=>({id:99000+i,type:'stock',symbol:'TEST'+i,ls:i===2?'S':'L',entryDate:'2026-03-15',closeDate:'2026-03-16',entryPrice:i>=4?105:101,exitPrice:102,shares:2,closedShares:2,t:[],setupType:''}));db.crypto=[];_dbLoaded=true;labRender();
 });
 await page.locator('#lab-review-summary > details.lab-recurring-observations').waitFor();
 const summary=await page.locator('#lab-review-summary').innerText();
 assert.match(summary,/4.*6/);assert.match(summary,/סיכום חלקי/);assert.match(summary,/1 ללא מספיק מידע/);
 const primary=page.locator('.lab-primary-finding');
 assert.equal(await primary.locator('h3').innerText(),'לפני העסקה הבאה');
 assert.match(await primary.innerText(),/נקודת הפריצה שתכננת/);
 assert.ok((await primary.innerText()).length<450,'the main finding should stay concise');
 await page.locator('#lab-review-summary > details.lab-recurring-observations > summary').click();
 assert.match(await page.locator('#lab-review-summary').innerText(),/2 מתוך 3/);
 assert.match(await page.locator('#lab-review-summary').innerText(),/אינה הוכחה לטעות/);
 assert.doesNotMatch(await page.locator('#lab-review-summary').innerText(),/טעויות מאומתות|100% דיוק/);
 await page.evaluate(()=>{document.getElementById('lab-trades-disclosure').open=false;});
 const example=page.locator('#lab-review-summary [data-lab-example]').first();const key=await example.getAttribute('data-lab-example');await example.click();
 assert.equal(await page.locator('#lab-trades-disclosure').evaluate(el=>el.open),true);
 assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-lab-trade-key]')?.dataset.labTradeKey),key);
 await page.evaluate(()=>labRender());await page.locator('#lab-review-summary > details.lab-recurring-observations').waitFor();
 assert.equal(await page.locator('#lab-review-summary > details.lab-recurring-observations').evaluate(el=>el.open),true);
 await page.evaluate(()=>{_currentUser={id:'other-user'};resetPersonalLab();});
 assert.equal(await page.locator('#lab-review-summary').count(),0);
});
