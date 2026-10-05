import test from 'node:test';
import assert from 'node:assert/strict';
import {chartHistory,loadHistoryPage,historyRange,mergeDailyHistory,preserveHistoryViewport} from '../src/markets/tw/chart-history.js';
import {aggregateChartCandles} from '../src/markets/tw/chart-data.js';
const bar=date=>({date,open:10,high:12,low:9,close:11,volume:100});
const page=(record,range,rows=[])=>({symbol:record.symbol,market:record.market,from:range.from,to:range.to,adjusted:false,candles:rows,meta:{historyPage:true,earliestAvailableDate:record.floor}});

test('full chart history walks bounded ranges to the official floor and keeps more than 200 genuine bars',async()=>{
 const record=await chartHistory('6001','TPEX','1995-09-30',[]),ranges=[];
 while(!record.complete)await loadHistoryPage(record,null,async range=>{
  ranges.push(range);const rows=[];
  for(let t=Date.parse(range.from+'T00:00:00Z');t<=Date.parse(range.to+'T00:00:00Z');t+=86400000){const date=new Date(t);if(![0,6].includes(date.getUTCDay()))rows.push(bar(date.toISOString().slice(0,10)));}
  return page(record,range,rows);
 });
 assert.equal(ranges.length,7);assert.equal(ranges[0].to,'1995-09-30');assert.equal(ranges.at(-1).from,'1994-01-01');
 assert(record.daily.length>400);assert.equal(record.daily[0].date,'1994-01-03');assert.equal(record.daily.at(-1).date,'1995-09-29');
 assert.equal(record.cursor,'1993-12-31');
});
test('successful empty ranges do not stop history early, but outages and mismatched ranges never advance it',async()=>{
 const record=await chartHistory('6002','TPEX','1994-04-30',[bar('1994-04-30')]);
 await loadHistoryPage(record,null,range=>page(record,range));assert.equal(record.complete,false);assert.equal(record.cursor,'1994-01-31');
 const cursor=record.cursor;
 await assert.rejects(loadHistoryPage(record,null,()=>{throw Error('offline');}),/offline/);
 assert.equal(record.cursor,cursor);assert.equal(record.complete,false);assert.equal(record.daily.at(-1).date,'1994-04-30');
 await assert.rejects(loadHistoryPage(record,null,range=>({...page(record,range),from:'1994-02-01'})),/範圍不符/);
 assert.equal(record.cursor,cursor);
 await loadHistoryPage(record,null,range=>page(record,range));assert.equal(record.complete,true);assert.equal(record.error,null);
});
test('concurrent loads coalesce and aborted stock/frame changes cannot replace retained bars or advance cursors',async()=>{
 const record=await chartHistory('6003','TWSE','2010-03-31',[bar('2010-03-31')]),controller=new AbortController();let finish,calls=0;
 const fetchPage=range=>{calls++;return new Promise(resolve=>{finish=()=>resolve(page(record,range,[bar('2010-01-04')]));});};
 const first=loadHistoryPage(record,controller.signal,fetchPage),second=loadHistoryPage(record,controller.signal,fetchPage);
 finish();await Promise.all([first,second]);assert.equal(calls,1);assert.equal(record.complete,true);
 const canceled=await chartHistory('6004','TWSE','2010-12-31',[bar('2010-12-31')]),abort=new AbortController();let resume;
 const pending=loadHistoryPage(canceled,abort.signal,range=>new Promise(resolve=>{resume=()=>resolve(page(canceled,range,[bar('2010-07-01')]));}));
 abort.abort();resume();await assert.rejects(pending,{name:'AbortError'});assert.equal(canceled.cursor,'2010-12-31');assert.equal(canceled.daily.length,1);assert.equal(canceled.error,null);
});
test('prepend retains visible dates even if a new completed candle is added at the right edge',()=>{
 const previous=[{time:20},{time:30},{time:40}],next=[{time:0},{time:10},...previous,{time:50}];
 assert.deepEqual(preserveHistoryViewport(previous,next,{from:1,to:2}),{from:3,to:4});
 const bars=mergeDailyHistory([bar('2010-01-04'),bar('2010-01-07')],[{...bar('2010-01-07'),close:12},bar('2010-01-08')],'2010-01-07');
 assert.deepEqual(bars.map(c=>c.date),['2010-01-04','2010-01-07']);assert.equal(bars[1].close,12);
 assert.deepEqual(historyRange('2010-02-28','2010-01-01'),{from:'2010-01-01',to:'2010-02-28'});
});
test('verified first months and quarters are complete without requiring a candle on a holiday',()=>{
 const daily=mergeDailyHistory([],[bar('2010-01-04'),bar('2010-01-29'),bar('2010-03-31'),bar('2010-04-01')],'2010-04-01');
 const quarter=aggregateChartCandles(daily,'1Q','2010-04-01',{coverageStart:'2010-01-01'});
 assert.equal(quarter[0].date,'2010-01-01');assert.equal(quarter[0].volume,300);
 const monthly=aggregateChartCandles(daily,'1M','2010-04-01',{coverageStart:'2010-01-01'});
 assert.deepEqual(monthly.map(c=>c.date),['2010-01-01','2010-03-01']);assert.equal(monthly[0].volume,200);
 assert.deepEqual(aggregateChartCandles(daily,'1Q','2010-04-01',{coverageStart:'2010-01-13'}),[]);
});


test('blocked optional browser storage cannot prevent verified seed candles from rendering',async t=>{
 const previous=globalThis.indexedDB;
 globalThis.indexedDB={open(){return {};}};
 t.after(()=>{if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous;});
 const record=await chartHistory('6008','TWSE','2026-10-05',[bar('2026-10-05')]);
 assert.equal(record.daily.length,1);assert.equal(record.daily[0].close,11);
});
