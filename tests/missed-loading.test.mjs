import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractFunction} from './harness.mjs';
test('missed requests are shared only within one account and release after settlement',async()=>{
 let calls=0;const resolvers=[];
 const sb={from:()=>({select:()=>({eq:()=>({order:()=>{calls++;return new Promise(resolve=>resolvers.push(resolve));}})})})};
 const user={id:'a'};
 const load=new Function('_sb','_currentUser','let _missedLoadPending=null; return (async '+extractFunction('missedLoad')+');')(sb,user);
 const first=load(),second=load();assert.equal(calls,1);
 user.id='b';const third=load();assert.equal(calls,2);
 resolvers[0]({data:[{id:1,symbol:'AAPL'}]});resolvers[1]({data:[{id:2,symbol:'MSFT'}]});
 assert.equal((await first)[0].sym,'AAPL');assert.equal((await second)[0].sym,'AAPL');assert.equal((await third)[0].sym,'MSFT');
 const fresh=load();assert.equal(calls,3);resolvers[2]({data:[]});await fresh;
});
