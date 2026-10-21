import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {getOfficialTWQuote} from '../api/v1/tw/providers/quotes.js';
import {withRequestDeadline} from '../api/v1/tw/[endpoint].js';

// TWSE answers, every TPEx host fails: the live list can only hold one market.
function tpexDown(requested){
 return async input=>{
  const url=new URL(String(input?.url??input));requested.push(url.href);
  if(url.hostname.endsWith('tpex.org.tw'))return new Response('unavailable',{status:503});
  if(url.pathname.endsWith('/STOCK_DAY_ALL'))return Response.json([{Date:'1151015',Code:'2330',Name:'台積電',TradeVolume:'1000',TradeValue:'2440000',OpeningPrice:'2430',HighestPrice:'2450',LowestPrice:'2420',ClosingPrice:'2440',Change:'10',Transaction:'10'}]);
  if(url.pathname.endsWith('/t187ap05_L'))return Response.json([]);
  if(url.pathname.endsWith('/MI_INDEX'))return Response.json({stat:'很抱歉，沒有符合條件的資料!'});
  return new Response('missing',{status:404});
 };
}

test('a one-market live list answers 503 source-incomplete, never 404 for the missing market',async t=>{
 const requested=[];t.mock.method(globalThis,'fetch',tpexDown(requested));
 // No snapshot reader outside the Worker: the live rebuild is the only path.
 await assert.rejects(getOfficialTWQuote('8299'),error=>{
  assert.equal(error.code,'TW_QUOTE_UNIVERSE_INCOMPLETE');assert.deepEqual(error.details.sources,{TWSE:'ready',TPEX:'error'});return true;
 });
 assert(requested.some(url=>url.includes('tpex.org.tw')),'TPEx was attempted');
 // In the Worker, a missing repository snapshot falls back to the same live list.
 const env={ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
 for(const path of ['quote?symbol=8299','quote?symbol=2330','candles?symbol=6210&range=3M']){
  const response=await worker.fetch(new Request('https://ox.test/api/v1/tw/'+path),env,{});
  const body=await response.json();
  assert.equal(response.status,503,path);assert.equal(body.error.code,'TW_QUOTE_UNIVERSE_INCOMPLETE');
  assert.match(body.error.message,/來源不完整/);assert.deepEqual(body.error.details.sources,{TWSE:'ready',TPEX:'error'});
 }
});

test('the request deadline names the pending source and leaves fast work untouched',async()=>{
 assert.equal(await withRequestDeadline(async progress=>{progress.source='GitHub data/tw-radar.json';return 'done';},50),'done');
 await assert.rejects(withRequestDeadline(progress=>{progress.source='TPEX-ST43';return new Promise(()=>{});},30),error=>{
  assert.equal(error.code,'TW_UPSTREAM_TIMEOUT');assert.equal(error.source,'TPEX-ST43');assert.equal(error.timeoutMs,30);return true;
 });
 await assert.rejects(withRequestDeadline(()=>Promise.reject(Object.assign(Error('x'),{code:'TW_CANDLES_NOT_FOUND'})),50),{code:'TW_CANDLES_NOT_FOUND'});
});
