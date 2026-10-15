import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { extractFunction } from './harness.mjs';
function labContext(extra = {}) {
 const ctx = { console, Date, Intl, Set, Map, _lang:'he', SETUP_OPTIONS:['vcp','breakout','pullback','powerplay','reversal','earnings','other'], ...extra };
 vm.createContext(ctx);
 const helpers=readFileSync(new URL('../assets/js/dashboard.js',import.meta.url),'utf8');
 const escapeStart=helpers.indexOf('function esc(');
 vm.runInContext(helpers.slice(escapeStart,helpers.indexOf('\n}',escapeStart)+2),ctx);
 for(const fn of ['calcPL','calcTotal','isClosed']) vm.runInContext(extractFunction(fn),ctx);
 vm.runInContext(readFileSync(new URL('../assets/js/personal-lab.js',import.meta.url),'utf8'),ctx);
 return ctx;
}

test('personal comparison separates setup and asset, requires five wins and losses and ignores duplicates',()=>{
 const c=labContext();
 const rows=Array.from({length:10},(_,i)=>({trade:{id:i,type:'stock',setupType:'vcp',ls:'L',entryPrice:100,exitPrice:i<5?110:90,shares:1,commission:0},result:{status:'unmatched',reason:'distance',distancePct:i<5?1:6}}));
 assert.equal(c.labPersonalComparison(rows.slice(0,9)).length,0);
 const groups=c.labPersonalComparison([...rows,rows[0],{...rows[0],trade:{...rows[0].trade,id:20,type:'crypto'}},{...rows[0],trade:{...rows[0].trade,id:21,setupType:'breakout'}}]);
 assert.equal(groups.length,1);assert.equal(groups[0].wins,5);assert.equal(groups[0].losses,5);
 assert.equal(groups[0].winMedian,1);assert.equal(groups[0].lossMedian,6);
 const html=c.labPersonalComparisonHTML(groups);
 assert.match(html,/1\.0%/);assert.match(html,/6\.0%/);assert.match(html,/אינו הוכחה לטעות/);
});

test('personal comparison excludes unknown, short, missing setup, breakeven and malformed results',()=>{
 const c=labContext();
 const base={id:1,type:'stock',setupType:'vcp',entryPrice:100,exitPrice:110,shares:1};
 const invalid=[{...base,setupType:''},{...base,ls:'S'},{...base,exitPrice:100},{...base,entryPrice:NaN}];
 const rows=invalid.flatMap((trade,i)=>Array.from({length:10},(_,j)=>({trade:{...trade,id:i*10+j},result:{status:'possible',distancePct:1}})));
 assert.equal(c.labPersonalComparison(rows).length,0);
});
const experiment = { template:'daily_limit', asset_scope:'stock', target:2, start_date:'2026-10-15', end_date:'2026-11-14', timezone:'Asia/Jerusalem' };
describe('personal lab',()=>{
 test('daily limit counts active days, excludes deleted, future and invalid dates',()=>{
  const c=labContext(); const rows=[1,2,3].map(id=>({id,type:'stock',entryDate:'2026-10-15'}));
  rows.push({id:4,type:'stock',entryDate:'2026-10-16',deleted:true},{id:5,type:'stock',entryDate:'2026-02-30'},{id:6,type:'stock',entryDate:'2026-10-20'});
  const r=c.labMeasure(experiment,rows,'2026-10-16');
  assert.equal(r.current.records,3);assert.equal(r.current.numerator,0);assert.equal(r.current.denominator,1);
  assert.equal(c.labMeasure(experiment,[],'2026-10-16').current.adherence,null);
  assert.equal(c.labDate('2024-02-29'),'2024-02-29');assert.equal(c.labDate('2026-02-29'),null);
 });
 test('documentation measures current completeness, not timing or imported execution count',()=>{
  const c=labContext();const rows=[{id:1,type:'stock',entryDate:'2026-10-15',setupType:'vcp',entryReason:'\u00a0'},{id:2,type:'stock',entryDate:'2026-10-15',setupType:'invented',entryReason:'reason'}];
  assert.equal(c.labMeasure({...experiment,template:'setup_documented'},rows,'2026-10-16').current.adherence,50);
  assert.equal(c.labMeasure({...experiment,template:'reason_documented'},rows,'2026-10-16').current.adherence,50);
 });
 test('cohorts use exact boundaries and realized net including partial exits',()=>{
  const c=labContext();const rows=[
   {id:1,type:'stock',entryDate:'2026-10-15',entryPrice:100,shares:10,exitPrice:110,commission:2,ls:'L'},
   {id:2,type:'stock',entryDate:'2026-09-15',entryPrice:100,shares:10,exitPrice:90,commission:2,ls:'S'},
   {id:3,type:'stock',entryDate:'2026-10-16',entryPrice:100,shares:10,exitPrice:90,t:[{shares:4,price:110}],commission:2,ls:'L'},
   {id:4,type:'stock',entryDate:'2026-11-14',entryPrice:100,shares:10,exitPrice:110,ls:'L'}];
  const r=c.labMeasure(experiment,rows,'2026-11-14');assert.equal(r.current.net,76);assert.equal(r.baseline.net,98);assert.equal(r.current.realizedRecords,2);assert.equal(r.daysRemaining,0);
  assert.equal(c.labMeasure(experiment,rows,'2026-10-14').pendingStart,true);
 });
});

