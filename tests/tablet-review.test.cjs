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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
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

test('tablet 768 tabs render empty and representative data in both themes', async t => {
  const page = await open(t); await page.setViewportSize({ width: 768, height: 1180 });
  const innerWidthFixture=await page.evaluate(()=>innerWidth); await login(page); await page.evaluate(() => cookieDecline());
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
    assert.equal(await page.locator('#top-nav').isVisible(),true,'tablet exposes full navigation'); for (const tab of ['overview','stocks','statistics','themes','missed','ibkr','investments','screener']) {
      await page.evaluate(tab => switchTab(tab), tab);
      await page.waitForTimeout(200);
      await page.evaluate(() => { document.getElementById('main-content').scrollTop = 0; });
      assert.equal(await page.locator('#tab-'+tab).isVisible(), true);
      for (const theme of ['dark','light']) {
        await page.evaluate(theme => _applyTheme(theme),theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, tab+' page overflow');
        if(process.env.DESKTOP_REVIEW_DIR) await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/768-'+tab+'-'+(populated?'data':'empty')+'-'+theme+'.png',animations:'disabled',timeout:15000});
      }
      if (tab === 'stocks' && populated) {
        const table = await page.locator('#stocks-wrap table').boundingBox();
        const lastHeader = await page.locator('#stocks-wrap th').last().boundingBox();
        if(innerWidthFixture!==768) assert.ok(Math.abs(table.x-lastHeader.x) < 3, 'no unused column at the table edge');
        if(innerWidthFixture!==768) assert.ok(lastHeader.width < table.width * 0.2, 'actions do not consume the spare table width');

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
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
        if(innerWidthFixture!==768) assert.equal(await page.locator('#st-archive-btn').isVisible(), true);
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
      }
      if (tab === 'investments' && populated && innerWidthFixture!==768) {
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
      if (tab === 'statistics' && populated && innerWidthFixture!==768) {
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
        await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/768-'+tab+'-'+(populated?'data':'empty')+'-bottom.png',animations:'disabled',timeout:15000});
      }
      if(process.env.DESKTOP_REVIEW_DIR) console.log(tab, populated?'data':'empty', (await page.locator('#tab-'+tab).innerText()).slice(0,550));
    }
    if(populated) {
      await page.evaluate(() => { _tradesScope='crypto';switchTab('stocks'); });
      assert.match(await page.locator('#stocks-wrap').innerText(),/BTC/);
    }
  }
});

test('tablet 820 tabs render empty and representative data in both themes', async t => {
  const page = await open(t); await page.setViewportSize({ width: 820, height: 1180 });
  const innerWidthFixture=await page.evaluate(()=>innerWidth); await login(page); await page.evaluate(() => cookieDecline());
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
    assert.equal(await page.locator('#top-nav').isVisible(),true,'tablet exposes full navigation'); for (const tab of ['overview','stocks','statistics','themes','missed','ibkr','investments','screener']) {
      await page.evaluate(tab => switchTab(tab), tab);
      await page.waitForTimeout(200);
      await page.evaluate(() => { document.getElementById('main-content').scrollTop = 0; });
      assert.equal(await page.locator('#tab-'+tab).isVisible(), true);
      for (const theme of ['dark','light']) {
        await page.evaluate(theme => _applyTheme(theme),theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, tab+' page overflow');
        if(process.env.DESKTOP_REVIEW_DIR) await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/820-'+tab+'-'+(populated?'data':'empty')+'-'+theme+'.png',animations:'disabled',timeout:15000});
      }
      if (tab === 'stocks' && populated) {
        const table = await page.locator('#stocks-wrap table').boundingBox();
        const lastHeader = await page.locator('#stocks-wrap th').last().boundingBox();
        if(innerWidthFixture!==768) assert.ok(Math.abs(table.x-lastHeader.x) < 3, 'no unused column at the table edge');
        if(innerWidthFixture!==768) assert.ok(lastHeader.width < table.width * 0.2, 'actions do not consume the spare table width');

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
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
        if(innerWidthFixture!==768) assert.equal(await page.locator('#st-archive-btn').isVisible(), true);
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
      }
      if (tab === 'investments' && populated && innerWidthFixture!==768) {
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
      if (tab === 'statistics' && populated && innerWidthFixture!==768) {
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
        await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/820-'+tab+'-'+(populated?'data':'empty')+'-bottom.png',animations:'disabled',timeout:15000});
      }
      if(process.env.DESKTOP_REVIEW_DIR) console.log(tab, populated?'data':'empty', (await page.locator('#tab-'+tab).innerText()).slice(0,550));
    }
    if(populated) {
      await page.evaluate(() => { _tradesScope='crypto';switchTab('stocks'); });
      assert.match(await page.locator('#stocks-wrap').innerText(),/BTC/);
    }
  }
});

