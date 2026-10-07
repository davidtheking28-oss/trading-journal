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
    if (url.includes('chart.js@')) return route.fulfill({ contentType: 'text/javascript', body: 'window.Chart=class { static defaults={};static getChart(){return null} constructor(el,cfg){this.data=cfg.data;this.options=cfg.options;this.canvas=el;} update(){}destroy(){} };' });
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