describe('personal lab account-safe persistence',()=>{
 test('late account load is discarded and concurrent requests are shared',async()=>{
  let resolve,calls=0;const c=labContext({_currentUser:{id:'A'},_legalReadyUserId:'A',document:{getElementById:()=>null},_sb:{from:()=>({select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},then(ok){calls++;return new Promise(r=>{resolve=r;}).then(ok);}})}});
  const a=c.labLoad(),b=c.labLoad();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  c._currentUser={id:'B'};c.labReset();resolve({data:[{id:'old',status:'active'}],error:null});await Promise.all([a,b]);
  assert.equal(c.labActive(),null);
 });
 test('rejected save keeps draft, wrong account cannot receive a completion',async()=>{
  let resolve;const c=labContext({_currentUser:{id:'A'},_legalReadyUserId:'A',document:{getElementById:()=>null},_sb:{rpc:()=>new Promise(r=>{resolve=r;})}});
  const pending=c.labStart({template:'daily_limit',asset_scope:'stock',target:3,timezone:'Asia/Jerusalem'});
  c._currentUser={id:'B'};c.labReset();resolve({data:{id:'old',status:'active'},error:null});assert.equal(await pending,false);assert.equal(c.labActive(),null);
 });
});

test('personal lab shared server/browser financial fixtures agree',()=>{
 const c=labContext();vm.runInContext(extractFunction('_rowToTrade'),c);
 const cases=JSON.parse(readFileSync(new URL('./fixtures/personal-lab-cases.json',import.meta.url),'utf8'));
 for(const [id,item] of cases.entries()) {
  const result=c.labMeasure(experiment,[c._rowToTrade({...item.row,id})],'2026-10-16').current;
  assert.equal(result.net,item.net);assert.equal(result.realizedRecords,item.realized);
 }
});

test('personal lab cannot receive journal rows from a late previous-account load',async()=>{
 for(const name of ['loadDB','_syncReloadTrades']) {
  let resolve;const original={stocks:[{symbol:'B'}],crypto:[]};
  const c={_currentUser:{id:'A'},db:original,_dbLoaded:false,_sb:{from:()=>({select(){return this;},eq(){return this;},order(){return this;},range:()=>new Promise(r=>{resolve=r;})})},
   _rowToTrade:x=>x,validateTradeSchema:()=>true,_dedupeTrades:async()=>{},initFilters(){},renderOverview(){},renderTable(){}};
  vm.createContext(c);vm.runInContext('async '+extractFunction('_fetchAllTrades'),c);vm.runInContext('async '+extractFunction(name),c);
  const pending=c[name](false);c._currentUser={id:'B'};resolve({data:[],error:null});await pending;
  assert.equal(c.db.stocks[0]?.symbol,'B');assert.equal(c._dbLoaded,false);
 }
});

describe('personal lab QA recovery and repeated experiments',()=>{
 test('synchronous SDK failure remains retryable instead of rejecting or locking the loader',async()=>{
  let failure=true;
  const c=labContext({_currentUser:{id:'A'},_legalReadyUserId:'A',document:{getElementById:()=>null},_sb:{from(){if(failure)throw Error('sdk unavailable');return {select(){return this;},eq(){return this;},limit:async()=>({data:[],error:null})};}}});
  assert.equal(await c.labLoad(),false);failure=false;assert.equal(await c.labLoad({force:true}),true);
 });
 test('a fresh experiment never inherits the previous conclusion or unfinished note',async()=>{
  const c=labContext({_currentUser:{id:'A'},_legalReadyUserId:'A',document:{getElementById:()=>null},_sb:{rpc:async()=>({data:{id:'new',user_id:'A',status:'active'},error:null})}});
  vm.runInContext("_lab.user=_currentUser;_lab.choice='keep';_lab.note='old note';",c);
  await c.labStart({template:'daily_limit',asset_scope:'stock',target:3,timezone:'UTC'});
  assert.equal(vm.runInContext('_lab.choice',c),'inconclusive');assert.equal(vm.runInContext('_lab.note',c),'');
 });
});

test('personal lab labels documentation honestly and explains an empty measurement period',()=>{
 const c=labContext();const empty=c.labMeasure({...experiment,template:'setup_documented'},[],'2026-10-16');
 const html=c.labMetricsHTML(empty,{...experiment,template:'setup_documented'});
 assert.match(html,/שלמות התיעוד/);assert.match(html,/אין עדיין עסקאות למדידה/);assert.doesNotMatch(html,/עמידה בכלל/);
});

