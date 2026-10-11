// Loaded on demand by loadTradeSnapshotFeature; shares the dashboard global scope.
function tradeSnapshotData(tr, bars) {
  if (!tradeSnapshotEligible(tr) || !Array.isArray(bars)) return null;
  const entry = Date.parse(tr.entryDate.slice(0,10) + 'T00:00:00Z') / 1000;
  const exit = Date.parse(tr.closeDate.slice(0,10) + 'T00:00:00Z') / 1000;
  const clean = [...new Map(bars.filter(b => Number.isFinite(b.t) && [b.o,b.h,b.l,b.c].every(v => Number.isFinite(v) && v > 0)).map(b=>[Math.floor(b.t/86400),b])).values()].sort((a,b)=>a.t-b.t);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit < entry || !clean.length ||
      clean[0].t > entry + 86400 || clean.at(-1).t < exit - 86400) return null;
  const toTime = timestamp => new Date(timestamp*1000).toISOString().slice(0,10);
  // Focus on the trade, with a short context before entry and after exit.
  // Keep the full holding period so both markers remain visible.
  const selected = clean.filter(b => b.t >= entry - (tr.type === 'crypto' ? 28 : 42)*86400 && b.t <= exit + 10*86400);
  if (!selected.length) return null;
  // Date-only trades may fall on a non-session day; the marker attaches to the
  // closest daily bar; stored trade dates remain unchanged.
  const nearest = timestamp => selected.reduce((best,b)=>Math.abs(b.t-timestamp)<Math.abs(best.t-timestamp)?b:best,selected[0]);
  if (Math.abs(nearest(entry).t-entry)>3*86400 || Math.abs(nearest(exit).t-exit)>3*86400) return null;
  return {
    prices:selected.map(b=>({time:toTime(b.t),open:b.o,high:b.h,low:b.l,close:b.c})),
    volume:selected.map(b=>({time:toTime(b.t),value:Number.isFinite(b.v)&&b.v>0?b.v:0})),
    entry:{time:toTime(nearest(entry).t),date:tr.entryDate.slice(0,10),price:+tr.entryPrice},
    exit:{time:toTime(nearest(exit).t),date:tr.closeDate.slice(0,10),price:+tr.exitPrice},
    short:tr.ls==='S'
  };
}

function tradeSnapshotFit(chart, count) {
  const timeScale=chart.timeScale();timeScale.fitContent();
  const spacing=timeScale.options().barSpacing;
  const width=spacing*count;
  if(count && Number.isFinite(spacing) && width>14) {
    timeScale.setVisibleLogicalRange({from:0,to:count-1+14*count/(width-14)});
  }
}

let _tradeChartLibraryPending = null;
function loadTradeChartLibrary() {
  if (window.LightweightCharts) return Promise.resolve();
  if (_tradeChartLibraryPending) return _tradeChartLibraryPending;
  _tradeChartLibraryPending = new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const owner=document.querySelector('script[src*="assets/js/dashboard.js"]');
    const version=owner ? new URL(owner.src).search : '';
    script.src='./assets/vendor/lightweight-charts-4.2.0.js'+version;
    script.onload=()=>{if(window.LightweightCharts)resolve();else {script.remove();_tradeChartLibraryPending=null;reject(new Error('Chart library unavailable'));}};
    script.onerror=()=>{script.remove();_tradeChartLibraryPending=null;reject(new Error('Chart library unavailable'));};
    document.head.append(script);
  });
  return _tradeChartLibraryPending;
}
async function tradeSnapshotImage(tr, bars) {
  const data = tradeSnapshotData(tr,bars);
  if (!data) return null;
  await loadTradeChartLibrary();
  const box = document.createElement('div');
  box.style.cssText='position:fixed;left:-10000px;top:0;width:960px;height:320px;pointer-events:none;';
  box.setAttribute('aria-hidden','true'); document.body.append(box);
  let chart;
  try {
    chart=LightweightCharts.createChart(box,{
      width:960,height:320,
      layout:{background:{color:'#101116'},textColor:'#8898b2',fontSize:14,fontFamily:'JetBrains Mono, monospace',attributionLogo:true},
      grid:{vertLines:{color:'rgba(255,255,255,0.035)'},horzLines:{color:'rgba(255,255,255,0.035)'}},
      rightPriceScale:{borderColor:'rgba(255,255,255,0.06)',scaleMargins:{top:0.1,bottom:0.1}},
      timeScale:{borderColor:'rgba(255,255,255,0.06)',rightOffset:0},
      handleScroll:false,handleScale:false
    });
    const series=chart.addBarSeries({upColor:'#ffffff',downColor:'#ffffff',openVisible:true,thinBars:true,priceLineVisible:false,lastValueVisible:false,...(tr.type==='crypto' ? {priceFormat:{type:'price',precision:Math.min(+tr.entryPrice < 1 ? 8 : 2,8),minMove:+tr.entryPrice < 1 ? 0.00000001 : 0.01}} : {})});
    series.setData(data.prices);
    const volume=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'',lastValueVisible:false,priceLineVisible:false});
    volume.priceScale().applyOptions({scaleMargins:{top:0.82,bottom:0}});
    volume.setData(data.volume.map(b=>({...b,color:'rgba(255,255,255,0.25)'})));
    series.setMarkers([
      {time:data.entry.time,position:data.short?'aboveBar':'belowBar',color:'#34d399',shape:data.short?'arrowDown':'arrowUp',text:(_lang==='he'?'כניסה ':'Entry ')+String.fromCharCode(36)+data.entry.price.toFixed(data.entry.price < 1 ? 8 : 2)},
      {time:data.exit.time,position:data.short?'belowBar':'aboveBar',color:'#fb7185',shape:data.short?'arrowUp':'arrowDown',text:(_lang==='he'?'יציאה ':'Exit ')+String.fromCharCode(36)+data.exit.price.toFixed(data.exit.price < 1 ? 8 : 2)}
    ].sort((a,b)=>a.time.localeCompare(b.time)));
    tradeSnapshotFit(chart,data.prices.length);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const screenshot=chart.takeScreenshot();
    const scale=screenshot.width/960;
    const canvas=document.createElement('canvas');canvas.width=screenshot.width;canvas.height=screenshot.height+38*scale;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#101116';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font=(16*scale)+'px Arial';ctx.fillStyle='#e6edf7';
    ctx.fillText(tr.symbol+' · '+(_lang==='he'?'גרף עסקה · נרות יומיים':'Trade chart · Daily bars'),20*scale,25*scale);
    ctx.drawImage(screenshot,0,38*scale);
    return canvas.toDataURL('image/png');
  } finally { chart?.remove();box.remove(); }
}

