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


test('desktop keyboard focus, settings order and zoomed navigation', async t => {
 const page=await open(t); await login(page);
 await page.evaluate(()=>switchTab('ibkr'));
 await page.addStyleTag({content:'*, *::before, *::after { animation:none !important; transition:none !important; }'});
 const account=await page.locator('.settings-account').boundingBox();
 const security=await page.locator('.s-section').filter({has:page.locator('[data-i18n="set_security"]')}).boundingBox();
 assert.ok(account.y<=security.y,'account appears first visually');
 for(const theme of ['dark','light']) {
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await page.locator('#profile-first').focus();
 await page.keyboard.press('Tab');
 const focus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineStyle}));
 
 assert.notEqual(focus.outline,'none','keyboard focus has a visible outline: '+theme);
 }
 await page.evaluate(()=>switchTab('stocks'));
 await page.locator('#trade-secondary-actions summary').focus();
 await page.keyboard.press('Enter');
 assert.equal(await page.locator('#trade-secondary-actions').getAttribute('open'),'');
 await page.keyboard.press('Enter');
 assert.equal(await page.locator('#trade-secondary-actions').getAttribute('open'),null);
 const add=page.locator('#tab-stocks .table-toolbar [data-i18n="add_new_trade"]');
 await add.focus(); await page.keyboard.press('Enter');
 assert.equal(await page.locator('#trade-modal [role="dialog"]').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'m-symbol');
 await page.keyboard.press('Escape');
 assert.equal(await add.evaluate(el=>el===document.activeElement),true);
 // 200% browser zoom has half the CSS viewport width on the same desktop screen.
 await page.setViewportSize({width:720,height:450});
 for(const name of ['overview','stocks','statistics','themes','missed','ibkr','investments','screener']) {
 await page.evaluate(name=>switchTab(name),name);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'no page overflow at 200%: '+name);
 }
});
