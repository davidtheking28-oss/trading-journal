import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractFunction} from './harness.mjs';
const eligible = new Function('isOpenPosition',`return (${extractFunction('tradeSnapshotEligible')});`)(tr=>+tr.shares-(+tr.closedShares||0)>0);
const svg = new Function('tradeSnapshotEligible',`return (${extractFunction('tradeSnapshotSVG')});`)(eligible);
const trade={id:1,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-09-01',closeDate:'2026-09-03',entryPrice:100,exitPrice:110,shares:5,closedShares:5};
const bars=Array.from({length:8},(_,i)=>({t:Date.parse('2026-08-29T00:00:00Z')/1000+i*86400,o:101,h:112,l:99,c:109}));
test('completed trade image marks real entry and exit and escapes symbol',()=>{
 const result=svg({...trade,symbol:'A<&'},bars);assert.match(result,/Entry \$100.00 · 2026-09-01/);assert.match(result,/Exit \$110.00 · 2026-09-03/);assert.match(result,/A&lt;&amp;/);assert.equal((result.match(/<circle /g)||[]).length,2);
});
test('partial close and missing or invalid date cannot generate completed trade image',()=>{
 assert.equal(svg({...trade,closedShares:2},bars),null);assert.equal(svg({...trade,closeDate:''},bars),null);assert.equal(svg({...trade,closeDate:'invalid'},bars),null);assert.equal(svg({...trade,closeDate:'2026-08-01'},bars),null);assert.equal(svg({...trade,type:'crypto'},bars),null);
});
test('missing historical coverage does not fabricate chart',()=>{
 assert.equal(svg(trade,[]),null);assert.equal(svg({...trade,entryDate:'2025-01-01'},bars),null);assert.equal(svg({...trade,closeDate:'2026-10-01'},bars),null);assert.equal(svg(trade,[{...bars[0],h:NaN}]),null);
});
test('same day and short trade retain independent entry and exit markers',()=>{
 const result=svg({...trade,ls:'S',closeDate:trade.entryDate,exitPrice:95},bars);assert.match(result,/S · Daily candles/);assert.match(result,/Exit \$95.00/);assert.equal((result.match(/<circle /g)||[]).length,2);
});
