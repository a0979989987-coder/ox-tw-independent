import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {buildHistory,buildPatternEntry,historyFiles,historyBucket,historyTarget,ALGORITHM_VERSION} from '../server/markets/tw/pattern-snapshot.js';

// Synthetic fixture (not market data): weekday bars over five years so that
// 2W/1M frames exist; only used to exercise packaging and loading.
function syntheticDaily(seed,from,to){const out=[];for(let d=new Date(from+'T00:00:00Z'),i=0;d.toISOString().slice(0,10)<=to;d.setUTCDate(d.getUTCDate()+1)){const day=d.getUTCDay();if(!day||day===6)continue;const date=d.toISOString().slice(0,10),base=100+seed+20*Math.sin((i+seed)/37);i++;out.push({date,time:Date.parse(date+'T00:00:00+08:00')/1000,open:base,high:base+2,low:base-2,close:base+Math.sin(i+seed)*1.5,volume:1e6+i,quoteVolume:1e8+i});}return out;}
const asOf='2026-10-14',symbols=['9901','9902','9903'];
const stocks=symbols.map((symbol,i)=>({symbol,name:'測試'+i,market:'TWSE',price:100,changePct:0,turnoverTwd:1e9-i}));
const built=symbols.map((symbol,i)=>{const all=syntheticDaily(i,'2021-01-01',asOf),window=all.slice(-180),windowStart=window[0].date;
 const history=buildHistory({daily:all,from:historyTarget(windowStart),windowStart,asOf});
 return {history,entry:buildPatternEntry(stocks[i],window,asOf,{calendar:null,history})};});

test('history files are deterministic, keep each stock in a fixed file and change only with their content',()=>{
 const histories=new Map(built.map((b,i)=>[symbols[i],b.history]));
 const files=historyFiles(histories),again=historyFiles(new Map([...histories].reverse()));
 assert.deepEqual(files.map(f=>f.text),again.map(f=>f.text),'turnover order does not move stocks between files');
 assert.deepEqual(gzipSync(files[1].text,{level:9}),gzipSync(again[1].text,{level:9}),'same content, same bytes');
 for(const symbol of symbols)assert.ok(files[historyBucket(symbol)].symbols.includes(symbol));
 assert.ok(!/20\d\d-\d\d-\d\dT/.test(files.map(f=>f.text).join('')),'no timestamps in history files');
 // One stock's newly completed week changes its own file only.
 const changed=new Map(histories);changed.set('9902',{...histories.get('9902'),weeks:[...histories.get('9902').weeks.slice(1),['2026-10-05',1,2,1,2,3]]});
 const after=historyFiles(changed);
 assert.deepEqual(after.map((f,i)=>f.text!==files[i].text?i:null).filter(i=>i!==null),[historyBucket('9902')]);
 // The daily chunk entry no longer carries history.
 for(const b of built){assert.equal(b.entry.data.history,undefined);assert.ok(b.entry.frames['2W']&&b.entry.frames['1M']);}
});

const fileOf=symbol=>`history-${String(historyBucket(symbol)).padStart(2,'0')}.json.gz`;
const historyPayload=symbol=>historyFiles(new Map([[symbol,built[symbols.indexOf(symbol)].history]]))[historyBucket(symbol)].text;
const manifest={date:asOf,updatedAt:'2026-10-14T09:00:00Z',algorithmVersion:ALGORITHM_VERSION,total:3,classified:3,unavailable:[],dates:[],stocks,
 chunks:symbols.map((symbol,i)=>({file:`daily-0${i}.json.gz`,count:1,symbols:[symbol]})),
 history:{version:1,buckets:20,frames:['2W','1M'],files:Array.from({length:20},(_,i)=>({file:`history-${String(i).padStart(2,'0')}.json.gz`,count:0,hash:'h'+i}))}};