test('personal lab concurrent load failure is shown once without a silent automatic retry',async()=>{
 let calls=0;
 const c=labContext({_currentUser:{id:'A'},_legalReadyUserId:'A',document:{getElementById:()=>null},_sb:{from:()=>({select(){return this;},eq(){return this;},limit(){return this;},then(ok){calls++;return Promise.resolve({data:null,error:{message:'offline'}}).then(ok);}})}});
 await Promise.all([c.labLoad(),c.labLoad({history:true})]);assert.equal(calls,1);assert.equal(c.labActive(),null);
});

test('personal lab compact view keeps the current measure visible and secondary results in disclosure',()=>{
 const c=labContext();const metrics=c.labMeasure({...experiment,template:'setup_documented'},[{id:1,type:'stock',entryDate:'2026-10-15',setupType:'vcp'}],'2026-10-16');
 const html=c.labMetricsHTML(metrics,{...experiment,template:'setup_documented',id:'test'},true);
 assert.match(html,/<details class="lab-analysis"/);assert.match(html,/השוואה ותוצאות/);assert.match(html,/שלמות התיעוד/);
 assert.doesNotMatch(html,/<details class="lab-analysis"[^>]*\sopen[\s>]/);
});

test('lab recurring observations exclude unknowns and duplicates and disclose partial coverage',()=>{
 const c=labContext();
 const rows=[
  {trade:{id:1,type:'stock',symbol:'AAA'},result:{status:'unmatched',reason:'distance',distancePct:5}},
  {trade:{id:2,type:'stock',symbol:'BBB'},result:{status:'unmatched',reason:'distance',distancePct:4}},
  {trade:{id:3,type:'stock',symbol:'CCC'},result:{status:'possible',distancePct:1}},
  {trade:{id:4,type:'stock',symbol:'DDD'},result:{status:'unknown',distancePct:99}}
 ];
 const report=c.labReviewSummary([...rows,rows[0]],50);
 assert.equal(report.reviewed,4);assert.equal(report.unknown,1);assert.equal(report.partial,true);
 assert.equal(report.patterns.length,1);assert.equal(report.patterns[0].count,2);assert.equal(report.distanceChecked,3);
 assert.equal(report.patterns[0].key,'above');
 const html=c.labReviewSummaryHTML(report);
 assert.match(html,/4.*50/);assert.match(html,/אינה הוכחה לטעות/);assert.doesNotMatch(html,/עמדת בכללים|טעויות מאומתות/);
});

test('one example and unrelated setup non-matches do not establish a repeated error',()=>{
 const c=labContext();
 const report=c.labReviewSummary([
  {trade:{id:1,type:'stock'},result:{status:'unmatched',reason:'distance',distancePct:5}},
  {trade:{id:2,type:'stock'},result:{status:'unmatched',reason:'shape'}},
  {trade:{id:3,type:'crypto'},result:{status:'unknown',reason:'short'}}
 ],3);
 assert.equal(report.patterns.length,0);assert.equal(report.unknown,1);assert.equal(report.partial,false);
 assert.match(c.labReviewSummaryHTML(report),/אין כרגע מספיק דוגמאות/);
});

test('distance denominators include measurable shape non-matches without flagging them as errors',()=>{
 const c=labContext();
 const report=c.labReviewSummary([
  {trade:{id:1,type:'stock'},result:{status:'unmatched',reason:'distance',distancePct:5}},
  {trade:{id:2,type:'stock'},result:{status:'unmatched',reason:'distance',distancePct:4}},
  {trade:{id:3,type:'stock'},result:{status:'unmatched',reason:'shape',distancePct:1}},
  {trade:{id:4,type:'stock'},result:{status:'unknown',reason:'data'}}
 ],4);
 assert.equal(report.distanceChecked,3);assert.equal(report.patterns[0].count,2);assert.equal(report.unknown,1);
});

test('lab leads with one supported finding and a concrete entry-plan check',()=>{
 const c=labContext();
 const report={reviewed:5,total:40,unknown:0,distanceChecked:5,partial:true,patterns:[
  {key:'above',count:2,examples:[]},{key:'below',count:3,examples:[]}
 ]};
 const html=c.labPrimaryFindingHTML(report);
 assert.match(html,/לפני העסקה הבאה/);assert.match(html,/3 מתוך 5/);assert.match(html,/מתחת לשיא/);
 assert.match(html,/נקודת הפריצה שתכננת/);assert.match(html,/חשד לבדיקה/);
 assert.doesNotMatch(html,/יותר מ־3%|טעית|הוכח/);
 assert.match(c.labPrimaryFindingHTML({...report,patterns:[]}),/אין כרגע מספיק דוגמאות/);
});
