const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
async function main() {
  const source = process.argv[2] || 'C:/Users/david/stock-screener/מסנן-מניות.html';
  const server = http.createServer((req,res) => {
    if(req.url.startsWith('/app')) {res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(source));}
    else { const file=path.resolve('C:/Users/david/stock-screener',decodeURIComponent(req.url).replace(/^\//,''));
      if(!file.startsWith('C:\\Users\\david\\stock-screener\\')) {res.writeHead(403).end();return;}
      try{res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();} }
  });
  await new Promise(resolve=>server.listen(8792,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8792/')?r.continue():r.abort());
    await page.goto('http://127.0.0.1:8792/app');
    await page.waitForFunction("typeof checkAndSaveHistory==='function'");
    await page.evaluate(()=>{window.__scanCalls=0;scan=()=>{window.__scanCalls++;};});
    for(const width of [768,820,1024,1180]) {
      await page.setViewportSize({width,height:820});
      for(const screener of ['sepa','power','vcp','cleanbase','qulla','finviz','growth','commodities']) {
        await page.evaluate(key=>{setMode('screen');setScreener(key);$('filterPanel').classList.remove('open');$('resultsPanel').style.display='none';},screener);
        assert.equal(await page.locator('#scanBtnPanel').isVisible(),true,`${width} ${screener} collapsed scan action`);
        await page.locator('#scanBtnPanel').click();
      }
      await page.evaluate(()=>{setMode('watch');$('filterPanel').classList.remove('open');});
      await page.locator('#scanBtnPanel').click();
      assert.equal(await page.evaluate(()=>mode),'screen');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    assert.equal(await page.evaluate(()=>__scanCalls),36);
    await page.screenshot({path:'C:/Users/david/.codex/visualizations/2026/10/07/01a115e6-dc97-7531-898c-51ac761a03aa/screener-tablet-scan-fixed.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: 32 collapsed-filter scan clicks, 4 watchlist-to-scan clicks, 4 tablet widths');
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

