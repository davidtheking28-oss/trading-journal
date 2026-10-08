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
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8792/')?r.continue():r.abort());
    await page.goto('http://127.0.0.1:8792/app');
    await page.waitForFunction("typeof checkAndSaveHistory==='function'");
    const results=await page.evaluate(fs.readFileSync('C:/Users/david/stock-screener/tests/assertions.js','utf8'));
    const newChecks=await page.evaluate(fs.readFileSync('C:/Users/david/stock-screener/tests/improvements.js','utf8'));
    newChecks.push(...await page.evaluate(fs.readFileSync('C:/Users/david/stock-screener/tests/desktop.js','utf8')));
    const stress=await page.evaluate(async()=>{
      const sample=results[0];const rows=Array.from({length:1000},(_,i)=>({...sample,ticker:'LOAD'+i,sym:'NASDAQ:LOAD'+i,name:'Synthetic load fixture '+i}));
      mode='screen';layout='table';results=rows;allResults=rows;
      const start=performance.now();render();const tableMs=Math.round(performance.now()-start);
      const tableRows=document.querySelectorAll('#tableView tbody tr').length;
      layout='gallery';const galleryStart=performance.now();render();
      for(let i=0;i<120&&document.querySelectorAll('.gcard').length<1000;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
      return {rows:1000,tableMs,tableRows,galleryMs:Math.round(performance.now()-galleryStart),galleryCards:document.querySelectorAll('.gcard').length};
    });
    fs.writeFileSync('docs/screener-render-load.json',JSON.stringify(stress,null,2));
    assert.ok(stress.tableRows>0&&stress.tableRows<=1000);assert.equal(stress.galleryCards,1000);
    if(process.env.SCREENER_A11Y){
      await page.goto('http://127.0.0.1:8792/app');
      await page.waitForFunction("typeof openChart==='function'");
      await page.evaluate(fs.readFileSync('C:/Users/david/stock-screener/tests/desktop.js','utf8'));
      await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
      const audit=[];
      for(const theme of ['tj','tj-light'])for(const key of ['sepa','power','vcp','cleanbase','qulla','finviz','growth','commodities']){
        await page.evaluate(({theme,key})=>{document.documentElement.dataset.theme=theme;mode='screen';layout='table';setScreener(key);render();}, {theme,key});
        await page.waitForTimeout(600);
        audit.push({theme,key,state:'results',...await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};})});
        await page.evaluate(()=>{_modalReturnFocus=document.activeElement;_setBgInert('authModal',true);$('authModal').classList.add('open');$('authEmail').focus();});
        await page.waitForTimeout(600);
        audit.push({theme,state:'login',...await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};})});
        await page.evaluate(()=>closeAuthModal());
      }
      fs.writeFileSync('docs/screener-accessibility.json',JSON.stringify(audit,null,2));
      assert.ok(audit.every(s=>s.violations.length===0),'Accessibility violations remain');
    }
    await page.screenshot({path:'C:/Users/david/.codex/visualizations/2026/10/07/01a115e6-dc97-7531-898c-51ac761a03aa/screener-fixed-desktop.png',fullPage:true});
    console.log(JSON.stringify({existing:{passed:results.filter(r=>r.pass).length,total:results.length,failures:results.filter(r=>!r.pass)},newChecks,errors},null,2));
    assert.equal(errors.length,0);assert.ok(results.every(r=>r.pass));assert.ok(newChecks.every(r=>r.pass));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
