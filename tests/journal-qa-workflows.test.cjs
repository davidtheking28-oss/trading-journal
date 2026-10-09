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


test('trade create, edit, trash and failed-save recovery',async t=>{
 const page=await open(t);await login(page);await page.evaluate(()=>{cookieDecline();switchTab('stocks');db.stocks=[];
 const original=_sb.from.bind(_sb);let id=90000;window.__tradeFail=false;
 _sb.from=table=>{if(table!=='trades')return original(table);let action,row;const chain={insert(v){action='insert';row=v;return chain},update(v){action='update';row=v;return chain},select(){return chain},single(){return chain},eq(){return chain},then(resolve,reject){return Promise.resolve(__tradeFail?{data:null,error:{message:'Synthetic failed write'}}:{data:action==='insert'?{...row,id:++id}:null,error:null}).then(resolve,reject)}};return chain;};});
 await page.evaluate(()=>openModal('stock'));await page.locator('#m-symbol').fill('AAPL');await page.locator('#m-entryPrice').fill('100');await page.locator('#m-shares').fill('10');
 await page.locator('#trade-modal [onclick="saveTrade()"]').click();await page.waitForFunction(()=>db.stocks.length===1);
 assert.equal(await page.evaluate(()=>db.stocks[0].symbol),'AAPL');
 await page.evaluate(()=>editTrade('stock',db.stocks[0].id));await page.locator('#m-entryPrice').fill('105');await page.locator('#trade-modal [onclick="saveTrade()"]').click();await page.waitForFunction(()=>db.stocks[0].entryPrice===105);
 page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>deleteTrade('stock',db.stocks[0].id));assert.equal(await page.evaluate(()=>db.stocks[0].deleted),true);
 await page.evaluate(()=>{openModal('stock');__tradeFail=true;});await page.locator('#m-symbol').fill('MSFT');await page.locator('#m-entryPrice').fill('200');await page.locator('#m-shares').fill('3');
 await page.locator('#trade-modal [onclick="saveTrade()"]').click();await page.waitForTimeout(500);await page.screenshot({path:'C:/Users/david/.codex/visualizations/2026/10/07/01a115e6-dc97-7531-898c-51ac761a03aa/qa-trade-save-failure.png'});
 assert.equal(await page.locator('#trade-modal [role="dialog"]').isVisible(),true,'failed save preserves visible editable form');
 assert.equal(await page.locator('#m-symbol').inputValue(),'MSFT');
 await page.evaluate(()=>__tradeFail=false);await page.locator('#trade-modal [onclick="saveTrade()"]').click();await page.waitForFunction(()=>db.stocks.some(t=>t.symbol==='MSFT'));
});
