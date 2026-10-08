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
    const report=[];
    for(const width of [768,820,1024,1180,1440]) {
      await page.setViewportSize({width,height:900});
      const checks=await page.evaluate(fs.readFileSync('C:/Users/david/stock-screener/tests/desktop.js','utf8'));
      report.push({width,total:checks.length,failed:checks.filter(c=>!c.pass)});
    }
    fs.writeFileSync('docs/screener-comprehensive-layout.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    assert.ok(report.every(r=>r.failed.length===0));assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
