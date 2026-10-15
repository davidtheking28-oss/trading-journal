// Local-only preview: real UI, mocked authentication and data, no live backend.
const {createServer}=require('node:http');
const {readFileSync,statSync}=require('node:fs');
const {resolve,extname,sep}=require('node:path');
const root=resolve(__dirname,'..');
const sdk=readFileSync(resolve(__dirname,'fixtures/supabase-browser.js'),'utf8');
const chart='window.Chart=class {static defaults={};static getChart(){return null}constructor(el,cfg){this.data=cfg.data;this.options=cfg.options;this.canvas=el;}update(){}resize(){}destroy(){}};';
const seed=`
(function(){
 const mode=new URLSearchParams(location.search).get('mode')||'active';
 const day=(offset)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
 const start=mode==='review'?day(-30):day(-12);
 const entry={id:'preview-lab',user_id:'user-a',template:'setup_documented',asset_scope:'stock',target:100,timezone:'Asia/Jerusalem',start_date:start,end_date:mode==='review'?day(0):day(18),status:'active',updated_at:'preview-1',created_at:start};
 window.__testDB.personal_experiments=mode==='templates'?[]:[entry];
 sessionStorage.setItem('test-lab-experiments',JSON.stringify(window.__testDB.personal_experiments));
 window.__testDB.trades=Array.from({length:44},(_,i)=>({id:90000+i,user_id:'user-a',type:'stock',symbol:['AAPL','MSFT','NVDA','META'][i%4],entry_date:day(i<22?-10+(i%10):-38+(i%20)),close_date:day(i<22?-9+(i%8):-35+(i%15)),entry_price:100,shares:10,closed_shares:10,exit_price:i%3===0?98:104,commission:1,ecn:0,targets:[],ls:'L',setup_type:i%5===0?'':'vcp',entry_reason:'נתוני הדגמה בלבד',deleted:false}));
 // Keep the chart demonstration on actual weekdays, with its markers inside
 // the synthetic daily ranges. Other journal fixtures remain unchanged.
 const sessionDate=(offset)=>{const date=new Date(Date.now()+offset*86400000);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);};
 window.__testDB.trades[0].entry_date=sessionDate(-10);
 window.__testDB.trades[0].close_date=sessionDate(-9);
})();
`;
const setup=`<script>
sessionStorage.setItem('test-user','user-a');localStorage.setItem('tj-lang','he');
const previewNativeFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.pathname.endsWith('/functions/v1/ohlc')){
  const today=Date.parse(new Date().toISOString().slice(0,10))/1000;
  const entryDate=new Date((today-10*86400)*1000);while([0,6].includes(entryDate.getUTCDay()))entryDate.setUTCDate(entryDate.getUTCDate()-1);
  const entry=Date.parse(entryDate.toISOString().slice(0,10))/1000;
  const closeAt=day=>day<0?98.5+day*.055+Math.sin(day*.65)*.65:100.2-day*.48+Math.sin(day*.8)*.35;
  const bars=Array.from({length:400},(_,i)=>{
   const t=today-(399-i)*86400,day=(t-entry)/86400;
   const c=closeAt(day),o=closeAt(day-1)+Math.sin(i*.9)*.16;
   return {t,o,h:Math.max(o,c)+.22+Math.abs(Math.sin(i))*.18,l:Math.min(o,c)-.24-Math.abs(Math.cos(i))*.2,c,v:Math.round(100000+Math.abs(Math.sin(i*.43))*180000+(day===0?350000:0))};
  }).filter(bar=>![0,6].includes(new Date(bar.t*1000).getUTCDay()));
  return Promise.resolve(new Response(JSON.stringify({bars}),{status:200,headers:{'Content-Type':'application/json'}}));
 }
 return url.origin===location.origin?previewNativeFetch(input,init):Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
};
window.addEventListener('load',()=>{let attempts=0;const timer=setInterval(()=>{if(++attempts>200){clearInterval(timer);return;}if(typeof switchTab==='function'&&typeof _currentUser!=='undefined'&&_currentUser&&typeof _dbLoaded!=='undefined'&&_dbLoaded){clearInterval(timer);cookieDecline();setLang('he');switchTab('statistics');}},100);});
</script>`;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/__sdk.js'){res.setHeader('Content-Type','text/javascript');return res.end(sdk+seed);}
 if(url.pathname==='/__chart.js'){res.setHeader('Content-Type','text/javascript');return res.end(chart);}
 const pathname=url.pathname==='/'?'/dashboard.html':url.pathname;
 const file=resolve(root,'.'+pathname);
 if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
 try{
  let body=readFileSync(file);
  if(file.endsWith('dashboard.html')){
   const version='preview-'+Math.max(...['dashboard.html','assets/js/personal-lab.js','assets/js/dashboard.js','assets/js/trade-charts.js','tests/personal-lab-preview.cjs'].map(path=>Math.floor(statSync(resolve(root,path)).mtimeMs)));
   body=body.toString().replaceAll('__APP_VERSION__',version).replaceAll('__SUPABASE_URL__','https://test.supabase.co').replaceAll('__SUPABASE_ANON__','test-key')
    .replaceAll('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.3/dist/umd/supabase.min.js','/__sdk.js?v='+version)
    .replaceAll('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js','/__chart.js')
    .replace(/integrity="[^"]*"/g,'').replace('<head>','<head>'+setup)
    .replace('<body',`<body`).replace(/(<body[^>]*>)/, '$1<div style="position:fixed;inset:0 0 auto;z-index:99999;background:#3730a3;color:white;padding:6px 16px;font:13px Arial;text-align:center;direction:rtl">תצוגה מקומית · נתונים מדומים בלבד &nbsp; <a style="color:white" href="?mode=templates">בחירת ניסוי</a> · <a style="color:white" href="?mode=active">ניסוי פעיל</a> · <a style="color:white" href="?mode=review">סיכום</a></div>');
  }
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');res.end(body);
 }catch{res.writeHead(404).end();}
});
server.listen(4178,'127.0.0.1',()=>console.log('Personal lab local preview: http://127.0.0.1:4178/?mode=active'));
