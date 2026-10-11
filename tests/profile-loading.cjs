// Opt-in local comparison. Never connects to real accounts or market APIs.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve, extname, sep } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const baseline = '9738a37';
const sdk = readFileSync(resolve(__dirname, 'fixtures/supabase-browser.js'), 'utf8');
const historic = new Map(['dashboard.html', 'assets/js/auth.js', 'assets/js/dashboard.js', 'assets/js/investments.js', 'assets/js/bootstrap.js'].map(path => [path, execFileSync('git', ['show', baseline + ':' + path], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })]));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

(async () => {
  let browser;
  const server = createServer((req, res) => {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) return res.writeHead(403).end();
    try {
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
      res.end(readFileSync(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    let realCharts;
    if (process.env.PROFILE_REAL_CHARTS) {
      const response = await fetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Chart library download failed: ' + response.status);
      realCharts = await response.text();
    }
    browser = await chromium.launch({ headless: true });
    const samples = [];
    for (let pair = 0; pair < 6; pair++) {
      for (const variant of pair % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          const client = await context.newCDPSession(page);
          await client.send('Performance.enable');
          await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await page.addInitScript(() => { sessionStorage.setItem('test-user', 'user-a'); sessionStorage.setItem('tj_active_tab', 'overview'); });
          if (process.env.PROFILE_LAYOUT_READS) await page.addInitScript(() => {
            window.__layoutReads = [];
            const record = (name, started) => {
              const ms = performance.now() - started;
              if (ms > 2) __layoutReads.push({ name, ms, stack: new Error().stack });
            };
            const computed = window.getComputedStyle;
            window.getComputedStyle = function(...args) { const start = performance.now(); const value = computed.apply(this, args); record('getComputedStyle', start); return value; };
            for (const name of ['offsetHeight', 'offsetWidth', 'offsetParent']) {
              const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
              Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, get() { const start = performance.now(); const value = descriptor.get.call(this); record(name, start); return value; } });
            }
          });
          let scriptBytes = 0;
          await page.route('**/*', async route => {
            const url = route.request().url();
            if (url.includes('supabase-js@')) return route.fulfill({ contentType: 'text/javascript', body: sdk + '\nwindow.__testDB.trades=Array.from({length:500},(_,i)=>({id:10000+i,user_id:"user-a",type:"stock",symbol:"DEMO"+i,entry_date:"2026-10-01",entry_price:100,shares:10,close_date:"2026-10-02",closed_shares:10,exit_price:105,ls:"L",targets:[],commission:1}));' });
            if (url.includes('chart.js@')) return route.fulfill({ contentType: 'text/javascript', body: realCharts || 'window.Chart=class {static defaults={};static getChart(){return null}constructor(el,cfg){this.data=cfg.data;this.options=cfg.options;this.canvas=el;}update(){}resize(){}destroy(){}};' });
            if (!url.startsWith(base)) return route.fulfill({ contentType: 'application/json', body: '{}' });
            const path = new URL(url).pathname.slice(1);
            if (historic.has(path) || path.startsWith('assets/js/')) {
              let body = variant === 'baseline' && historic.has(path) ? historic.get(path) : readFileSync(resolve(root, path), 'utf8');
              if (path === 'dashboard.html') body = body.replaceAll('__SUPABASE_URL__', 'https://test.supabase.co').replaceAll('__SUPABASE_ANON__', 'test-key').replace(/integrity="[^"]*"/g, '');
              if (path === 'assets/js/auth.js') body = body.replace('_logBootTiming(_bootT0);', 'window.__profileBoot={authMs:_bootT0,readyMs:performance.now()};');
              if (path.endsWith('.js')) scriptBytes += Buffer.byteLength(body);
              return route.fulfill({ contentType: path.endsWith('.html') ? 'text/html' : 'text/javascript', body });
            }
            await route.continue();
          });
          await page.goto(base + '/dashboard.html');
          await page.waitForFunction(() => !!window.__profileBoot);
          const sample = await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const nav = performance.getEntriesByType('navigation')[0];
            return { ...__profileBoot, paintOpportunityMs: performance.now(), domContentLoadedMs: nav.domContentLoadedEventEnd, trades: db.stocks.length, ...(window.__layoutReads ? { layoutReads: __layoutReads } : {}) };
          });
          const { metrics } = await client.send('Performance.getMetrics');
          for (const name of ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']) {
            sample[name + 'Ms'] = (metrics.find(metric => metric.name === name)?.value || 0) * 1000;
          }
          if (errors.length) throw new Error(errors.join('\n'));
          if (sample.trades !== 500) throw new Error('Synthetic trades did not load');
          if (pair > 0) samples.push({ variant, pair, ...sample, scriptBytes });
          console.log(variant, pair, Math.round(sample.readyMs), 'ms ready');
        } finally { await context.close(); }
      }
    }
    const summary = Object.fromEntries(['baseline', 'current'].map(variant => {
      const group = samples.filter(sample => sample.variant === variant);
      return [variant, Object.fromEntries(['readyMs', 'paintOpportunityMs', 'domContentLoadedMs', 'scriptBytes', 'ScriptDurationMs', 'LayoutDurationMs', 'RecalcStyleDurationMs', 'TaskDurationMs'].map(key => [key, Math.round(median(group.map(sample => sample[key])))]))];
    }));
    const report = { baseline, cpuSlowdown: 4, measuredPairs: 5, trades: 500, charts: realCharts ? 'Chart.js 4.4.4 (downloaded once, served locally)' : 'mocked', limitations: 'Local HTTP, mocked authentication and market APIs, no service worker, no WAN latency. Two animation frames are a paint opportunity, not a measured visual-completeness metric. First pair excluded as warm-up.', summary, samples };
    const reportName = realCharts ? 'REAL-CHART-LOADING' : process.env.PROFILE_LAYOUT_READS ? 'LAYOUT-READS' : 'LOADING-PROFILE';
    writeFileSync(resolve(root, 'docs/' + reportName + '-2026-10-11.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(summary));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
