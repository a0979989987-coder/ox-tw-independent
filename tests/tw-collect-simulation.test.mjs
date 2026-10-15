import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,symlink,rm} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {aggregateCandles,BASE_SESSION_CALENDAR,SESSION_ANCHOR} from '../src/markets/tw/patterns/model.js';

// Runs the real collector (scripts/collect-tw-patterns.mjs) offline on fixed
// copies of real official data: TWSE/TPEx responses are rebuilt from the
// fixture's official daily bars. Scenario: the daily window no longer reaches
// the anchor and the prior snapshot has no session calendar (an algorithm-6
// manifest), as on the first scheduled run after the anchor was introduced.
const run=promisify(execFile),repo=new URL('..',import.meta.url).pathname;
const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const next=JSON.parse(await readFile(new URL('./fixtures/tw-patterns-2026-10-15.json',import.meta.url)));
const bars=new Map(fixture.entries.map(e=>[e.data.symbol,[...e.data.candles,next.bars[e.data.symbol]].filter(Boolean)]));
const board=new Map(fixture.entries.map(e=>[e.data.symbol,e.data.board]));
const sessions=fixture.sessions;

const mock=`
const bars=${JSON.stringify(Object.fromEntries(bars))},board=${JSON.stringify(Object.fromEntries(board))};
const planned=${JSON.stringify(['2026-01-01',...BASE_SESSION_CALENDAR.closed.filter(d=>d!=='2026-07-10')])};
const refuseUntil=process.env.SIM_REFUSE_UNTIL||'';
const roc=d=>String(Number(d.slice(0,4))-1911)+d.slice(5,7)+d.slice(8);
const ok=json=>({ok:true,status:200,json:async()=>json});
globalThis.fetch=async url=>{url=String(url);
 if(url.includes('holidaySchedule'))return ok(planned.map(d=>({Name:'休市',Date:roc(d),Description:'市場無交易'})));
 let date;const t=url.match(/date=(\\d{8})/);if(t)date=t[1].slice(0,4)+'-'+t[1].slice(4,6)+'-'+t[1].slice(6);const o=url.match(/d=(\\d{3})%2F(\\d{2})%2F(\\d{2})/);if(o)date=(Number(o[1])+1911)+'-'+o[2]+'-'+o[3];
 if(date<=refuseUntil)return {ok:false,status:503,json:async()=>({})};
 const rows=Object.entries(bars).flatMap(([s,list])=>{const c=list.find(c=>c.date===date);return c?[[s,c]]:[];});
 if(url.includes('twse.com.tw')){if(!rows.length)return ok({stat:'很抱歉，沒有符合條件的資料!'});return ok({stat:'OK',date:date.replaceAll('-',''),tables:[{fields:['證券代號','證券名稱','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],data:rows.filter(([s])=>board[s]==='TWSE').map(([s,c])=>[s,'',String(c.volume),String(c.quoteVolume),String(c.open),String(c.high),String(c.low),String(c.close)])}]});}
 return ok({date:date.replaceAll('-',''),tables:[{fields:['代號','名稱','收盤','開盤','最高','最低','成交股數','成交金額元'],data:rows.filter(([s])=>board[s]==='TPEX').map(([s,c])=>[s,'',String(c.close),String(c.open),String(c.high),String(c.low),String(c.volume),String(c.quoteVolume)])}]});
};`;

