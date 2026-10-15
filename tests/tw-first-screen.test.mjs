import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fetchWithProgress} from '../src/components/progress-fetch.js';
import {radarSnapshotURL} from '../src/markets/tw/radar-snapshot.js';
import {radarAvailability} from '../src/markets/tw/recovery.js';
import {seedTWRadar,createTWMarketState,refreshTWMarketState} from '../src/markets/tw/engine.js';
import {twProvider} from '../src/markets/tw/api.js?v=20261005-recovery20';
twProvider.configure({apiBase:'https://taiwan.test/api'});
const published=JSON.parse(readFileSync(new URL('../data/tw-radar.json',import.meta.url),'utf8'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function trickle(chunks,gap){
  const encoder=new TextEncoder();
  return new ReadableStream({async pull(controller){if(!chunks.length){controller.close();return;}await wait(gap);controller.enqueue(encoder.encode(chunks.shift()));}});
}

test('a slow download that keeps advancing outlives the idle timeout; a stalled one is cancelled',async()=>{
  const body=JSON.stringify({ok:true,rows:Array.from({length:12},(_,i)=>i)});
  const pieces=body.match(/.{1,4}/g);
  const started=Date.now();
  const {text}=await fetchWithProgress('x',{idleMs:60,totalMs:5000,fetcher:async()=>new Response(trickle([...pieces],25))});
  assert.deepEqual(JSON.parse(text),JSON.parse(body));
  assert(Date.now()-started>60*2,'total time exceeded several idle windows');
  await assert.rejects(fetchWithProgress('x',{idleMs:50,totalMs:5000,fetcher:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}))}),{name:'TimeoutError'});
  await assert.rejects(fetchWithProgress('x',{idleMs:1000,totalMs:80,fetcher:async()=>new Response(trickle(Array(50).fill('a'),20))}),{name:'TimeoutError'});
});

test('the runtime fetches exactly the URL the HTML preloads',()=>{
  const doc={querySelector:s=>s.includes('data-tw-radar')?{href:'https://x.test/ox-tw-independent/data/tw-radar.json?v=abc'}:null};
  assert.equal(radarSnapshotURL(doc),'https://x.test/ox-tw-independent/data/tw-radar.json?v=abc');
  assert.match(radarSnapshotURL({querySelector:()=>null}),/\/data\/tw-radar\.json$/);
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<link rel="preload" as="fetch" crossorigin href="data\/tw-radar\.json" data-tw-radar>/);
});

test('while either source may still answer the radar shows loading, never an error',()=>{
  assert.equal(radarAvailability({status:'idle',data:null},'risk',0,{snapshot:'idle'}).unavailable,false);
  const pending=radarAvailability({status:'error',data:null},'risk',0,{snapshot:'pending'});
  assert(pending.loading&&!pending.unavailable);
  const both=radarAvailability({status:'error',data:null},'risk',0,{snapshot:'failed'});
  assert(both.unavailable&&both.retry&&!both.loading);
  const classic=radarAvailability({status:'error',data:null},'classic',0,{snapshot:'pending'});
  assert(classic.loading);
});

test('a complete published snapshot replaces a same-day live list that lacks official modes',async t=>{
  const incomplete={...published.data,modes:{risk:[]},modesMeta:{...published.data.modesMeta,disposal:{status:'error'}}};
  t.mock.method(globalThis,'fetch',async input=>new Response(JSON.stringify({ok:true,data:new URL(input).pathname.endsWith('/radar')?incomplete:{}})));
  await refreshTWMarketState({force:true});
  assert.equal(createTWMarketState().data.radarModes.risk.length,0);
  seedTWRadar({...published,savedAt:Date.now()-60000});
  assert.equal(createTWMarketState().data.radarModes.risk.length,published.data.modes.risk.length);
});
