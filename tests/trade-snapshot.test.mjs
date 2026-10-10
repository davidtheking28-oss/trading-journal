import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractFunction} from './harness.mjs';
const eligible = new Function('isOpenPosition',`return (${extractFunction('tradeSnapshotEligible')});`)(tr=>+tr.shares-(+tr.closedShares||0)>0);
const chartData = new Function('tradeSnapshotEligible',`return (${extractFunction('tradeSnapshotData')});`)(eligible);
const trade={id:1,type:'stock',symbol:'AAPL',ls:'L',entryDate:'2026-09-01',closeDate:'2026-09-03',entryPrice:100,exitPrice:110,shares:5,closedShares:5};
const bars=Array.from({length:8},(_,i)=>({t:Date.parse('2026-08-29T00:00:00Z')/1000+i*86400,o:101,h:112,l:99,c:109}));
test('completed trade chart uses actual entry and exit prices and daily bars',()=>{
 const data=chartData(trade,bars);assert.equal(data.entry.price,100);assert.equal(data.entry.date,'2026-09-01');assert.equal(data.exit.price,110);assert.equal(data.exit.date,'2026-09-03');assert.equal(data.prices.length,8);assert.equal(data.volume.length,8);
});
test('partial close and missing or invalid date cannot generate completed trade image',()=>{
 assert.equal(chartData({...trade,closedShares:2},bars),null);assert.equal(chartData({...trade,closeDate:''},bars),null);assert.equal(chartData({...trade,closeDate:'invalid'},bars),null);assert.equal(chartData({...trade,closeDate:'2026-08-01'},bars),null);assert.equal(chartData({...trade,type:'crypto'},bars),null);
});
test('missing historical coverage does not fabricate chart',()=>{
 assert.equal(chartData(trade,[]),null);assert.equal(chartData({...trade,entryDate:'2025-01-01'},bars),null);assert.equal(chartData({...trade,closeDate:'2026-10-01'},bars),null);assert.equal(chartData(trade,[{...bars[0],h:NaN}]),null);
});
test('same day and short trade retain independent entry and exit markers',()=>{
 const data=chartData({...trade,ls:'S',closeDate:trade.entryDate,exitPrice:95},bars);assert.equal(data.short,true);assert.equal(data.entry.time,data.exit.time);assert.equal(data.exit.price,95);
});

test('enlarged chart retains screener-like daily-bar density and long-trade entry',()=>{
 const history=Array.from({length:270},(_,i)=>({...bars[0],t:Date.parse('2026-01-01T00:00:00Z')/1000+i*86400})).filter(b=>![0,6].includes(new Date(b.t*1000).getUTCDay()));
 const data=chartData(trade,history);assert.ok(data.prices.length>=125);assert.ok(data.prices.length<=145);assert.equal(data.entry.date,trade.entryDate);assert.equal(data.exit.date,trade.closeDate);
 const long=chartData({...trade,entryDate:'2026-01-20'},history);assert.ok(long.prices.some(b=>b.time==='2026-01-20'));
});
