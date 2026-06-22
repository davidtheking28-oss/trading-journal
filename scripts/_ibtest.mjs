import { readFileSync } from 'node:fs';
const token = readFileSync(process.env.TOKFILE, 'utf8').trim();
const BASE = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService';
const UA = { 'User-Agent': 'trading-journal/2.0' };
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function probe(label, qid) {
  console.log(`\n=== ${label} (q=${qid}) ===`);
  const r = await fetch(`${BASE}.SendRequest?t=${token}&q=${qid}&v=3`, { headers: UA });
  const xml = await r.text();
  const status = tag(xml, 'Status');
  const ref = tag(xml, 'ReferenceCode');
  if (status === 'Fail' || !ref) {
    console.log(`  SendRequest FAIL  code=${tag(xml,'ErrorCode')}  msg=${tag(xml,'ErrorMessage')}`);
    return;
  }
  console.log(`  SendRequest OK  ref=${ref} — polling...`);
  const DELAYS = [3000, 5000, 8000, 10000, 15000, 20000, 25000];
  for (let i = 0; i < DELAYS.length; i++) {
    await sleep(DELAYS[i]);
    const r2 = await fetch(`${BASE}.GetStatement?t=${token}&q=${encodeURIComponent(ref)}&v=3`, { headers: UA });
    const x2 = await r2.text();
    if (tag(x2, 'Status') === 'Fail') {
      const code = tag(x2, 'ErrorCode');
      console.log(`  poll[${i}] still building / error  code=${code}  msg=${tag(x2,'ErrorMessage')}`);
      if (!['1001','1004','1005','1006','1007','1008','1009','1018','1019','1021'].includes(code)) {
        console.log('  -> non-retryable, stop'); return;
      }
      continue;
    }
    const trades = (x2.match(/<Trade |<TradeConfirm /g) || []).length;
    const period = (x2.match(/period="([^"]*)"/) || [])[1] || '?';
    const type = (x2.match(/type="([^"]*)"/) || [])[1] || '?';
    console.log(`  GetStatement OK  bytes=${x2.length}  trades/confirms=${trades}  period="${period}"  type="${type}"`);
    return;
  }
  console.log('  poll timed out');
}

await probe('ACTIVITY', '1474837');
await probe('CONFIRM', '1547558');
