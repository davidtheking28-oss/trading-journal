// Loaded on demand by loadTradeSnapshotFeature; shares the dashboard global scope.
function tradeBaseStructure(trade, bars) {
  const unknown={status:'unknown',volume:'unknown'};
  if(!trade || trade.ls==='S' || !Array.isArray(bars))return unknown;
  const date=String(trade.entryDate||'').slice(0,10),entry=Date.parse(date+'T00:00:00Z')/1000;
  if(!Number.isFinite(entry) || new Date(entry*1000).toISOString().slice(0,10)!==date || !(Number(trade.entryPrice)>0) || !Number.isFinite(Number(trade.entryPrice)))return unknown;
  if(bars.some(b=>!b || !Number.isFinite(b.t)))return unknown;
  const prior=bars.filter(b=>b.t<entry).sort((a,b)=>a.t-b.t).slice(-60);
  if(prior.length<25 || entry-prior.at(-1).t>7*86400)return unknown;
  if(new Set(prior.map(b=>Math.floor(b.t/86400))).size!==prior.length || prior.some((b,i)=>
    ![b.o,b.h,b.l,b.c].every(n=>Number.isFinite(n)&&n>0) || b.h<Math.max(b.o,b.c,b.l) || b.l>Math.min(b.o,b.c) ||
    (i && (b.t-prior[i-1].t>7*86400 || Math.abs(b.c/prior[i-1].c-1)>.35))))return unknown;
  // Two bars on either side confirm a swing. All confirmation bars precede entry.
  const swings=[];
  for(let i=2;i<prior.length-2;i++){
    const b=prior[i],neighbors=[prior[i-2],prior[i-1],prior[i+1],prior[i+2]];
    const peak=neighbors.every(n=>b.h>n.h),trough=neighbors.every(n=>b.l<n.l);
    if(peak===trough)continue;
    const point={kind:peak?'high':'low',price:peak?b.h:b.l,index:i};
    const last=swings.at(-1);
    if(last?.kind===point.kind){if(peak?point.price>last.price:point.price<last.price)swings[swings.length-1]=point;}
    else swings.push(point);
  }
  const legs=[];
  for(let i=0;i<swings.length-1;i++)if(swings[i].kind==='high' && swings[i+1].kind==='low'){
    const high=swings[i],low=swings[i+1];
    legs.push({depth:(high.price-low.price)/high.price*100,high,low});
  }
  const last=legs.slice(-3),depths=last.map(l=>Number(l.depth.toFixed(2)));
  const shrinking=last.length===3 && last.every(l=>l.depth>=1) && last[1].depth<last[0].depth*.8 && last[2].depth<last[1].depth*.8 && last[2].depth<=8;
  const final=last.at(-1),pivot=final?.high.price;
  const nearHigh=final && prior.slice(final.high.index+1).every(b=>b.h<=pivot*1.02) && prior.at(-1).c>=pivot*.95;
  const volumes=prior.slice(-25),volumeKnown=volumes.every(b=>Number.isFinite(b.v)&&b.v>0);
  const average=rows=>rows.reduce((sum,b)=>sum+b.v,0)/rows.length;
  const ratio=volumeKnown?average(volumes.slice(-5))/average(volumes.slice(0,20)):null;
  const lows=swings.filter(point=>point.kind==='low').slice(-3);
  const risingLows=lows.length===3?lows.every((point,i)=>!i || point.price>lows[i-1].price):null;
  // Diagnostic SMA, not an assumed personal rule. Compare with five sessions ago.
  const meanClose=rows=>rows.reduce((sum,b)=>sum+b.c,0)/rows.length;
  const ma=meanClose(prior.slice(-21));
  const previous=prior.length>=26?meanClose(prior.slice(-26,-5)):null;
  const delta=previous===null?null:Number(((ma/previous-1)*100).toFixed(8));
  const average21={value:ma,above:prior.at(-1).c>=ma,
    direction:delta===null?'unknown':delta>0?'rising':delta<0?'falling':'flat'};
  return {status:shrinking&&nearHigh?'candidate':'not-established',contractions:depths,
    pivot:shrinking&&nearHigh?pivot:null,volume:ratio===null?'unknown':ratio<=.6?'drying':'not-drying',
    volumeRatio:ratio,risingLows,average21,method:'experimental-swings-v2'};
}

