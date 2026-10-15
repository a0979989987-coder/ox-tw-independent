import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';

// Fixed copy of a real official snapshot (tests/fixtures), not the daily data/.
const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const manifest=fixture.manifest,payload={date:fixture.date,algorithmVersion:fixture.algorithmVersion,entries:fixture.entries};
// Three real stocks in three chunks of one manifest.
const entries=payload.entries.slice(0,3);
const small={...manifest,total:3,classified:3,chunks:entries.map((e,i)=>({file:`daily-0${i}.json.gz`,count:1,symbols:[e.data.symbol]}))};
const body=index=>gzipSync(JSON.stringify({...payload,entries:[entries[index]]}));
// A response body delivered in `parts` blocks, `gap` ms apart (or stalled after the first block).
function streamed(bytes,{parts=8,gap=0,stallAfter=Infinity}={}){
 const size=Math.ceil(bytes.length/parts);let sent=0;
 return new Response(new ReadableStream({async pull(controller){
  if(sent>=stallAfter){await new Promise(()=>{});}
  if(gap)await new Promise(resolve=>setTimeout(resolve,gap));
  const block=bytes.subarray(sent*size,(sent+1)*size);sent++;
  if(block.length)controller.enqueue(block);if(sent>=parts||!block.length)controller.close();
 }}),{headers:{'content-type':'application/gzip'}});
}

test('the board fetches the manifest alone, then only the chunks holding the requested stocks',async t=>{
 const module=await import('../src/markets/tw/patterns/bundle.js?ensure-chunks');
 const calls=[];
 t.mock.method(globalThis,'fetch',async input=>{const path=new URL(input).pathname;calls.push(path.split('/').pop());if(path.endsWith('manifest.json'))return Response.json(small);return streamed(body(Number(path.match(/daily-(\d+)/)[1])));});
 const state=await module.ensureBundleManifest();
 assert.deepEqual(calls,['manifest.json']);assert.equal(state.stocks.length,manifest.stocks.length);assert.equal(state.chunks.total,3);
 const result=await module.ensureBundleChunks([entries[1].data.symbol]);
 assert.deepEqual(result,{files:['daily-01.json.gz'],failed:[],errors:[]});
 assert.deepEqual(calls,['manifest.json','daily-01.json.gz']);
 assert(module.bundleEntry(entries[1].data.symbol));assert.equal(module.bundleEntry(entries[0].data.symbol),null);
 assert.deepEqual(module.bundleChunks().map(chunk=>chunk.status),['idle','loaded','idle']);
 // Held in memory: asking again (another timeframe) downloads nothing.
 await module.ensureBundleChunks([entries[1].data.symbol]);await module.ensureBundleManifest();
 assert.equal(calls.length,2);
 // The whole-market preloader keeps its behaviour and reuses the loaded chunk.
 await module.preloadBundle({silent:true});
 assert.deepEqual(calls.slice(2).sort(),['daily-00.json.gz','daily-02.json.gz','manifest.json']);
 assert.equal(module.bundleState().classified,3);assert.equal(module.bundleState().loading,false);
});

test('a slow but advancing download is never cut off; a stalled one fails after the idle limit',async t=>{
 const module=await import('../src/markets/tw/patterns/bundle.js?progress-timeout');
 let stall=false;
 t.mock.method(globalThis,'fetch',async input=>{const path=new URL(input).pathname;if(path.endsWith('manifest.json'))return Response.json(small);return streamed(body(Number(path.match(/daily-(\d+)/)[1])),stall?{stallAfter:1}:{parts:8,gap:40});});
 // 8 blocks 40 ms apart (≈320 ms) with an idle limit of 120 ms: completes.
 const started=Date.now();
 const slow=await module.ensureBundleChunks([entries[0].data.symbol],{idleMs:120,totalMs:5000});
 assert.deepEqual(slow.failed,[]);assert(Date.now()-started>=280);
 assert(module.bundleEntry(entries[0].data.symbol));
 stall=true;
 const stalled=await module.ensureBundleChunks([entries[2].data.symbol],{idleMs:120,totalMs:5000});
 assert.deepEqual(stalled.failed,['daily-02.json.gz']);
 assert.equal(stalled.errors[0].name,'TimeoutError');
 assert.equal(module.bundleChunks()[2].status,'failed');assert.equal(module.bundleState().failed,1);
 // The total limit still bounds a download that trickles forever.
 stall=false;
 const capped=await module.ensureBundleChunks([entries[2].data.symbol],{idleMs:1000,totalMs:100});
 assert.deepEqual(capped.failed,['daily-02.json.gz']);
});

test('stage "downloaded" resolves before classification ends, so the next download can start',async t=>{
 const module=await import('../src/markets/tw/patterns/bundle.js?stages');
 t.mock.method(globalThis,'fetch',async input=>{const path=new URL(input).pathname;if(path.endsWith('manifest.json'))return Response.json(small);return streamed(body(Number(path.match(/daily-(\d+)/)[1])));});
 const symbol=entries[0].data.symbol;
 await module.ensureBundleChunks([symbol],{stage:'downloaded'});
 assert.equal(module.bundleChunks()[0].status,'classifying');
 assert.equal(module.bundleState().loading,true);
 await module.ensureBundleChunks([symbol]);
 assert.equal(module.bundleChunks()[0].status,'loaded');assert(module.bundleEntry(symbol));
});
