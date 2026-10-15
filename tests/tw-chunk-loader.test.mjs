import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createChunkLoader,priorityPlan,prioritizeChunks,firstStep} from '../src/markets/tw/patterns/chunk-loader.js';

// The real chunk map of a published snapshot (fixed copy in tests/fixtures).
const {manifest}=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function settle(n=8){for(let i=0;i<n;i++)await tick();}
// A fake bundle around the real manifest chunk map: each load is a promise the
// test resolves; classification finishes on the next tick.
function fakeBundle(){
 const status=new Map(manifest.chunks.map(chunk=>[chunk.file,'idle'])),listeners=new Set(),calls=[],pending=new Map();let inFlight=0,peak=0;
 const emit=()=>{for(const listener of listeners)listener();};
 const fileOf=symbols=>manifest.chunks.find(chunk=>chunk.symbols.includes(symbols[0])).file;
 return {status,calls,pending,get peak(){return peak;},get inFlight(){return inFlight;},
  deps:{manifest:async()=>{},revisionOf:()=>'2026-10-14:r1',subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
   chunks:()=>manifest.chunks.map(chunk=>({file:chunk.file,count:chunk.count,symbols:chunk.symbols,status:status.get(chunk.file)})),
   status:file=>status.get(file),
   load:(symbols,{stage})=>{
    assert.equal(stage,'downloaded');const file=fileOf(symbols);calls.push(file);status.set(file,'downloading');inFlight++;peak=Math.max(peak,inFlight);emit();
    return new Promise(resolve=>pending.set(file,ok=>{inFlight--;pending.delete(file);
     if(!ok){status.set(file,'failed');emit();resolve({failed:[file]});return;}
     status.set(file,'classifying');emit();resolve({failed:[]});
     setTimeout(()=>{status.set(file,'loaded');emit();},0);}));
   }},
  finish(file,ok=true){pending.get(file)(ok);},
  async drain(){while(pending.size){for(const file of [...pending.keys()])this.finish(file);await settle();}}
 };
}
const symbolOf=index=>manifest.chunks[index].symbols[0];

test('the chunk of the selected stock loads first and alone, then visible, watchlist and radar chunks, two at a time',async()=>{
 const bundle=fakeBundle();
 const loader=createChunkLoader({...bundle.deps,events:false,saveData:()=>false,hidden:()=>false});
 const plan=priorityPlan({selected:symbolOf(7),visible:[symbolOf(12)],watchlist:[symbolOf(15)],candidates:[{symbol:symbolOf(3),tier:1},{symbol:symbolOf(9),tier:3}]});
 await loader.start({priority:plan});await settle();
 assert.deepEqual(bundle.calls,['daily-07.json.gz'],'the first chunk downloads alone');
 assert.equal(loader.state().phase,'priority');
 assert.equal(loader.symbolState(symbolOf(7)),'pending');
 bundle.finish('daily-07.json.gz');await settle();
 assert.deepEqual(bundle.calls.slice(1),['daily-12.json.gz','daily-15.json.gz']);
 assert.equal(loader.symbolState(symbolOf(7)),'loaded');
 await bundle.drain();
 assert.equal(bundle.peak,2,'never more than two downloads at once');
 assert.deepEqual(bundle.calls.slice(3,5),['daily-03.json.gz','daily-09.json.gz'],'radar candidates (T1 before T3) before the rest');
 assert.deepEqual(bundle.calls.slice(5),manifest.chunks.map(chunk=>chunk.file).filter(file=>!bundle.calls.slice(0,5).includes(file)),'then manifest order');
 assert.equal(new Set(bundle.calls).size,manifest.chunks.length);
 assert.deepEqual({phase:loader.state().phase,loaded:loader.state().loaded,total:loader.state().total},{phase:'done',loaded:20,total:20});
 // A new scan (another timeframe) reuses every chunk held in memory.
 await loader.start({priority:priorityPlan({visible:[symbolOf(1)]})});await settle();
 assert.equal(bundle.calls.length,manifest.chunks.length);
});

