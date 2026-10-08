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

test('tablet accessibility and layout audit', async t => {
 const page=await open(t); await page.setViewportSize({width:820,height:1180});await login(page);await page.evaluate(()=>cookieDecline());
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 const report=[];
 for(const tab of ['overview','stocks','statistics','themes','missed','ibkr','investments','screener']){
  await page.evaluate(tab=>switchTab(tab),tab); await page.waitForTimeout(200);
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>_applyTheme(theme),theme); await page.waitForTimeout(500);
   const audit=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
   report.push({tab,theme,violations:audit});
  }
 }
 require('node:fs').writeFileSync('docs/tablet-accessibility-audit.json',JSON.stringify(report,null,2));
 assert.ok(report.every(r=>r.violations.length===0),'Accessibility violations remain');
});


test('tablet summary and table overflow hints follow the actual layout', async t => {
 const page=await open(t);await login(page);await page.evaluate(()=>cookieDecline());
 await page.evaluate(()=>{const date=new Date();const month=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');db.stocks=[{id:10000,type:'stock',symbol:'AAPL',entryDate:month+'-01',ls:'L',entryPrice:100,shares:10,stop:95,exitPrice:110,closedShares:10,closeDate:month+'-02',t:[],commission:1,ecn:0}];});
 for(const width of [768,820]){
  await page.setViewportSize({width,height:1180});await page.evaluate(()=>switchTab('overview'));await page.waitForTimeout(200);
  const cards=await page.locator('#kpi-grid .kpi-card').evaluateAll(items=>items.map(el=>({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width})));
  assert.equal(cards.length,5);assert.ok(cards[4].width>cards[0].width*1.8,'final KPI fills both columns');
 }
 await page.setViewportSize({width:820,height:1180});await page.evaluate(()=>switchTab('investments'));await page.waitForTimeout(300);
 const wrapper=page.locator('.inv-table-wrap');
 const hint=page.locator('.inv-table-wrap').locator('xpath=preceding-sibling::p[contains(@class,"tablet-scroll-hint")]');
 await wrapper.locator('table').evaluate(el=>el.style.minWidth='1200px');
 await page.waitForFunction(()=>document.querySelector('.inv-table-wrap').previousElementSibling.dataset.overflow==='true');
 assert.equal(await hint.isVisible(),true);
 await page.evaluate(()=>setLang('en'));assert.match(await hint.innerText(),/Scroll horizontally/);
 await wrapper.locator('table').evaluate(el=>{el.style.minWidth='0';el.querySelectorAll('th,td').forEach(cell=>{cell.style.width='auto';cell.style.overflow='hidden';});});
 
 await page.waitForFunction(()=>document.querySelector('.inv-table-wrap').previousElementSibling.dataset.overflow==='false');
 assert.equal(await hint.isVisible(),false);
 await page.evaluate(()=>switchTab('statistics'));
 await page.locator('#monthly-tracker-wrap').focus();
 assert.equal(await page.locator('#monthly-tracker-wrap').evaluate(el=>document.activeElement===el),true);
});






test('tablet populated tab render timing reference', async t => {
 const page=await open(t);await page.setViewportSize({width:820,height:1180});await login(page);await page.evaluate(()=>cookieDecline());
 const timings=await page.evaluate(async()=>{
  const date=new Date(),month=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');
  db.stocks=Array.from({length:200},(_,i)=>({id:20000+i,type:'stock',symbol:['AAPL','MSFT','NVDA'][i%3],entryDate:month+'-01',ls:'L',entryPrice:100,shares:10,stop:95,exitPrice:i%2?110:95,closedShares:10,closeDate:month+'-02',t:[],commission:1,ecn:0}));
  const samples=[];
  for(let round=0;round<5;round++)for(const tab of ['overview','stocks','statistics']){
   const start=performance.now();switchTab(tab);const syncMs=performance.now()-start;
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   samples.push({tab,round,syncMs:Math.round(syncMs*10)/10,throughTwoFramesMs:Math.round((performance.now()-start)*10)/10});
  }
  return samples;
 });
 require('node:fs').writeFileSync('docs/tablet-render-timings.json',JSON.stringify({viewport:'820x1180',syntheticTrades:200,chartLibrary:'mocked',network:'mocked',samples:timings},null,2));
 assert.equal(timings.length,15);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});
