import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import worker from '../worker/index.js';
import {quoteUniverseFromSnapshot} from '../api/v1/tw/providers/quotes.js';
import {readJSONBody} from '../src/components/json-body.js';

const REPO='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
const row=(symbol,market,price)=>({symbol,name:symbol,market,industry:'',theme:'',price,changePct:1,volume:1000,turnoverTwd:100000,oxScore:null,tier:'',setup:'',dataDate:'2026-10-16',updatedAt:'2026-10-16'});
const snapshot=(savedAt=Date.now()-1000)=>({savedAt,data:{dataDate:'2026-10-16',updatedAt:'2026-10-16T10:04:51.633Z',
 meta:{partial:false,total:3,sources:{TWSE:'ready',TPEX:'ready'}},
 radar:[row('2330','TWSE',2420),row('6210','TPEX',18.75),row('8299','TPEX',1890)]}});
// Official month pages: one bar on the 15th of whichever month is requested.
function officialMonth(url){
 if(url.pathname.endsWith('/STOCK_DAY')){const d=url.searchParams.get('date');
  return {stat:'OK',data:[[`${d.slice(0,4)-1911}/${d.slice(4,6)}/15`,'1,000','2,000,000','100.00','110.00','95.00','105.00','+5.00','10']]};}
 if(url.pathname.endsWith('/tradingStock')){const [y,m]=url.searchParams.get('date').split('/');
  return {stat:'ok',tables:[{data:[[`${y-1911}/${m}/15`,'1','2','100.00','110.00','95.00','105.00','5.00','10']]}]};}
 return null;
}
const assets=(files={})=>({async fetch(request){const path=new URL(request.url??request).pathname.slice(1);
 return files[path]?new Response(files[path]):new Response('static:'+path,{status:files[path]===undefined?404:200});}});

test('a complete published snapshot proves membership; partial, one-market or stale copies do not',()=>{
 const saved=snapshot(1000000),now=1000000+5000;
 const universe=quoteUniverseFromSnapshot(saved,now);
 assert.equal(universe.dataDate,'2026-10-16');assert.equal(universe.rows.length,3);assert.equal(universe.meta.universeSource,'independent-verified-snapshot');
 assert.equal(quoteUniverseFromSnapshot({...saved,data:{...saved.data,meta:{...saved.data.meta,partial:true}}},now),null);
 assert.equal(quoteUniverseFromSnapshot({...saved,data:{...saved.data,meta:{...saved.data.meta,sources:{TWSE:'ready',TPEX:'error'}}}},now),null);
 assert.equal(quoteUniverseFromSnapshot({...saved,data:{...saved.data,radar:saved.data.radar.filter(r=>r.market==='TWSE')}},now),null);
 assert.equal(quoteUniverseFromSnapshot(saved,1000000+8*86400000),null);
 assert.equal(quoteUniverseFromSnapshot({...saved,data:{...saved.data,dataDate:'20261016'}},now),null);
});

test('quote and candles identify TWSE / TPEx from the GitHub snapshot without rebuilding the market list',async t=>{
 const bytes=JSON.stringify(snapshot()),requested=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input?.url??input));requested.push(url.href);
  if(url.href===REPO+'data/tw-radar.json')return new Response(bytes);
  const month=officialMonth(url);if(month)return Response.json(month);
  return new Response('unexpected',{status:500});
 });
 const env={ASSETS:assets()};
 for(const [symbol,market,price]of [['2330','TWSE',2420],['6210','TPEX',18.75],['8299','TPEX',1890]]){
  const quote=await (await worker.fetch(new Request(`https://ox.test/api/v1/tw/quote?symbol=${symbol}`),env,{})).json();
  assert.equal(quote.ok,true);assert.equal(quote.data.market,market);assert.equal(quote.data.price,price);
  assert.equal(quote.data.dataDate,'2026-10-16');assert.equal(quote.data.universeSource,'independent-verified-snapshot');
  const response=await worker.fetch(new Request(`https://ox.test/api/v1/tw/candles?symbol=${symbol}&from=2026-09-01&to=2026-10-16`),env,{});
  const candles=await response.json();
  assert.equal(response.status,200);assert.equal(candles.data.market,market);
  assert.deepEqual(candles.data.candles.map(c=>[c.date,c.open,c.high,c.low,c.close]),[['2026-09-15',100,110,95,105],['2026-10-15',100,110,95,105]]);
 }
 const universeSources=requested.filter(url=>/MI_INDEX|STOCK_DAY_ALL|otc_quotes|tpex_mainboard_quotes|t187ap05/.test(url));
 assert.deepEqual(universeSources,[]);
 assert.equal(requested.filter(url=>url===REPO+'data/tw-radar.json').length,1,'snapshot bytes are memoized');
 const missing=await worker.fetch(new Request('https://ox.test/api/v1/tw/quote?symbol=9999'),env,{});
 assert.equal(missing.status,404);assert.equal((await missing.json()).error.code,'TW_QUOTE_NOT_FOUND');
});

