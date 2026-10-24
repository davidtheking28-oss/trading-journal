// Automatic trade charts only; experimental setup analysis has been retired.
function tradeSnapshotData(tr, bars, entryOnly = false) {
  if (!tr || (!entryOnly && !tradeSnapshotEligible(tr)) || !Array.isArray(bars) || !(entryOnly?[+tr.entryPrice]:[+tr.entryPrice,+tr.exitPrice]).every(n=>Number.isFinite(n)&&n>0)) return null;
  const entry = Date.parse(tr.entryDate.slice(0,10) + 'T00:00:00Z') / 1000;
  const exitDate=entryOnly?tr.entryDate:tr.closeDate;
  const exit = Date.parse(exitDate.slice(0,10) + 'T00:00:00Z') / 1000;
  if(bars.some(b=>!b || !Number.isFinite(b.t) || b.t<0 || b.t>8640000000000 || ![b.o,b.h,b.l,b.c].every(v=>Number.isFinite(v)&&v>0) || b.h<Math.max(b.o,b.l,b.c) || b.l>Math.min(b.o,b.c)))return null;
  if(new Set(bars.map(b=>Math.floor(b.t/86400))).size!==bars.length)return null;
  const clean = [...bars].sort((a,b)=>a.t-b.t);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit < entry || !clean.length ||
      clean[0].t > entry + 86400 || clean.at(-1).t < exit - 86400) return null;
  const toTime = timestamp => new Date(timestamp*1000).toISOString().slice(0,10);
  if(toTime(entry)!==tr.entryDate.slice(0,10) || toTime(exit)!==exitDate.slice(0,10))return null;
  // Focus on the trade, with a short context before entry and after exit.
  // Keep the full holding period so both markers remain visible.
  const selected = clean.filter(b => b.t >= entry - (tr.type === 'crypto' ? 28 : 42)*86400 && b.t <= exit + 10*86400);
  if (!selected.length) return null;
  // Never silently move an execution onto a different trading day.
  const entryBar=selected.find(b=>toTime(b.t)===tr.entryDate.slice(0,10));
  const exitBar=selected.find(b=>toTime(b.t)===exitDate.slice(0,10));
  if(!entryBar || !exitBar)return null;
  return {
    prices:selected.map(b=>({time:toTime(b.t),open:b.o,high:b.h,low:b.l,close:b.c})),
    volume:selected.map(b=>({time:toTime(b.t),value:Number.isFinite(b.v)&&b.v>0?b.v:0})),
    entry:{time:toTime(entryBar.t),date:tr.entryDate.slice(0,10),price:+tr.entryPrice},
    exit:entryOnly?null:{time:toTime(exitBar.t),date:exitDate.slice(0,10),price:+tr.exitPrice},
    short:tr.ls==='S',
    partialExitsOmitted:Array.isArray(tr.t)&&tr.t.some(t=>+t.shares>0&&+t.price>0),
    priceBasisMismatch:(entryOnly?[[+tr.entryPrice,entryBar]]:[[+tr.entryPrice,entryBar],[+tr.exitPrice,exitBar]]).some(([price,b])=>price<b.l*.9999 || price>b.h*1.0001)
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
function tradeSnapshotLabelPositions(points, width, scale) {
  const labels=points.map((p,i)=>({x:Math.max(p.width/2+4*scale,Math.min(p.x,width-p.width/2-4*scale)),y:p.y+(i?23:-23)*scale}));
  if(points.length<2)return labels;
  const overlapX=Math.abs(labels[0].x-labels[1].x)<(points[0].width+points[1].width)/2+8*scale;
  const overlapY=labels[0].y>=labels[1].y-4*scale && labels[0].y-16*scale<=labels[1].y+16*scale;
  if(overlapX && overlapY){labels[0].y=Math.min(points[0].y,points[1].y)-23*scale;labels[1].y=Math.max(points[0].y,points[1].y)+23*scale;}
  return labels;
}

async function tradeSnapshotImage(tr, bars, options = null) {
  const entryOnly=!!options?.entryOnly;
  const data = tradeSnapshotData(tr,bars,entryOnly);
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
      rightPriceScale:{borderColor:'rgba(255,255,255,0.06)',scaleMargins:{top:0.18,bottom:0.18}},
      timeScale:{borderColor:'rgba(255,255,255,0.06)',rightOffset:0},
      handleScroll:false,handleScale:false
    });
    const series=chart.addBarSeries({upColor:'#ffffff',downColor:'#ffffff',openVisible:true,thinBars:true,priceLineVisible:false,lastValueVisible:false,...(tr.type==='crypto' ? {priceFormat:{type:'price',precision:Math.min(+tr.entryPrice < 1 ? 8 : 2,8),minMove:+tr.entryPrice < 1 ? 0.00000001 : 0.01}} : {})});
    series.setData(data.prices);
    series.applyOptions({autoscaleInfoProvider:original=>{
      const info=original();if(!info)return info;
      return {...info,priceRange:{minValue:Math.min(info.priceRange.minValue,data.entry.price,data.exit?.price??data.entry.price),maxValue:Math.max(info.priceRange.maxValue,data.entry.price,data.exit?.price??data.entry.price)}};
    }});
    const volume=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'',lastValueVisible:false,priceLineVisible:false});
    volume.priceScale().applyOptions({scaleMargins:{top:0.82,bottom:0}});
    volume.setData(data.volume.map(b=>({...b,color:'rgba(255,255,255,0.25)'})));
    tradeSnapshotFit(chart,data.prices.length);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const screenshot=chart.takeScreenshot();
    const scale=screenshot.width/960;
    const notes=[];
    if(data.partialExitsOmitted)notes.push(_lang==='he'?'מוצגת יציאה אחרונה בלבד; מימושים קודמים אינם מסומנים.':'Final exit only; prior partial exits are not marked.');
    if(data.priceBasisMismatch)notes.push(entryOnly?(_lang==='he'?'מחיר הכניסה המתוכנן מחוץ לטווח הנר היומי.':'Planned entry price is outside the daily bar range.'):(_lang==='he'?'מחיר ביצוע מחוץ לטווח היומי; בדוק התאמת נתונים, פיצול או מסחר מחוץ לשעות.':'Execution outside daily range; check price basis, splits or extended-hours trading.'));
    const canvas=document.createElement('canvas');canvas.width=screenshot.width;canvas.height=screenshot.height+(38+notes.length*22)*scale;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#101116';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font=(16*scale)+'px Arial';ctx.fillStyle='#e6edf7';
    ctx.fillText(tr.symbol+' · '+(entryOnly?(_lang==='he'?'כניסה מתוכננת · נרות יומיים':'Planned entry · Daily bars'):(_lang==='he'?'גרף עסקה · נרות יומיים':'Trade chart · Daily bars')),20*scale,25*scale);
    ctx.drawImage(screenshot,0,38*scale);
    // Bar markers sit above/below OHLC extremes. Draw execution arrows at the
    // actual price coordinate instead, with entry above and exit below.
    const points=[data.entry,data.exit].filter(Boolean).map((point,i)=>{
      const x=chart.timeScale().timeToCoordinate(point.time),y=series.priceToCoordinate(point.price);
      if(x===null || y===null || !Number.isFinite(x) || !Number.isFinite(y) || y<0 || y>320)return null;
      const label=(_lang==='he'?(i?'יציאה ':'כניסה '):(i?'Exit ':'Entry '))+'$'+point.price.toFixed(point.price<1?8:2);
      ctx.font=(13*scale)+'px Arial';
      return {x:x*scale,y:(y+38)*scale,label,width:ctx.measureText(label).width};
    });
    if(points.some(p=>!p))return null;
    const labels=tradeSnapshotLabelPositions(points,chart.timeScale().width()*scale,scale);
    for(const [i,point] of points.entries()){
      const isEntry=i===0,px=point.x,py=point.y,side=isEntry?-1:1;
      ctx.fillStyle=isEntry?'#34d399':'#fb7185';
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-6*scale,py+side*9*scale);ctx.lineTo(px-2*scale,py+side*9*scale);ctx.lineTo(px-2*scale,py+side*20*scale);ctx.lineTo(px+2*scale,py+side*20*scale);ctx.lineTo(px+2*scale,py+side*9*scale);ctx.lineTo(px+6*scale,py+side*9*scale);ctx.closePath();ctx.fill();
      ctx.font=(13*scale)+'px Arial';ctx.textAlign='center';ctx.textBaseline=isEntry?'bottom':'top';
      ctx.fillText(point.label,labels[i].x,labels[i].y);
    }
    ctx.font=(12*scale)+'px Arial';ctx.fillStyle='#a8b8cc';ctx.textBaseline='top';ctx.textAlign=_lang==='he'?'right':'left';
    notes.forEach((note,i)=>ctx.fillText(note,(_lang==='he'?940:20)*scale,(358+i*22)*scale,920*scale));
    return canvas.toDataURL('image/png');
  } finally { chart?.remove();box.remove(); }
}