function tradeSetupSuggestion(tr, bars) {
  const unknown = { status: 'unknown', reason: 'history' };
  if (!tr || typeof tr !== 'object') return unknown;
  const date = typeof tr.entryDate === 'string' ? tr.entryDate.slice(0,10) : '';
  const entry = Date.parse(date + 'T00:00:00Z') / 1000;
  const price = Number(tr.entryPrice);
  if (!Number.isFinite(entry) || new Date(entry*1000).toISOString().slice(0,10) !== date || !(price > 0) || !Number.isFinite(price) || !Array.isArray(bars)) return unknown;
  if (tr.ls === 'S') return { status: 'unknown', reason: 'short' };
  // Exclude the entire entry-day bar: daily candles contain information from
  // after an intraday entry. This is a price-pattern hint, not rule compliance.
  // Do not silently skip malformed records and manufacture a clean base.
  if (bars.some(b => !b || !Number.isFinite(b.t) || b.t < 0 || b.t > 8640000000000)) return { status: 'unknown', reason: 'data' };
  const prior = bars.filter(b => b.t < entry).sort((a,b) => a.t-b.t);
  const base = prior.slice(-20);
  if (base.length < 20 || entry-base.at(-1).t > 7*86400 || entry-base[0].t > 45*86400 || base.some((b,i)=>i && b.t-base[i-1].t>7*86400)) return unknown;
  if (new Set(base.map(b => Math.floor(b.t/86400))).size !== base.length || base.some(b => ![b.o,b.h,b.l,b.c].every(v => Number.isFinite(v) && v > 0) || b.h < Math.max(b.o,b.c,b.l) || b.l > Math.min(b.o,b.c))) return { status: 'unknown', reason: 'data' };
  if (new Set(base.map(b=>[b.o,b.h,b.l,b.c].join('|'))).size < 4) return { status: 'unknown', reason: 'flat' };
  if (base.some((b,i)=>i && Math.abs(b.c/base[i-1].c-1)>.35)) return { status: 'unknown', reason: 'scale' };
  const high = Math.max(...base.map(b=>b.h)), low = Math.min(...base.map(b=>b.l));
  // Normalize percentage arithmetic so exactly 3% is not treated as >3%
  // through binary floating-point noise (including small crypto prices).
  const rangePct = Number(((high-low)/low*100).toFixed(8));
  const distancePct = Number(((price-high)/high*100).toFixed(8));
  if(!Number.isFinite(rangePct) || !Number.isFinite(distancePct)) return {status:'unknown',reason:'data'};
  const evidence = { distancePct, rangePct, bars: base.length, referenceHigh: high, entryPrice: price };
  if (rangePct > 20) return { status: 'unmatched', reason: 'wide', ...evidence };
  if (distancePct < 0 || distancePct > 3) return { status: 'unmatched', reason: 'distance', ...evidence };
  // A narrow rising trend alone is not evidence of a base. Require an earlier
  // visit near resistance and a subsequent retracement before the later test.
  const earlyHigh = Math.max(...base.slice(0,10).map(b=>b.h));
  const retracement = base.some((b,i)=>i>0 && i<base.length-2 && b.c <= Math.max(...base.slice(0,i).map(row=>row.h))*.99);
  if (earlyHigh < high*.98 || !retracement) return { status: 'unmatched', reason: 'shape', ...evidence };
  return { status: 'possible', setup: 'breakout', ...evidence, method: 'base-breakout-v2' };
}

