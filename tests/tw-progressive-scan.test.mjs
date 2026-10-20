import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
// The same module instances the scan uses.
import * as bundle from '../src/markets/tw/patterns/bundle.js?v=20261005-load16';
import {scanUniverse,fetchUniverse} from '../src/markets/tw/patterns/source.js';

// Fixed copy of a real official snapshot (tests/fixtures), not the daily data/.
const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const manifest=fixture.manifest,payload={date:fixture.date,algorithmVersion:fixture.algorithmVersion,entries:fixture.entries};
const entries=payload.entries.slice(0,4);
// Four real stocks, one per chunk.
const small={...manifest,total:4,classified:4,stocks:manifest.stocks.filter(row=>entries.some(e=>e.data.symbol===row.symbol)),
 chunks:entries.map((e,i)=>({file:`daily-0${i}.json`,count:1,symbols:[e.data.symbol]}))};
function fakeLoader(states){
 const listeners=new Set();
 return {starts:[],states,
  start(options){this.starts.push(options);return Promise.resolve();},
  state:()=>({phase:[...states.values()].some(value=>value==='pending')?'background':'done'}),
  symbolState:symbol=>states.get(symbol)||'failed',
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  set(symbol,value){states.set(symbol,value);for(const listener of listeners)listener();}};
}

test('the board publishes stocks as their chunks arrive and ends once every chunk is settled',async t=>{
 globalThis.localStorage??={getItem:()=>null,setItem:()=>{}};
 const fetched=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input),path=url.pathname;fetched.push(path.split('/').pop());
  if(path.endsWith('manifest.json'))return Response.json(small);
  if(/daily-0\d\.json$/.test(path))return Response.json({...payload,entries:[entries[Number(path.match(/daily-0(\d)/)[1])]]});
  // 2W/1M fallback to the data source (not reachable in this test).
  return new Response('unavailable',{status:503});
 });
 const universe=await fetchUniverse(new AbortController().signal);
 assert.deepEqual(fetched,['manifest.json'],'opening the board downloads the manifest only');
 assert.deepEqual(universe.tickers.map(row=>row.symbol).sort(),entries.map(e=>e.data.symbol).sort());
 await bundle.ensureBundleChunks([entries[0].data.symbol]);
 const [a,b,c,d]=entries.map(e=>e.data.symbol);
 const loader=fakeLoader(new Map([[a,'loaded'],[b,'pending'],[c,'pending'],[d,'pending']]));
 const seen=[],progress=[];let finished=false;
 const scan=scanUniverse(universe,['1D'],{signal:new AbortController().signal,loader,priority:{selected:b,visible:[c]},
  onSeries:async data=>{seen.push(data.symbol);},onProgress:p=>progress.push(p)}).then(()=>finished=true);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(seen,[a],'the first chunk is shown without waiting for the others');
 assert.equal(finished,false);
 const plan=loader.starts[0].priority;
 assert(plan.pinned.has(b)&&plan.pinned.has(c),'selected and visible stocks are prioritized');
 await bundle.ensureBundleChunks([b]);loader.set(b,'loaded');
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(seen,[a,b]);
 loader.set(c,'failed');loader.set(d,'deferred');
 await scan;
 assert.deepEqual(seen,[a,b]);
 assert.deepEqual(progress.at(-1),{done:4,total:4,failed:1,deferred:1,coinsDone:4,coinsTotal:4},'a failed chunk is reported, a deferred one is not counted as failed');
});

test('a timeframe missing from the snapshot still falls back to the data source for at most 8 stocks',async t=>{
 globalThis.localStorage??={getItem:()=>null,setItem:()=>{}};
 globalThis.OX_TW_DATA_API_BASE='https://api.example.test/api';t.after(()=>{delete globalThis.OX_TW_DATA_API_BASE;});
 // Ten real stocks in one chunk of a newer revision.
 const ten=payload.entries.slice(0,10),symbols=ten.map(e=>e.data.symbol);
 const revision={...small,updatedAt:'fallback-revision',total:10,classified:10,stocks:manifest.stocks.filter(row=>symbols.includes(row.symbol)),chunks:[{file:'daily-09.json',count:10,symbols}]};
 const requests=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);if(url.pathname.endsWith('manifest.json'))return Response.json(revision);
  if(url.pathname.endsWith('daily-09.json'))return Response.json({...payload,entries:ten});
  requests.push(url);return new Response('not found',{status:404});
 });
 await bundle.ensureBundleManifest({force:true});
 const universe=await fetchUniverse(new AbortController().signal);
 await bundle.ensureBundleChunks(symbols);
 const loader=fakeLoader(new Map(symbols.map(symbol=>[symbol,'loaded'])));
 const progress=[];
 await scanUniverse(universe,['2W'],{signal:new AbortController().signal,loader,onSeries:async()=>{},onProgress:p=>progress.push(p)});
 // Version 6 snapshots carry no 2W bars: the source is asked (3-year range)
 // for 8 stocks at most; every stock without bars is reported, none invented.
 const asked=new Set(requests.map(url=>url.searchParams.get('symbol')));
 assert.equal(asked.size,8,requests.join('\n'));
 assert(requests.every(url=>/candles/.test(url.pathname)&&url.searchParams.get('range')==='3Y'));
 assert.deepEqual([progress.at(-1).done,progress.at(-1).failed],[10,10]);
});
