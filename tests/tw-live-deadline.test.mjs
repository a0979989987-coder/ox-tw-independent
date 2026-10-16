import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {twProvider} from '../src/markets/tw/api.js?v=20261005-recovery20';

const REPO='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const snapshot=JSON.stringify({savedAt:Date.now()-1000,data:{dataDate:'2026-10-16',meta:{partial:false,sources:{TWSE:'ready',TPEX:'ready'}},
 radar:[{symbol:'2330',market:'TWSE',price:2420},{symbol:'8299',market:'TPEX',price:1890}]}});

// Official hosts that accept the connection and never answer (abort ignored),
// the way the platform saw them: the API must still answer before 20 s ends.
test('a hung official feed is reported as JSON 504 naming that feed at the 20 s deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let snapshotPublished=false;
 t.mock.method(globalThis,'fetch',input=>{
  const url=String(input?.url??input);
  if(url===REPO+'data/tw-radar.json')return Promise.resolve(snapshotPublished?new Response(snapshot):new Response('missing',{status:404}));
  return new Promise(()=>{});
 });
 const env={ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
 const cases=[
  [false,'quote?symbol=2330',/official-tw universe/],
  [true,'candles?symbol=8299&from=2026-09-01&to=2026-10-16',/^TPEX-ST43$/],
  [true,'candles?symbol=2330&from=2026-09-01&to=2026-10-16',/^TWSE-STOCK-DAY$/]
 ];
 for(const [published,path,source]of cases){
  snapshotPublished=published;let settled=null;
  const pending=worker.fetch(new Request('https://ox.test/api/v1/tw/'+path),env,{}).then(response=>settled=response);
  await flush();t.mock.timers.tick(19999);await flush();
  assert.equal(settled,null,path+' must not answer before the deadline');
  t.mock.timers.tick(1);await flush();await pending;
  const body=await settled.json();
  assert.equal(settled.status,504,path);assert.equal(body.ok,false);assert.equal(body.error.code,'TW_UPSTREAM_TIMEOUT');
  assert.match(body.error.details.source,source);assert.equal(body.error.details.timeoutMs,20000);
  assert(body.error.message.includes(body.error.details.source));
 }
});

test('the browser waits past the server deadline for quote and candles, other endpoints keep 12 s',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 twProvider.configure({apiBase:'https://tw.test/api'});
 const signals={};
 t.mock.method(globalThis,'fetch',(input,init)=>{signals[new URL(String(input)).pathname.split('/').pop()]=init.signal;return new Promise(()=>{});});
 for(const call of [()=>twProvider.getQuote('8299'),()=>twProvider.getCandles('8299',{range:'3M',timeoutMs:15000}),()=>twProvider.getMarketPulse()])call().catch(()=>{});
 await flush();
 assert.deepEqual(Object.keys(signals).sort(),['candles','market-pulse','quote']);
 t.mock.timers.tick(12000);await flush();
 assert.equal(signals['market-pulse'].aborted,true);assert.equal(signals.quote.aborted,false);assert.equal(signals.candles.aborted,false);
 t.mock.timers.tick(12999);await flush();
 assert.equal(signals.quote.aborted,false,'still waiting after the 20 s server deadline');
 t.mock.timers.tick(1);await flush();
 assert.equal(signals.quote.aborted,true);assert.equal(signals.candles.aborted,true);
});
