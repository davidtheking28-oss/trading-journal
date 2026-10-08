const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright');
async function main() {
  const root = 'C:/Users/david/stock-screener';
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]);
    const file = root + name;
    if (!file.startsWith(root + '/') || name.includes('..')) { res.writeHead(403).end(); return; }
    try { res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(8791, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:8791/') ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:8791/' + encodeURIComponent('מסנן-מניות.html'));
    await page.waitForFunction("typeof applyFilters === 'function' && typeof C === 'object'");
    const results = await page.evaluate(fs.readFileSync(root + '/tests/assertions.js', 'utf8'));
    console.log(JSON.stringify({ screenerTests: results.length, passed: results.filter(r => r.pass).length, failures: results.filter(r => !r.pass) }));
    await page.close();
    for (const url of ['https://davidtheking28-oss.github.io/trading-journal/', 'https://davidtheking28-oss.github.io/stock-screener/']) {
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const live = await context.newPage();
        const errors = [];
        live.on('pageerror', e => errors.push(e.message));
        await live.goto(url, { waitUntil: 'load', timeout: 60000 });
        samples.push(await live.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource');
          return { ttfb: Math.round(n.responseStart - n.requestStart), fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0), load: Math.round(n.loadEventEnd), requests: resources.length, reportedTransferBytes: resources.reduce((a, r) => a + r.transferSize, 0) };
        }));
        samples[samples.length - 1].errors = errors;
        await context.close();
      }
      console.log(JSON.stringify({ url, samples }));
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