function tradeSetupExplanation(result, he) {
  const reasons = {
    short: ['הבדיקה תומכת בעסקאות לונג בלבד.', 'This check supports long trades only.'],
    data: ['נתוני המחיר פגומים או כוללים ימים כפולים.', 'Price data is malformed or contains duplicate days.'],
    flat: ['נתוני המחיר חוזרים על עצמם.', 'Price data repeats without sufficient variation.'],
    scale: ['נמצא שינוי מחיר חריג; ייתכן פיצול או חוסר התאמה בנתונים.', 'A price discontinuity may indicate a split or inconsistent data.'],
    history: ['חסרה היסטוריית מחירים רציפה ועדכנית לפני הכניסה.', 'Recent continuous pre-entry history is missing.']
  };
  if(result.status==='unknown')return (he?'לא ניתן לקבוע: ':'Cannot determine: ')+(reasons[result.reason]||reasons.history)[he?0:1];
  const number=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:Math.abs(value)>=1?2:8});
  const distance=Math.abs(result.distancePct).toFixed(1);
  let text=he
    ? `הכניסה במחיר ${number(result.entryPrice)} הייתה ${distance}% ${result.distancePct<0?'מתחת':'מעל'} לשיא ${number(result.referenceHigh)} של ${result.bars} הנרות שלפני יום הכניסה.`
    : `Entry at ${number(result.entryPrice)} was ${distance}% ${result.distancePct<0?'below':'above'} the high of ${number(result.referenceHigh)} over ${result.bars} bars before entry day.`;
  if(result.status==='possible')text+=he?' נמצאו סימנים לפריצה אפשרית מבסיס.':' Signs of a possible base breakout were found.';
  else if(result.reason==='wide')text+=he?` טווח המחירים היה ${result.rangePct.toFixed(1)}% — רחב מסף הבדיקה של 20%.`:` The price range was ${result.rangePct.toFixed(1)}%, wider than this check’s 20% threshold.`;
  else if(result.reason==='shape')text+=he?' לא נמצאו מספיק סימני התבססות בבדיקה הזו.':' This check found insufficient signs of a base.';
  else if(result.reason==='distance')text+=he?' המרחק מחוץ לטווח הבדיקה של 0–3% מעל השיא.':' The distance is outside this check’s range of 0–3% above the high.';
  return text+(he?' השיא המחושב אינו נקודת פריצה מאומתת. יש להשוות לתוכנית הכניסה; אין בכך קביעה שהכניסה שגויה.':' The calculated high is not a verified pivot. Compare with the entry plan; this does not establish that the entry was wrong.');
}

function tradeEntryCoach(result, trade, he) {
  // Explain evidence, never infer the trader's intent or use the outcome.
  if (!['vcp','breakout'].includes(trade?.setupType) || result.status==='unknown') return null;
  const text=(a,b)=>he?a:b;
  if(result.reason==='distance')return result.distancePct<0 ? {
    why:text('אם תכננת פריצה מעל השיא הזה, המחיר עדיין לא הגיע לטריגר. ייתכן שתכננת נקודת כניסה מוקדמת אחרת.','If this high was your planned breakout trigger, price had not reached it. You may have planned a different early entry.'),
    next:text('סמן את נקודת הפריצה שתכננת והשווה למחיר הכניסה. האם זו הייתה כניסה מוקדמת מכוונת?','Mark your planned pivot and compare it with your entry. Was an early entry intentional?')
  } : {
    why:text('אם זה היה הטריגר שלך, הכניסה הייתה רחוקה ממנו. עם אותו סטופ, כניסה גבוהה יותר מגדילה את הסיכון למניה.','If this was your trigger, entry was far above it. With the same stop, a higher entry increases risk per share.'),
    next:text('סמן את הטריגר, הסטופ ומרחק הכניסה המרבי שתכננת; השווה אותם לביצוע בפועל.','Mark your planned trigger, stop and maximum entry distance; compare them with your execution.')
  };
  if(result.reason==='wide' || result.reason==='shape')return {
    why:text('הבדיקה לא ביססה מבנה של בסיס. זה לבדו לא שולל את הסטאפ שתיעדת.','This check did not establish a base structure. That alone does not rule out your documented setup.'),
    next:text('סמן בגרף את הבסיס ואת ההתכווצות האחרונה שזיהית לפני הכניסה.','Mark the base and final contraction you identified before entry on the chart.')
  };
  if(result.status==='possible')return {
    why:text('מיקום הכניסה מתאים לבדיקה המצומצמת. עדיין אין כאן אישור ל־VCP או למחזור בפריצה.','Entry location fits this limited check. This does not confirm VCP or breakout volume.'),
    next:text('השווה לנקודת הפריצה שתכננת ובדוק את ההתכווצות האחרונה והמחזור בזמן הכניסה.','Compare with your planned pivot and review the final contraction and volume at entry.')
  };
  return null;
}

