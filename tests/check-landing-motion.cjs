const fs=require('node:fs');const http=require('node:http');const path=require('node:path');const assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{
 const root=process.cwd();const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.woff2')?'font/woff2':file.endsWith('.jpg')?'image/jpeg':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(8797,'127.0.0.1',r));const browser=await chromium.launch();
 try{for(const file of ['index.html','index-en.html']){
  const page=await browser.newPage({viewport:{width:1440,height:900}});await page.addInitScript(()=>{localStorage.setItem('tj_landing_lang_choice','he');localStorage.setItem('cookie-consent','{"accepted":true}');});
  await page.goto('http://127.0.0.1:8797/'+file);await page.evaluate(()=>document.fonts.ready);
  assert.notEqual(await page.locator('.hero-product').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.waitForTimeout(1100);assert.equal(await page.locator('.hero-product').evaluate(el=>getComputedStyle(el).opacity),'1');
  await page.screenshot({path:'C:/Users/david/.codex/visualizations/2026/10/07/01a115e6-dc97-7531-898c-51ac761a03aa/motion-'+file+'.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.hero-product').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.hero-product>a').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  assert.equal(await page.locator('.hero-product').evaluate(el=>getComputedStyle(el).opacity),'1');
  await page.close();console.log(file+': entrance visible; reduced-motion disables new animations');
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