test('K-line pack files come from the repository first, keep gzip bytes intact and fall back to the deployed copy',async t=>{
 const chunk=gzipSync(JSON.stringify({date:'2026-10-16',entries:[]})),deployed=gzipSync(JSON.stringify({date:'2026-10-05',entries:[]}));
 const manifest=JSON.stringify({date:'2026-10-16',chunks:[]});let githubDown=false;
 t.mock.method(globalThis,'fetch',async input=>{
  const url=String(input?.url??input);if(githubDown&&url.endsWith('daily-02.json.gz'))throw Error('offline');
  if(url===REPO+'data/tw-patterns/manifest.json')return new Response(manifest);
  if(url===REPO+'data/tw-patterns/daily-00.json.gz'||url===REPO+'data/tw-patterns/daily-01.json.gz')return new Response(chunk);
  if(url===REPO+'data/tw-patterns/daily-03.json.gz')return new Response('not gzip');
  return new Response('missing',{status:404});
 });
 const env={ASSETS:assets({'data/tw-patterns/daily-02.json.gz':deployed,'data/tw-patterns/daily-03.json.gz':deployed})};
 const gz=await worker.fetch(new Request('https://ox.test/data/tw-patterns/daily-00.json.gz?date=2026-10-16&revision=x'),env,{});
 assert.equal(gz.status,200);assert.equal(gz.headers.get('content-type'),'application/gzip');assert.equal(gz.headers.get('content-encoding'),null);
 assert.equal(gz.headers.get('cache-control'),'public, max-age=0, must-revalidate');assert.match(gz.headers.get('etag'),/^W\/"[0-9a-f]{32}"$/);
 const body=new Uint8Array(await gz.clone().arrayBuffer());assert.deepEqual([body[0],body[1]],[0x1f,0x8b]);
 assert.equal((await readJSONBody(gz)).date,'2026-10-16');
 const cached=await worker.fetch(new Request('https://ox.test/data/tw-patterns/daily-00.json.gz',{headers:{'If-None-Match':gz.headers.get('etag')}}),env,{});
 assert.equal(cached.status,304);
 const json=await worker.fetch(new Request('https://ox.test/data/tw-patterns/manifest.json'),env,{});
 assert.equal(json.headers.get('content-type'),'application/json');assert.equal((await json.json()).date,'2026-10-16');
 const based=await worker.fetch(new Request('https://ox.test/ox-tw-independent/data/tw-patterns/daily-01.json.gz'),env,{});
 assert.equal(based.headers.get('content-type'),'application/gzip');
 githubDown=true;
 const fallback=await worker.fetch(new Request('https://ox.test/data/tw-patterns/daily-02.json.gz'),env,{});
 assert.equal(fallback.headers.get('content-type'),'application/gzip');assert.equal((await readJSONBody(fallback)).date,'2026-10-05');
 const invalid=await worker.fetch(new Request('https://ox.test/data/tw-patterns/daily-03.json.gz'),env,{});
 assert.equal(invalid.headers.get('content-type'),null,'invalid repository bytes are not relabelled; the static response is served');
 assert.equal((await readJSONBody(invalid)).date,'2026-10-05');
});

test('page JSON readers decide gzip from the bytes, not from Content-Encoding',async()=>{
 const json={date:'2026-10-16',entries:[1]},gz=gzipSync(JSON.stringify(json));
 // CDN wrapped a second layer and the browser removed only that one.
 assert.deepEqual(await readJSONBody(new Response(gz,{headers:{'content-encoding':'gzip'}})),json);
 assert.deepEqual(await readJSONBody(new Response(gz)),json);
 assert.deepEqual(await readJSONBody(new Response(JSON.stringify(json),{headers:{'content-encoding':'gzip'}})),json);
 assert.deepEqual(await readJSONBody(new Response('﻿'+JSON.stringify(json))),json);
});
