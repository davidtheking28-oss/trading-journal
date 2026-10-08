const fs=require('node:fs');
const http=require('node:http');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
async function main(){
  const server=http.createServer((req,res)=>{
    try{res.end(fs.readFileSync('C:/Users/david/stock-screener'+decodeURIComponent(req.url)));}
    catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(8793,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  try{
    const measurements=[];
    for(const [version,file] of [['before','C:/Users/david/.codex/visualizations/2026/10/07/01a115e6-dc97-7531-898c-51ac761a03aa/screener-before.html'],['after','C:/Users/david/stock-screener/מסנן-מניות.html']]){
      const ctx=await browser.newContext({viewport:{width:1440,height:900}});
      const page=await ctx.newPage();let requests=0;const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const html=fs.readFileSync(file,'utf8').replaceAll('__SUPABASE_ANON__','synthetic-public-fixture').replace(/ integrity="[^"]*"/g,'');
      const now=Date.now();
      const bars=Array.from({length:250},(_,i)=>({t:Math.floor(now/1000)-(249-i)*86400,o:100+i/10,h:101+i/10,l:99+i/10,c:100+i/10,v:1000+i}));
      await page.route('**/*',async route=>{
        const url=route.request().url();
        if(url.includes('/app')) return route.fulfill({contentType:'text/html',body:html});
        if(url.includes('/supabase.min.js')) return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}},from:()=>({insert:async()=>({error:null})})})};'});
        if(url.includes('/functions/v1/ohlc')){requests++;await new Promise(r=>setTimeout(r,75));return route.fulfill({json:{bars:bars.filter(b=>b.t>=Math.floor(now/1000)-90*86400)}});}
        if(url.includes('lightweight-charts') || url.startsWith('http://127.0.0.1:8793/fonts/')) return route.continue();
        return route.abort();
      });
      await page.goto('http://127.0.0.1:8793/app');
      await page.waitForFunction('typeof LightweightCharts!=="undefined"');
      const result=await page.evaluate(async ({bars,now})=>{
        const gallery=document.createElement('div');gallery.className='gallery';document.body.replaceChildren(gallery);
        const cards=Array.from({length:6},(_,i)=>{
          const el=document.createElement('div');el.style.minHeight='220px';el.dataset.sym='NASDAQ:SYNTHETIC'+i;el.dataset.ticker='SYNTHETIC'+i;
          gallery.appendChild(el);_ohlcWanted.add(el);_valBars.set(el.dataset.sym,{bars,t:now,key:null});return el;
        });
        const start=performance.now();await Promise.all(cards.map(el=>_ohlcDraw(el)));
        return {milliseconds:Math.round(performance.now()-start),charts:cards.filter(el=>_ohlcCharts.has(el)).length,sourceBars:_valBars.get(cards[0].dataset.sym).bars.length};
      },{bars,now});
      assert.equal(result.charts,6);assert.equal(result.sourceBars,250);assert.equal(errors.length,0);
      measurements.push({version,requests,...result,errors});
      await page.screenshot({path:'C:/Users/david/.codex/visualizations/2026/10/07/01a115e6-dc97-7531-898c-51ac761a03aa/screener-charts-'+version+'.png'});
      await ctx.close();
    }
    assert.equal(measurements[0].requests,6);assert.equal(measurements[1].requests,0);
    console.log(JSON.stringify({scenario:'six real charts after exact validation, synthetic OHLC with 75ms response latency',measurements},null,2));
    fs.writeFileSync('docs/screener-chart-benchmark.json',JSON.stringify(measurements,null,2)+'\n');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
