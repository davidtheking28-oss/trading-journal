const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const html=fs.readFileSync('C:/Users/david/stock-screener/מסנן-מניות.html','utf8');
const source=html.slice(html.indexOf('async function initAuth(){'),html.indexOf('async function loadUserData(){'));
test('auth callback releases session lock before loading watchlist',async()=>{
 let handler,locked=false,completed=false,reads=0;
 const sb={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:fn=>{handler=fn;}}};
 const ctx={user:null,generation:0};
 const load=async()=>{reads++;if(locked)await new Promise(()=>{});completed=true;};
 const run=new Function('_sb','_setCurrentUser','updateAuthUI','loadUserData','_accountContext','_accountCurrent','_lsJSON','buildColPicker','applyView','setTimeout','_reportClientError', 'let _currentUser=null;return '+source+';')
 (sb,user=>{ctx.user=user;ctx.generation++;},()=>{},load,()=>({id:ctx.user?.id,generation:ctx.generation}),a=>a.id===ctx.user?.id&&a.generation===ctx.generation,()=>[],()=>{},()=>{},setTimeout,()=>{});
 await run();locked=true;
 const notification=Promise.resolve(handler('SIGNED_IN',{user:{id:'synthetic'}})).then(()=>{locked=false;});
 const result=await Promise.race([notification.then(()=>true),new Promise(r=>setTimeout(()=>r(false),100))]);
 assert.equal(result,true,'SIGNED_IN callback must settle without waiting for database');
 await new Promise(r=>setTimeout(r,25));assert.equal(completed,true);assert.equal(reads,1);
});