test('2W/1M wait for their history file, which is downloaded only when asked for',async t=>{
 const bundle=await import('../src/markets/tw/patterns/bundle.js?history-files');
 const calls=[];
 t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input),name=url.pathname.split('/').pop();calls.push(name);
  if(name==='manifest.json')return Response.json(manifest);
  const daily=name.match(/^daily-0(\d)\.json\.gz$/);if(daily)return new Response(gzipSync(JSON.stringify({date:asOf,algorithmVersion:ALGORITHM_VERSION,entries:[built[Number(daily[1])].entry]})));
  const symbol=symbols.find(s=>fileOf(s)===name);if(symbol){assert.equal(url.searchParams.get('h'),'h'+historyBucket(symbol),'versioned by content hash');return new Response(gzipSync(historyPayload(symbol)));}
  return new Response('missing',{status:404});});
 const [a,b,c]=symbols;
 await bundle.ensureBundleChunks([a,b]);
 assert.ok(bundle.bundleEntry(a,'1D')&&bundle.bundleEntry(a,'1W'),'other frames are ready at once');
 assert.equal(bundle.bundleEntry(a,'2W'),null);assert.equal(bundle.bundleEntry(a,'1M'),null);
 assert.ok(!calls.some(name=>name.startsWith('history-')),'1D does not download history');
 assert.equal(bundle.hasBundleHistory(),true);
 const result=await bundle.ensureHistoryChunks([a]);
 assert.deepEqual(result,{files:[fileOf(a)],failed:[],errors:[]});
 assert.deepEqual(calls.filter(name=>name.startsWith('history-')),[fileOf(a)],'only the file holding the stock');
 const twoWeek=bundle.bundleEntry(a,'2W'),month=bundle.bundleEntry(a,'1M');
 assert.ok(twoWeek.data.candles.length>=35&&month.data.candles.length>=35);
 assert.ok(twoWeek.classic&&month.classic);
 assert.equal(bundle.bundleEntry(b,'2W'),null,'another file is not loaded');
 assert.equal(bundle.bundleHistoryChunks().find(item=>item.file===fileOf(a)).status,'loaded');
 // Again: held in memory, nothing downloaded.
 await bundle.ensureHistoryChunks([a]);assert.equal(calls.filter(name=>name===fileOf(a)).length,1);
 // History first, chunk later: the stock is classified with its history at once.
 await bundle.ensureHistoryChunks([c]);await bundle.ensureBundleChunks([c]);
 assert.ok(bundle.bundleEntry(c,'2W')&&bundle.bundleEntry(c,'1M'));
});

test('the board loads history files only when it scans 2W or 1M',async t=>{
 globalThis.localStorage??={getItem:()=>null,setItem:()=>{}};
 const bundle=await import('../src/markets/tw/patterns/bundle.js?v=20261005-load16');
 const {scanUniverse}=await import('../src/markets/tw/patterns/source.js');
 t.mock.method(globalThis,'fetch',async input=>{const name=new URL(input).pathname.split('/').pop();
  if(name==='manifest.json')return Response.json(manifest);
  const daily=name.match(/^daily-0(\d)\.json\.gz$/);if(daily)return new Response(gzipSync(JSON.stringify({date:asOf,algorithmVersion:ALGORITHM_VERSION,entries:[built[Number(daily[1])].entry]})));
  const symbol=symbols.find(s=>fileOf(s)===name);if(symbol)return new Response(gzipSync(historyPayload(symbol)));
  return new Response('missing',{status:404});});
 await bundle.ensureBundleManifest({force:true});await bundle.ensureBundleChunks(symbols);
 const fake=()=>{const listeners=new Set();return {starts:0,start(){this.starts++;return Promise.resolve();},state:()=>({phase:'done'}),symbolState:()=>'loaded',subscribe(l){listeners.add(l);return()=>listeners.delete(l);}};};
 const universe={tickers:stocks,dataDate:asOf};
 for(const [frames,expected] of [[['1D','1W'],0],[['2W'],1],[['1M','1D'],1]]){
  const loader=fake(),history=fake();
  await scanUniverse(universe,frames,{signal:new AbortController().signal,loader,history,onSeries:async()=>{},onProgress:()=>{}});
  assert.equal(history.starts,expected,frames.join('+'));
 }
 // With the files loaded the scan returns 2W stocks from the snapshot itself.
 await bundle.ensureHistoryChunks(symbols);
 const seen=[];
 await scanUniverse(universe,['2W'],{signal:new AbortController().signal,loader:fake(),history:fake(),onSeries:async data=>{seen.push(data.symbol);},onProgress:()=>{}});
 assert.deepEqual(seen.sort(),[...symbols].sort());
});
