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



test('desktop contrast and accessible labels audit', async t=>{
 const page=await open(t);await login(page);await page.evaluate(()=>cookieDecline());
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 await page.addStyleTag({content:'*,*::before,*::after{animation:none !important;transition:none !important}'});
 await page.mouse.move(0,0);
 const findings=[];
 for(const populated of [false,true]) {
 if(populated) await page.evaluate(()=>{
 const date=new Date().toISOString().slice(0,10);
 db.stocks=[{id:70001,symbol:'AAPL',type:'stock',entryDate:date,entryPrice:100,shares:10,closedShares:10,exitPrice:110,closeDate:date,commission:2,ls:'L',t:[]},{id:70002,symbol:'MSFT',type:'stock',entryDate:date,entryPrice:100,shares:10,closedShares:10,exitPrice:90,closeDate:date,commission:2,ls:'L',t:[]}];
 _ttData=[{ticker:'XLK',name:'Technology',today:1.2,w1:2},{ticker:'XLE',name:'Energy',today:-1.2,w1:-2}];_ttIndices=[];
 });
 for(const theme of ['dark','light']) {
 await page.evaluate(theme=>_applyTheme(theme),theme);
 for(const tab of ['overview','stocks','statistics','themes','missed','ibkr','investments']) {
 await page.evaluate(tab=>switchTab(tab),tab);
 const audit=await page.evaluate(()=>axe.run(document.getElementById('app'),{runOnly:{type:'rule',values:['color-contrast','label','button-name']}}));
 for(const v of audit.violations) findings.push({populated,theme,tab,rule:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html}))});
 }
 }
 }
 require('fs').writeFileSync(require('path').resolve(__dirname,'../docs/contrast-audit.json'),JSON.stringify(findings,null,2));
 assert.deepEqual(findings,[], 'contrast and labels must pass');
 console.log(JSON.stringify(findings.map(f=>({...f,nodes:f.nodes.map(n=>({target:n.target,summary:n.summary}))})),null,2));
});
