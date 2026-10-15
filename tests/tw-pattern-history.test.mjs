import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {aggregateCandles,calendarFromSessions,weekStart,expandHistory} from '../src/markets/tw/patterns/model.js';
import {buildHistory,buildPatternEntry,historyTarget,HISTORY_WEEKS,HISTORY_MONTHS} from '../server/markets/tw/pattern-snapshot.js';
import {qualifyBundleEntry} from '../src/markets/tw/patterns/qualification.js';

// Fixed copy of a real official snapshot (tests/fixtures), not the daily data/.
const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const manifest={date:fixture.date,dates:fixture.sessions.filter(d=>d<=fixture.date)},payload=fixture;
const entry=payload.entries.find(e=>e.data.candles.length===manifest.dates.length);
const daily=entry.data.candles,sessions=manifest.dates,calendar=calendarFromSessions(sessions);
const truth=(bars,key)=>{const m=new Map();for(const c of bars){const k=key(c.date);if(!m.has(k))m.set(k,[]);m.get(k).push(c);}
  return new Map([...m].map(([k,b])=>[k,[k,b[0].open,Math.max(...b.map(c=>c.high)),Math.min(...b.map(c=>c.low)),b.at(-1).close,b.reduce((n,c)=>n+c.volume,0)]]));};

test('history built run by run (sliding window + bounded back-fill) equals the weeks/months of the full official history',()=>{
  // Replay: a 40-session window slides one session per run while each run
  // back-fills at most 7 older weekdays, exactly as the collector does.
  const W=40,start=120;let prior=null,from=null;
  for(let k=start;k<sessions.length;k++){
    const asOf=sessions[k],window=sessions.slice(k-W+1,k+1),windowStart=window[0];
    const previousWindow=k>start?sessions.slice(k-W,k):[];
    // The collector knows the current window and the bars that just left it.
    const known=new Set([...window,...previousWindow]);
    if(!from)from=windowStart;
    // Back-fill weekdays below `from`, newest first (closed days have no bar).
    for(let n=0,d=from;n<7;n++){d=new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10);if(d<daily[0].date)break;from=d;known.add(d);}
    const bars=daily.filter(c=>known.has(c.date)&&c.date<=asOf);
    prior=buildHistory({daily:bars,prior,from,windowStart,asOf,calendar});
    // The history never repeats a session that is still in the window.
    assert.ok(prior.weeks.every(r=>r[0]<=weekStart(windowStart))&&prior.months.every(r=>r[0]<=windowStart));
  }
  const all=daily.filter(c=>c.date>=from);
  const weeks=truth(all,weekStart),months=truth(all,d=>d.slice(0,7)+'-01');
  assert.ok(prior.weeks.length>=20&&prior.months.length>=4,'replay must exercise a meaningful history');
  // Every published period matches the full official history, except that a
  // first period starting before `from` is never published.
  for(const r of prior.weeks){assert.ok(r[0]>=weekStart(from));assert.deepEqual(r,weeks.get(r[0]),'week '+r[0]);}
  for(const r of prior.months){assert.ok(r[0]>=from.slice(0,7)+'-01');assert.deepEqual(r,months.get(r[0]),'month '+r[0]);}
  // No completed week between the covered start and the window boundary is missing.
  const last=weekStart(sessions[sessions.length-W]);
  for(const w of weeks.keys())if(w>weekStart(from)&&w<=last)assert.ok(prior.weeks.some(r=>r[0]===w),'missing week '+w);
});

test('2W uses the shipped weeks before the daily window and matches the full-history aggregation',()=>{
  const asOf=manifest.date,now=Date.parse(asOf+'T10:00:00Z');
  const full=aggregateCandles(daily,'2W',asOf,now,{calendar});
  // Ship the first 100 sessions as history; keep only the remaining daily window.
  const windowStart=sessions[100],history=buildHistory({daily,from:daily[0].date,windowStart,asOf,calendar});
  const window=daily.filter(c=>c.date>=windowStart);
  const short=aggregateCandles(window,'2W',asOf,now,{calendar}),merged=aggregateCandles(window,'2W',asOf,now,{calendar,history});
  assert.ok(merged.length>short.length+5);
  const key=b=>[b.date,b.open,b.high,b.low,b.close,b.volume].join('|');
  assert.deepEqual(merged.map(key),full.map(key));
  const monthly=aggregateCandles(window,'1M',asOf,now,{calendar,history});
  assert.deepEqual(monthly.map(key),aggregateCandles(daily,'1M',asOf,now,{calendar}).map(key));
});

// Synthetic fixture (not market data): five years of weekday bars, used only to
// prove frame creation once enough history exists.
function syntheticDaily(from,to){const out=[];for(let d=new Date(from+'T00:00:00Z'),i=0;d.toISOString().slice(0,10)<=to;d.setUTCDate(d.getUTCDate()+1)){const day=d.getUTCDay();if(!day||day===6)continue;const date=d.toISOString().slice(0,10),base=100+20*Math.sin(i/37)+i*.01;i++;out.push({date,time:Date.parse(date+'T00:00:00+08:00')/1000,open:base,high:base+2,low:base-2,close:base+Math.sin(i)*1.5,volume:1e6+i,quoteVolume:1e8+i});}return out;}

test('the snapshot builder publishes 2W and 1M frames once back-filled history reaches 35 bars',()=>{
  const asOf='2026-10-14',all=syntheticDaily('2021-01-01',asOf),window=all.slice(-180),windowStart=window[0].date;
  const stock={symbol:'9999',name:'測試',market:'TWSE',turnoverTwd:1,changePct:0};
  const without=buildPatternEntry(stock,window,asOf,{calendar:null});
  assert.ok(!without.frames['2W']&&!without.frames['1M'],'180 sessions alone cannot form 2W/1M');
  const history=buildHistory({daily:all,from:historyTarget(windowStart),windowStart,asOf});
  assert.ok(history.weeks.length<=HISTORY_WEEKS&&history.months.length<=HISTORY_MONTHS&&history.edge.length===0);
  const built=buildPatternEntry(stock,window,asOf,{calendar:null,history});
  assert.ok(built.frames['2W']&&built.frames['1M']);
  // History travels in its own file, not in the daily chunk.
  assert.equal(built.data.history,undefined);
  const shipped={...built,data:{...built.data,history}};
  // The browser rebuilds the same bars from the shipped entry.
  const now=Date.parse(asOf+'T10:00:00Z'),client=qualifyBundleEntry(JSON.parse(JSON.stringify(shipped)),asOf,now);
  assert.ok(client.frames['2W']&&client.frames['1M']);
  assert.ok(aggregateCandles(built.data.candles,'1M',asOf,now,{history}).length>=35);
  assert.ok(aggregateCandles(built.data.candles,'2W',asOf,now,{history}).length>=35);
});

test('invalid shipped history rows are ignored instead of becoming bars',()=>{
  assert.deepEqual(expandHistory([['2026-01-05',10,9,11,10,1,1],['bad',1,1,1,1,1,1],['2026-01-12',10,12,9,11,-5,1]]),[]);
  assert.equal(expandHistory([['2026-01-05',10,12,9,11,5,null]])[0].quoteVolume,null);
});