async function workspace(){
  const dir=await mkdtemp(join(tmpdir(),'tw-collect-'));
  await mkdir(join(dir,'scripts'));await mkdir(join(dir,'data/tw-patterns'),{recursive:true});
  await copyFile(join(repo,'scripts/collect-tw-patterns.mjs'),join(dir,'scripts/collect-tw-patterns.mjs'));
  for(const name of ['server','src','node_modules'])await symlink(join(repo,name),join(dir,name));
  await writeFile(join(dir,'mock-official.mjs'),mock);
  return dir;
}
async function collect(dir,date,env={}){
  const stocks=fixture.entries.map(e=>{const c=bars.get(e.data.symbol).find(c=>c.date===date);return {symbol:e.data.symbol,name:e.data.name,market:e.data.board,price:c.close,changePct:0,turnoverTwd:c.quoteVolume};});
  await writeFile(join(dir,'data/tw-research.json'),JSON.stringify({date,stocks}));
  await run(process.execPath,['--import',join(dir,'mock-official.mjs'),'scripts/collect-tw-patterns.mjs'],{cwd:dir,env:{...process.env,TW_HISTORY_BACKFILL_MS:'1',...env},maxBuffer:1e8,timeout:120000});
  const manifest=JSON.parse(await readFile(join(dir,'data/tw-patterns/manifest.json'),'utf8'));
  const entries=JSON.parse(gunzipSync(await readFile(join(dir,'data/tw-patterns/daily-00.json.gz')))).entries;
  return {manifest,entries};
}
// Prior: an algorithm-6 snapshot without a session calendar whose window
// starts after the anchor (2026-01-16..2026-10-13).
async function seedPrior(dir){
  const dates=sessions.filter(d=>d>SESSION_ANCHOR&&d<='2026-10-13');
  const entries=fixture.entries.map(e=>({...e,data:{...e.data,dataDate:'2026-10-13',candles:e.data.candles.filter(c=>dates.includes(c.date))}}));
  await writeFile(join(dir,'data/tw-patterns/daily-00.json.gz'),gzipSync(JSON.stringify({date:'2026-10-13',algorithmVersion:6,entries})));
  await writeFile(join(dir,'data/tw-patterns/manifest.json'),JSON.stringify({date:'2026-10-13',updatedAt:'2026-10-13T09:00:00Z',algorithmVersion:6,frame:'1D',total:12,classified:12,unavailable:[],dates,closed:['2026-07-10'],
    chunks:[{file:'daily-00.json.gz',count:12,symbols:entries.map(e=>e.data.symbol)}],stocks:entries.map(e=>({symbol:e.data.symbol,name:e.data.name,market:e.data.board,price:1,changePct:0,turnoverTwd:1}))}));
}
const key=b=>[b.date,b.lastDate,b.open,b.high,b.low,b.close,b.volume].join('|');
const multi=(result,symbol,frame)=>{const e=result.entries.find(e=>e.data.symbol===symbol);return aggregateCandles(e.data.candles,frame,result.manifest.date,Date.parse(result.manifest.date+'T10:00:00Z'),{calendar:result.manifest.sessionCalendar});};

test('the collector builds 2/3/5-day bars when the window misses the anchor and the prior has no calendar, and they stay identical the next day',{timeout:300000},async()=>{
  const dir=await workspace();
  try{
    await seedPrior(dir);
    // Sessions up to 2026-01-15 cannot be fetched (official source refused):
    // the window starts after the anchor.
    const a=await collect(dir,'2026-10-14',{SIM_REFUSE_UNTIL:'2026-01-15'});
    assert.ok(a.manifest.dates[0]>SESSION_ANCHOR,'window does not reach the anchor');
    assert.equal(a.manifest.algorithmVersion,7);
    assert.ok(a.manifest.sessionCalendar.through>='2026-10-14','calendar covers the snapshot');
    assert.deepEqual(a.manifest.sessionCalendar.closed,BASE_SESSION_CALENDAR.closed);
    // 178 sessions: 2D/3D are published; 5D needs 35 complete groups, which a
    // window cut short by a refused source may miss by one.
    for(const e of a.entries)for(const frame of ['2D','3D'])assert.ok(e.frames[frame],`${e.data.symbol} ${frame} published`);
    // Next session, the prior's calendar removed again (worst case).
    const prior=JSON.parse(await readFile(join(dir,'data/tw-patterns/manifest.json'),'utf8'));delete prior.sessionCalendar;
    await writeFile(join(dir,'data/tw-patterns/manifest.json'),JSON.stringify(prior));
    const b=await collect(dir,'2026-10-15',{SIM_REFUSE_UNTIL:'2026-01-15'});
    assert.ok(b.manifest.sessionCalendar.through>='2026-10-15');assert.deepEqual(b.manifest.sessionCalendar,a.manifest.sessionCalendar);
    for(const e of b.entries)for(const frame of ['2D','3D','5D'])assert.ok(e.frames[frame],`${e.data.symbol} ${frame} published on the next day`);
    // Day-by-day replay: every bar published on both days has the same members.
    let compared=0;
    for(const symbol of bars.keys())for(const frame of ['2D','3D','5D']){
      const before=new Map(multi(a,symbol,frame).map(bar=>[bar.date,key(bar)]));
      const after=multi(b,symbol,frame);assert.ok(after.length>=30,`${symbol} ${frame}`);
      for(const bar of after)if(before.has(bar.date)){assert.equal(key(bar),before.get(bar.date),`${symbol} ${frame} ${bar.date}`);compared++;}
    }
    assert.ok(compared>12*3*25);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('with the official source reachable the 185-session window publishes 2D, 3D and 5D for every stock',{timeout:300000},async()=>{
  const dir=await workspace();
  try{
    await seedPrior(dir);
    // Sessions before 2026-01-15 are not in the fixture: the source answers
    // "no data" for them, so the window starts at the anchor (180 sessions).
    const result=await collect(dir,'2026-10-15');
    assert.equal(result.manifest.dates[0],SESSION_ANCHOR);
    for(const e of result.entries)for(const frame of ['2D','3D','5D'])assert.ok(e.frames[frame],`${e.data.symbol} ${frame}`);
  }finally{await rm(dir,{recursive:true,force:true});}
});
