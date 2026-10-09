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
async function investments(page) {
  await page.locator('[onclick="switchTab(\'investments\',this)"]:visible').first().click();
  await page.locator('#inv-tbody .inv-sym-chip').first().waitFor();
}

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
  await page.locator('.mnav-btn[data-tab="investments"]').click();
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
        await toggle.click();
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