function renderTradeSetupSuggestion(host, trade, bars, valid, options = null) {
  const compact = !!options?.compact;
  const result = tradeSetupSuggestion(trade,bars);
  const he = _lang === 'he';
  const panel = document.createElement('section'); panel.className = 'ss-setup-review';
  const title = document.createElement('strong');
  title.textContent = compact
    ? result.status === 'possible' ? (he ? 'פריצה אפשרית מבסיס' : 'Possible base breakout') : result.status === 'unknown' ? (he ? 'אין מספיק מידע לקביעה' : 'Not enough evidence') : (he ? 'לא זוהתה התאמה לפריצה מבסיס' : 'No base-breakout match')
    : he ? 'בדיקת סטאפ בכניסה' : 'Entry setup review';
  if(compact && result.reason==='distance'){
    title.textContent=he
      ? `לבדיקה: הכניסה ${Math.abs(result.distancePct).toFixed(1)}% ${result.distancePct<0?'מתחת':'מעל'} לשיא הקודם`
      : `Review: entry ${Math.abs(result.distancePct).toFixed(1)}% ${result.distancePct<0?'below':'above'} the prior high`;
    title.className='sensitive';
  }
  const message = document.createElement('p');
  message.textContent = tradeSetupExplanation(result,he);
  message.className = 'sensitive';
  const note = document.createElement('p'); note.className = 'ss-setup-note';
  note.textContent = he ? 'הצעה לפי נרות יומיים שקדמו ליום הכניסה. אינה מאמתת VCP, מחזור בפריצה או עמידה בכללים האישיים שלך.' : 'A hint from daily bars before entry day. It does not verify VCP, breakout volume or your personal rules.';
  panel.append(title);
  const button = document.createElement('button');button.type='button';button.className='btn btn-secondary btn-sm';
  button.textContent = compact ? (he ? 'עריכת התיעוד · אופציונלי' : 'Edit documentation · optional') : he ? (trade.setupType ? 'בדוק את הסטאפ המתועד' : 'בחר ואשר סטאפ') : (trade.setupType ? 'Review documented setup' : 'Choose and confirm setup');
  button.onclick = () => {
    if (!valid()) return;
    const latest = [...db.stocks,...db.crypto].find(row=>String(row.id)===String(trade.id) && row.type===trade.type);
    if (!latest) return;
    closeSSModal();openModal(latest.type,latest);
    // Suggestions remain separate from saved documentation until the user saves.
    if (!latest.setupType && result.status==='possible') modalSetSetup('breakout');
    const group=document.getElementById('m-setup-pills');
    group?.scrollIntoView({block:'center'});group?.querySelector('button[aria-pressed="true"],button')?.focus({preventScroll:true});
  };
  if (compact) {
    const details=document.createElement('details');details.className='lab-auto-explanation';
    const summary=document.createElement('summary');summary.textContent=he?'למה?':'Why?';
    const coach=tradeEntryCoach(result,trade,he);
    if(coach){
      const explain=document.createElement('div');explain.className='lab-entry-coach sensitive';
      const observation=Number.isFinite(result.referenceHigh)
        ? title.textContent+(he?' · שיא 20 נרות: ':' · 20-bar high: ')+result.referenceHigh.toLocaleString('en-US',{maximumFractionDigits:result.referenceHigh>=1?2:8})
        : message.textContent;
      for(const [label,value] of [[he?'מה זוהה':'Observed',observation],[he?'למה זה חשוב':'Why it matters',coach.why],[he?'בפעם הבאה':'Next time',coach.next]]){
        const row=document.createElement('p'),heading=document.createElement('strong');heading.textContent=label+': ';row.append(heading,document.createTextNode(value));explain.append(row);
      }
      note.textContent=he?'השיא המחושב אינו נקודת פריצה מאומתת. זו בדיקה מצומצמת של נרות לפני הכניסה, ללא אימות VCP, מחזור הפריצה או הכללים האישיים.':'The calculated high is not a verified pivot. This limited pre-entry bar check does not verify VCP, breakout volume or personal rules.';
      details.append(summary,explain,note,button);
    }else details.append(summary,message,note,button);
    panel.append(details);
  } else panel.append(message,note,button);
  if(compact && ['vcp','breakout'].includes(trade.setupType)){
    const structure=tradeBaseStructure(trade,bars);
    const detail=document.createElement('details');detail.className='lab-structure-review';
    const heading=document.createElement('summary');heading.textContent=he?'מבנה הבסיס · ניסיוני':'Base structure · experimental';
    const description=document.createElement('p');description.className='sensitive';
    description.textContent=structure.status==='unknown'
      ? (he?'אין מספיק נתונים תקינים לבדיקה המבנית.':'Insufficient valid data for structural review.')
      : structure.status==='candidate'
        ? (he?'זוהו שלוש נסיגות מצטמצמות: ':'Three shrinking pullbacks detected: ')+structure.contractions.map(n=>n.toFixed(1)+'%').join(' → ')+(he?'. נקודת פריצה משוערת: ':'. Estimated pivot: ')+structure.pivot.toLocaleString('en-US',{maximumFractionDigits:structure.pivot>=1?2:8})+'.'
        : (he?'לא זוהו שלוש נסיגות מצטמצמות שעומדות בתנאי הבדיקה. אין בכך שלילה של הסטאפ שלך.':'Three shrinking pullbacks meeting this check were not established. This does not rule out your setup.');
    detail.append(heading,description);
    if(structure.status!=='unknown'){
      const volume=document.createElement('p');volume.className='ss-setup-note sensitive';
      volume.textContent=structure.volume==='unknown'
        ? (he?'אין מספיק נתוני מחזור לבדיקה.':'Insufficient volume data.')
        : (he?'מחזור 5 הנרות האחרונים ביחס ל־20 שקדמו להם: ':'Volume over the last 5 bars relative to the preceding 20: ')+Math.round(structure.volumeRatio*100)+'%'+(structure.volume==='drying'?(he?' · זוהתה ירידה במחזור.':' · Volume dry-up detected.'):(he?' · לא זוהתה ירידה מספקת לפי סף הבדיקה.':' · No sufficient dry-up under this check.'));
      detail.append(volume);
      const trend=document.createElement('p');trend.className='ss-setup-note sensitive';
      const direction=structure.average21.direction;
      trend.textContent=(he?'ממוצע פשוט 21 לפני הכניסה: ':'Pre-entry 21-period SMA: ')+
        (direction==='unknown'?(he?'אין מספיק נתונים לשיפוע': 'insufficient slope history'):direction==='rising'?(he?'עולה':'rising'):direction==='falling'?(he?'יורד':'falling'):(he?'שטוח':'flat'))+
        (structure.average21.above?(he?' · הסגירה האחרונה מעליו או עליו.':' · Last close at or above it.'):(he?' · הסגירה האחרונה מתחתיו.':' · Last close below it.'))+
        (structure.risingLows===null?(he?' אין מספיק שפלים מאושרים להשוואה.':' Not enough confirmed lows to compare.'):structure.risingLows?(he?' שלושת השפלים האחרונים עולים.':' Last three lows are rising.'):(he?' שלושת השפלים האחרונים אינם עולים ברצף.':' Last three lows are not consistently rising.'));
      detail.append(trend);
    }
    const limit=document.createElement('small');limit.className='ss-setup-note';limit.textContent=he?'כללים ניסיוניים, לא אימות מלא של הסטאפ שלך. ממוצע פשוט 21 הוא בדיקת עזר. כניסת המשך, מגמה ארוכת טווח ומחזור בזמן הפריצה עדיין לא זוהו או נבדקו.':'Experimental rules, not full validation of your setup. The 21-period SMA is a diagnostic. Continuation entry, long-term trend and volume at breakout remain unassessed.';
    detail.append(limit);panel.querySelector('.lab-auto-explanation').append(detail);
  }
  host.append(panel);
}

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

