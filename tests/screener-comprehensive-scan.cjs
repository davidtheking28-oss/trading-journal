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
    const report=await page.evaluate(async()=>{
      const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
      setScreener('finviz');
      const rs=num('rsMin');setFieldValue($('rsMin'),100);
      let calls=0;fetchUniverse=async()=>{calls++;return []};
      await scan(true);check('invalid RS blocks network scan',calls===0);setFieldValue($('rsMin'),rs);
      fetchUniverse=async()=>{throw new Error('Synthetic unavailable')};
      await scan(true);
      check('network failure displays retry',!!$('statBar').querySelector('button'));
      check('failed scan clears skeleton',!$('tableView').querySelector('tbody tr'));
      check('failed scan re-enables scan',!$('scanBtnPanel').disabled&&!$('scanBtn').disabled);
      fetchUniverse=async()=>[];await scan(true);
      check('retry completes empty scan',!$('statBar').textContent.includes('Synthetic unavailable')&&!$('scanBtnPanel').disabled);
      let release;fetchUniverse=()=>new Promise(r=>release=r);const first=scan(true);
      fetchUniverse=async()=>[];await scan(true);const snapshot=$('statBar').textContent;
      release([]);await first;
      check('older scan cannot replace newer status',$('statBar').textContent===snapshot);
      check('newer scan owns enabled controls',!$('scanBtnPanel').disabled);
      return checks;
    });
    fs.writeFileSync('docs/screener-comprehensive-scan.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));assert.ok(report.every(r=>r.pass));assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

