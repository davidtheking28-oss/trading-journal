const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const {chromium}=require('playwright');
const source='C:/Users/david/stock-screener/מסנן-מניות.html';
const sdk=`window.supabase={createClient:()=>({from(table){let action='read',rows,filters={};const chain={select(){return chain},eq(k,v){filters[k]=v;return chain},maybeSingle(){return chain},order(){return chain},limit(){return chain},upsert(data){action='upsert';rows=data;return chain},delete(){action='delete';return chain},then(resolve,reject){return window.__db({table,action,rows,filters}).then(resolve,reject)}};return chain},auth:{async getSession(){return {data:{session:{user:{id:'tablet-user'},access_token:'synthetic'}}}},onAuthStateChange(){return null;} } }) };`;
test('tablet watchlist persists and syncs across device sessions',async t=>{
 const store=new Map();let rejectNext=false, delayNext=false, releaseWrite, readFailNext=false;
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(source,'utf8').replace('__SUPABASE_ANON__','synthetic-public-key').replace(/ integrity="[^"]*"/g,''));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch();t.after(()=>browser.close());
 async function open(width){
  const context=await browser.newContext({viewport:{width,height:820},hasTouch:true});const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[],'browser errors'));
  await page.exposeFunction('__db',async q=>{
   if(q.table!=='screener_watchlist')return {data:q.table==='screener_prefs'?null:[],error:null};
   if(readFailNext && q.action==='read'){readFailNext=false;throw Error('Synthetic network rejection');}
   if(delayNext && q.action!=='read'){delayNext=false;await new Promise(resolve=>{releaseWrite=resolve;});}
   if(rejectNext && q.action!=='read'){rejectNext=false;return {data:null,error:{message:'Synthetic write failure'}};}
   if(q.action==='upsert'){for(const row of [].concat(q.rows)){assert.equal(row.user_id,'tablet-user');store.set(row.user_id+':'+row.ticker,{...row,created_at:new Date().toISOString()});}return {data:null,error:null};}
   assert.equal(q.filters.user_id,'tablet-user');
   if(q.action==='delete'){store.delete(q.filters.user_id+':'+q.filters.ticker);return {data:null,error:null};}
   return {data:[...store.values()].filter(r=>r.user_id===q.filters.user_id),error:null};
  });
  await page.route('**/*',r=>r.request().url().includes('supabase-js')?r.fulfill({contentType:'text/javascript',body:sdk}):r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>typeof loadUserData==='function' && _currentUser?.id==='tablet-user');
  await seed(page);return page;
 }
 async function seed(page){await page.evaluate(()=>{const rows=['AAPL','MSFT'].map(ticker=>({ticker,sym:'NASDAQ:'+ticker,name:'Synthetic '+ticker,close:100,rs:90,fromHighPct:-5,fromLowPct:50,perfY:60,perf3:30,perf6:40,eps:25,rev:20,roe:18,nm:15,earnIn:30,mc:2e9,sector:'Technology',ttPass:true,checks:{}}));allResults=rows;results=rows;ttUniverse=Object.fromEntries(rows.map(r=>[r.ticker,r]));_autoWlScanTried=true;_wlDataGen++;_dataGen++;mode='screen';layout='table';resultsPanel.style.display='block';applyView();});}
 const desktop=await open(1440),tablet=await open(820);
 releaseWrite=null;delayNext=true;
 await desktop.locator('#tableView .star-btn').first().click();
 assert.equal(await desktop.locator('#wlSyncStatus').getAttribute('data-state'),'saving');
 assert.match(await desktop.locator('#wlSyncStatus').innerText(),/שומר/);
 await desktop.waitForFunction(()=>_wlPending.size===1);releaseWrite();
 await desktop.waitForFunction(()=>_wlPending.size===0);assert.equal(store.has('tablet-user:AAPL'),true);
 assert.equal(await desktop.locator('#wlSyncStatus').getAttribute('data-state'),'saved');
 await tablet.locator('#tabWatch').click();
 await tablet.waitForFunction(()=>document.querySelector('#tableView').innerText.includes('AAPL'));
 assert.match(await tablet.locator('#tableView').innerText(),/AAPL/);
 await tablet.locator('#tableView .star-btn').first().click();await tablet.waitForFunction(()=>_wlPending.size===0);assert.equal(store.has('tablet-user:AAPL'),false);
 await desktop.evaluate(()=>loadUserData());assert.equal(await desktop.evaluate(()=>watchlist.has('AAPL')),false);
 await tablet.locator('#tabScreen').click();await tablet.locator('#tableView .star-btn').first().click();await tablet.waitForFunction(()=>_wlPending.size===0);
 await tablet.reload();await tablet.waitForFunction(()=>_currentUser?.id==='tablet-user' && watchlist.has('AAPL'));await seed(tablet);await tablet.locator('#tabWatch').click();assert.match(await tablet.locator('#tableView').innerText(),/AAPL/);
 for(const width of [768,820,1024,1180]){await tablet.setViewportSize({width,height:820});await tablet.evaluate(()=>setLayout('gallery'));await tablet.waitForFunction(()=>document.querySelector('#galleryView').innerText.includes('AAPL'));assert.match(await tablet.locator('#galleryView').innerText(),/AAPL/);assert.equal(await tablet.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await tablet.evaluate(()=>setLayout('table'));assert.match(await tablet.locator('#tableView').innerText(),/AAPL/);}
 rejectNext=true;await tablet.locator('#tableView .star-btn').first().click();await tablet.waitForFunction(()=>_wlPending.size===0);assert.equal(await tablet.evaluate(()=>watchlist.has('AAPL')),true);assert.equal(store.has('tablet-user:AAPL'),true);
 assert.equal(await tablet.locator('#wlSyncStatus').getAttribute('data-state'),'error');
 assert.match(await tablet.locator('#wlSyncStatus').innerText(),/לא נשמר/);
 // A device already showing the watchlist must refresh when it becomes visible.
 await desktop.evaluate(()=>loadUserData());await desktop.locator('#tabScreen').click();await desktop.locator('#tableView .star-btn').nth(1).click();await desktop.waitForFunction(()=>_wlPending.size===0);
 await tablet.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await tablet.waitForFunction(()=>watchlist.has('MSFT'),null,{timeout:3000});
 await tablet.waitForFunction(()=>document.querySelector('#tableView').innerText.includes('MSFT'));
 await tablet.evaluate(()=>{ttUniverse.MSFT._exactFail=true;ttUniverse.MSFT.ttPass=false;});
 await tablet.evaluate(()=>{setMode('screen');_searchInput('AAPL',true);$('tickerSearch').value='AAPL';});
 for(const screener of ['sepa','power','vcp','cleanbase','qulla','finviz','growth','commodities']){
  await tablet.evaluate(key=>{setScreener(key,false);setMode('watch');},screener);
  assert.match(await tablet.locator('#tableView').innerText(),/MSFT/,screener+' must not filter saved stocks');
  assert.equal(await tablet.locator('#filterPanel').isVisible(),false,'watchlist has no screener criteria');
  assert.equal(await tablet.locator('#tickerSearch').inputValue(),'','scan search does not carry into watchlist');
  assert.equal(await tablet.locator('#watchRefreshBtn').isVisible(),true);
  await tablet.evaluate(()=>setLayout('gallery'));
  await tablet.waitForFunction(()=>document.querySelector('#galleryView').innerText.includes('MSFT'),null,{timeout:3000});
  await tablet.evaluate(()=>setLayout('table'));
 }
 const savedMsft=store.get('tablet-user:MSFT');store.delete('tablet-user:MSFT');
 await tablet.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'https://davidtheking28-oss.github.io',data:{type:'tj:screener-visible',visible:true}})));
 await tablet.waitForFunction(()=>!watchlist.has('MSFT'));
 store.set('tablet-user:MSFT',savedMsft);
 await tablet.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'https://davidtheking28-oss.github.io',data:{type:'tj:screener-visible',visible:true}})));
 await tablet.waitForFunction(()=>watchlist.has('MSFT'));
 // A saved ticker with no cached price data must still be named to the user.
 await tablet.evaluate(()=>{delete ttUniverse.MSFT;_wlDataGen++;render();});
 assert.equal(await tablet.locator('#wlMissing').isVisible(),true);
 assert.match(await tablet.locator('#wlMissing').innerText(),/MSFT/);
 assert.match(await tablet.locator('#wlCount').innerText(),/2/);
 readFailNext=true;await desktop.evaluate(()=>loadUserData());
 assert.equal(await desktop.locator('#wlSyncStatus').getAttribute('data-state'),'error');
 assert.match(await desktop.locator('#wlSyncStatus').innerText(),/לא ניתן לאמת/);
 await desktop.evaluate(()=>loadUserData());
 assert.equal(await desktop.locator('#wlSyncStatus').getAttribute('data-state'),'saved');
 await tablet.evaluate(()=>_setCurrentUser(null));
 assert.equal(await tablet.locator('#wlSyncStatus').getAttribute('data-state'),'local');
 assert.match(await tablet.locator('#wlSyncStatus').innerText(),/במכשיר בלבד/);
 releaseWrite=null;delayNext=true;
 const migration=tablet.evaluate(()=>{
  localStorage.setItem('sepa_wl',JSON.stringify(['AAPL','MSFT','TSLA']));localStorage.setItem('sepa_wl_dirty','1');
  _setCurrentUser({id:'tablet-user'});return loadUserData();
 });
 await tablet.waitForFunction(()=>document.querySelector('#wlSyncStatus').dataset.state==='loading');
 // The adapter receives the migration asynchronously; wait until it is held.
 for(let wait=0;!releaseWrite && wait<200;wait++) await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(typeof releaseWrite,'function');
 releaseWrite();await migration;
 assert.equal(store.has('tablet-user:TSLA'),true);
 assert.equal(await tablet.locator('#wlSyncStatus').getAttribute('data-state'),'saved');
});



