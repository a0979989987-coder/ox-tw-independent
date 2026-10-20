import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {qualifyBundleEntry} from '../src/markets/tw/patterns/qualification.js';
import {classifyTWSeries} from '../src/markets/tw/classic.js';
import {qualifyPatternMatches} from '../src/components/patterns/matcher.js';
import {patternById} from '../src/components/patterns/catalog.js';
import {legacyAggregateCandles} from '../src/markets/tw/patterns/model.js';

// Fixed copy of a real algorithm-6 snapshot (tests/fixtures), not the daily data/.
const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const payload=fixture;
const date=fixture.date,now=Date.parse(date+'T08:00:00Z');

// The aggregation published with algorithm 6 (commit 23ae01a), verbatim.
function weekStart(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
function v6Weekly(daily,asOf,now){const groups=new Map(),local=new Date(now+8*3600000),today=local.toISOString().slice(0,10),thisWeek=weekStart(today),day=local.getUTCDay(),officialFriday=new Date(asOf+'T00:00:00Z').getUTCDay()===5;
 for(const c of daily){const week=weekStart(c.date);if(week>thisWeek||week===thisWeek&&day!==0&&day!==6&&!officialFriday)continue;const group=groups.get(week);
  if(!group)groups.set(week,{...c,date:week,time:Date.parse(week+'T00:00:00+08:00')/1000,lastDate:c.date});else{group.high=Math.max(group.high,c.high);group.low=Math.min(group.low,c.low);group.close=c.close;group.volume+=c.volume;group.quoteVolume=group.quoteVolume===null||c.quoteVolume===null?null:group.quoteVolume+c.quoteVolume;group.lastDate=c.date;}}
 return [...groups.values()];}
function v6Aggregate(daily,frame,asOf,now){
 if(frame==='1D')return daily;if(frame==='1W')return v6Weekly(daily,asOf,now);
 const combine=(bars,date=bars[0].date)=>({date,time:Date.parse(date+'T00:00:00+08:00')/1000,lastDate:bars.at(-1).lastDate||bars.at(-1).date,open:bars[0].open,high:Math.max(...bars.map(c=>c.high)),low:Math.min(...bars.map(c=>c.low)),close:bars.at(-1).close,volume:bars.reduce((n,c)=>n+c.volume,0),quoteVolume:bars.every(c=>Number.isFinite(c.quoteVolume))?bars.reduce((n,c)=>n+c.quoteVolume,0):null});
 if(frame==='1M'){const months=new Map();for(const c of daily){const month=c.date.slice(0,7);if(month>=asOf.slice(0,7)||month===daily[0]?.date.slice(0,7))continue;if(!months.has(month))months.set(month,[]);months.get(month).push(c);}return [...months].map(([month,bars])=>combine(bars,month+'-01'));}
 if(frame==='2W'){const weeks=v6Weekly(daily,asOf,now),groups=new Map();for(const c of weeks){const anchor=Math.floor((Date.parse(c.date+'T00:00:00Z')-Date.parse('1970-01-05T00:00:00Z'))/(14*86400000));if(!groups.has(anchor))groups.set(anchor,[]);groups.get(anchor).push(c);}return [...groups.values()].filter(b=>b.length===2).map(b=>combine(b));}
 const count=Number(frame.slice(0,-1)),complete=[],offset=daily.length%count;for(let i=offset;i+count<=daily.length;i+=count)complete.push(combine(daily.slice(i,i+count)));return complete;}
function v6Qualify(entry){
 const one=(candles,frame,matches)=>{const classic=classifyTWSeries(candles,frame);return {classic,matches:qualifyPatternMatches({candles,classic,volatility:classic.long.atr||classic.short.atr||0},matches)};};
 return {...one(entry.data.candles,'1D',entry.matches),frames:Object.fromEntries(Object.entries(entry.frames||{}).map(([frame,value])=>[frame,one(v6Aggregate(entry.data.candles,frame,date,now),frame,value.matches)]))};
}
const named=result=>Object.values(result.frames).reduce((n,f)=>n+Object.keys(f.matches).filter(id=>!/^(level|trend)/.test(patternById(id)?.rule||'')).length,0);

test('an algorithm-6 snapshot keeps its bars and named shapes exactly as version 6 showed them',t=>{
 t.mock.method(Date,'now',()=>now);
 assert.equal(payload.algorithmVersion,6);
 for(const frame of ['2D','3D','5D','1W','2W','1M'])for(const e of payload.entries)
  assert.deepEqual(legacyAggregateCandles(e.data.candles,frame,date,now),v6Aggregate(e.data.candles,frame,date,now),frame);
 let shapes=0;
 for(const e of payload.entries.slice(0,12)){
  const client=qualifyBundleEntry({...e,legacyFrames:true},date,now);
  assert.deepEqual(client,v6Qualify(e));shapes+=named(client);
 }
 // Named shapes on 2/3/5-day and weekly bars are not cleared.
 assert.ok(shapes>0,'the sample must contain named multi-day shapes');
});

test('a version-7 snapshot uses the anchored grouping (legacy bars are not applied to it)',()=>{
 const e=payload.entries.find(x=>x.data.candles.length>=170);
 const v7=qualifyBundleEntry({...e,legacyFrames:false},date,now),v6=qualifyBundleEntry({...e,legacyFrames:true},date,now);
 assert.notDeepEqual(Object.keys(v7.frames).map(f=>v7.frames[f].classic),Object.keys(v6.frames).map(f=>v6.frames[f].classic));
});