test('tablet 1024 tabs render empty and representative data in both themes', async t => {
  const page = await open(t); await page.setViewportSize({ width: 1024, height: 820 });
  const innerWidthFixture=await page.evaluate(()=>innerWidth); await login(page); await page.evaluate(() => cookieDecline());
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
    assert.equal(await page.locator('#top-nav').isVisible(),true,'tablet exposes full navigation'); for (const tab of ['overview','stocks','statistics','themes','missed','ibkr','investments','screener']) {
      await page.evaluate(tab => switchTab(tab), tab);
      await page.waitForTimeout(200);
      await page.evaluate(() => { document.getElementById('main-content').scrollTop = 0; });
      assert.equal(await page.locator('#tab-'+tab).isVisible(), true);
      for (const theme of ['dark','light']) {
        await page.evaluate(theme => _applyTheme(theme),theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, tab+' page overflow');
        if(process.env.DESKTOP_REVIEW_DIR) await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/1024-'+tab+'-'+(populated?'data':'empty')+'-'+theme+'.png',animations:'disabled',timeout:15000});
      }
      if (tab === 'stocks' && populated) {
        const table = await page.locator('#stocks-wrap table').boundingBox();
        const lastHeader = await page.locator('#stocks-wrap th').last().boundingBox();
        if(innerWidthFixture!==768) assert.ok(Math.abs(table.x-lastHeader.x) < 3, 'no unused column at the table edge');
        if(innerWidthFixture!==768) assert.ok(lastHeader.width < table.width * 0.2, 'actions do not consume the spare table width');

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
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
        if(innerWidthFixture!==768) assert.equal(await page.locator('#st-archive-btn').isVisible(), true);
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
      }
      if (tab === 'investments' && populated && innerWidthFixture!==768) {
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
      if (tab === 'statistics' && populated && innerWidthFixture!==768) {
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
        await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/1024-'+tab+'-'+(populated?'data':'empty')+'-bottom.png',animations:'disabled',timeout:15000});
      }
      if(process.env.DESKTOP_REVIEW_DIR) console.log(tab, populated?'data':'empty', (await page.locator('#tab-'+tab).innerText()).slice(0,550));
    }
    if(populated) {
      await page.evaluate(() => { _tradesScope='crypto';switchTab('stocks'); });
      assert.match(await page.locator('#stocks-wrap').innerText(),/BTC/);
    }
  }
});

test('tablet 1180 tabs render empty and representative data in both themes', async t => {
  const page = await open(t); await page.setViewportSize({ width: 1180, height: 820 });
  const innerWidthFixture=await page.evaluate(()=>innerWidth); await login(page); await page.evaluate(() => cookieDecline());
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
    assert.equal(await page.locator('#top-nav').isVisible(),true,'tablet exposes full navigation'); for (const tab of ['overview','stocks','statistics','themes','missed','ibkr','investments','screener']) {
      await page.evaluate(tab => switchTab(tab), tab);
      await page.waitForTimeout(200);
      await page.evaluate(() => { document.getElementById('main-content').scrollTop = 0; });
      assert.equal(await page.locator('#tab-'+tab).isVisible(), true);
      for (const theme of ['dark','light']) {
        await page.evaluate(theme => _applyTheme(theme),theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, tab+' page overflow');
        if(process.env.DESKTOP_REVIEW_DIR) await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/1180-'+tab+'-'+(populated?'data':'empty')+'-'+theme+'.png',animations:'disabled',timeout:15000});
      }
      if (tab === 'stocks' && populated) {
        const table = await page.locator('#stocks-wrap table').boundingBox();
        const lastHeader = await page.locator('#stocks-wrap th').last().boundingBox();
        if(innerWidthFixture!==768) assert.ok(Math.abs(table.x-lastHeader.x) < 3, 'no unused column at the table edge');
        if(innerWidthFixture!==768) assert.ok(lastHeader.width < table.width * 0.2, 'actions do not consume the spare table width');

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
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
        if(innerWidthFixture!==768) assert.equal(await page.locator('#st-archive-btn').isVisible(), true);
        if(innerWidthFixture!==768) await page.locator('#trade-secondary-actions summary').click();
      }
      if (tab === 'investments' && populated && innerWidthFixture!==768) {
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
      if (tab === 'statistics' && populated && innerWidthFixture!==768) {
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
        await page.screenshot({path:process.env.DESKTOP_REVIEW_DIR+'/1180-'+tab+'-'+(populated?'data':'empty')+'-bottom.png',animations:'disabled',timeout:15000});
      }
      if(process.env.DESKTOP_REVIEW_DIR) console.log(tab, populated?'data':'empty', (await page.locator('#tab-'+tab).innerText()).slice(0,550));
    }
    if(populated) {
      await page.evaluate(() => { _tradesScope='crypto';switchTab('stocks'); });
      assert.match(await page.locator('#stocks-wrap').innerText(),/BTC/);
    }
  }
});


test('tablet quick trade dialog fits portrait and landscape', async t => {
  const page = await open(t);
  await login(page);
  await page.evaluate(() => cookieDecline());
  for (const viewport of [{width:768,height:1180},{width:1024,height:820}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => fabToggle());
    await page.locator('#qa-modal').waitFor({state:'visible'});
    await page.locator('#qa-symbol').click();
    const bounds = await page.locator('#qa-modal .modal').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
    assert.ok(bounds.height <= viewport.height);
    const field = await page.locator('#qa-symbol').evaluate(el => ({height:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize)}));
    assert.ok(field.height >= 44 && field.font >= 16, JSON.stringify(field));
    await page.locator('#qa-symbol').fill('AAPL');
    await page.locator('#qa-entry').fill('100');
    await page.locator('#qa-shares').fill('10');
    await page.locator('#qa-modal [aria-label="סגור"]').click();
    await page.locator('#qa-modal').waitFor({state:'hidden'});
  }
});