test('a failed chunk is retried once after a backoff and then reported, never retried in a loop',async()=>{
 const bundle=fakeBundle(),sleeps=[];
 const loader=createChunkLoader({...bundle.deps,events:false,saveData:()=>false,hidden:()=>false,backoffMs:2000,random:()=>0.5,sleep:async ms=>{sleeps.push(ms);}});
 await loader.start({priority:priorityPlan({})});await settle();
 assert.deepEqual(bundle.calls,['daily-00.json.gz']);
 bundle.finish('daily-00.json.gz',false);await settle();
 assert.deepEqual(sleeps,[2000],'one backoff before the retry');
 assert.deepEqual(bundle.calls,['daily-00.json.gz','daily-00.json.gz']);
 bundle.finish('daily-00.json.gz');await settle();
 assert.equal(loader.symbolState(symbolOf(0)),'loaded');
 // daily-01 fails twice: reported as failed after its single retry.
 bundle.finish('daily-01.json.gz',false);await settle();bundle.finish('daily-01.json.gz',false);await settle();
 await bundle.drain();
 assert.equal(bundle.calls.filter(file=>file==='daily-01.json.gz').length,2);
 assert.equal(loader.symbolState(symbolOf(1)),'failed');
 assert.deepEqual([loader.state().phase,loader.state().failed,loader.state().loaded],['failed',1,19]);
 // The pill's retry downloads only the failed chunk again.
 const before=bundle.calls.length;loader.loadAll();await settle();
 assert.deepEqual(bundle.calls.slice(before),['daily-01.json.gz']);
 bundle.finish('daily-01.json.gz');await settle();
 assert.equal(loader.state().phase,'done');
});

test('Save-Data stops after the first step until the whole market is requested',async()=>{
 const bundle=fakeBundle();
 const loader=createChunkLoader({...bundle.deps,events:false,saveData:()=>true,hidden:()=>false});
 await loader.start({priority:priorityPlan({watchlist:[symbolOf(5)]})});await settle();
 await bundle.drain();await settle();
 assert.deepEqual(bundle.calls,['daily-05.json.gz','daily-00.json.gz']);
 assert.deepEqual([loader.state().phase,loader.state().loaded,loader.state().deferred],['deferred',2,18]);
 assert.equal(loader.symbolState(symbolOf(5)),'loaded');
 assert.equal(loader.symbolState(symbolOf(9)),'deferred');
 // Another scan does not silently continue the download.
 await loader.start({priority:priorityPlan({})});await settle();
 assert.equal(bundle.calls.length,2);
 loader.loadAll();await settle();await bundle.drain();await settle();
 assert.equal(bundle.calls.length,20);assert.equal(loader.state().phase,'done');
});

test('no new chunk starts while the page is hidden; loading resumes when it is visible again',async t=>{
 const original=globalThis.document;
 const document=Object.assign(new EventTarget(),{hidden:false});globalThis.document=document;
 t.after(()=>{globalThis.document=original;});
 const bundle=fakeBundle();
 const loader=createChunkLoader({...bundle.deps,saveData:()=>false});
 try{
  await loader.start({priority:priorityPlan({})});await settle();
  bundle.finish('daily-00.json.gz');await settle();
  assert.equal(bundle.calls.length,3);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(loader.state().paused,true);
  await bundle.drain();await settle();
  assert.equal(bundle.calls.length,3,'in-flight downloads finish, nothing new starts');
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await settle();
  assert.equal(bundle.calls.length,5);
  await bundle.drain();await settle();
  assert.equal(loader.state().phase,'done');
 }finally{loader.destroy();}
});

test('first step: pinned chunks (at most four), else the best radar chunks',()=>{
 const plan=priorityPlan({candidates:[{symbol:symbolOf(4),tier:1},{symbol:symbolOf(4),tier:2},{symbol:symbolOf(6),tier:2}]});
 const ordered=prioritizeChunks(manifest.chunks,plan.weights);
 assert.deepEqual(ordered.slice(0,3).map(item=>item.chunk.file),['daily-04.json.gz','daily-06.json.gz','daily-00.json.gz']);
 assert.deepEqual([...firstStep(ordered,plan.pinned)],['daily-04.json.gz','daily-06.json.gz']);
 const many=priorityPlan({watchlist:[1,3,5,7,9,11].map(symbolOf)});
 assert.equal(firstStep(prioritizeChunks(manifest.chunks,many.weights),many.pinned).size,4);
});
