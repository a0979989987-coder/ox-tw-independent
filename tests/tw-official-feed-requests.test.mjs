import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {getOfficialTWBreadth} from '../api/v1/tw/providers/breadth.js';
import {shareRecentResult} from '../api/v1/tw/providers/shared-result.js';

// Nothing in this file may reach a real host, including work that outlives a test.
globalThis.fetch=async input=>{throw Error('network disabled in tests: '+String(input?.url??input));};

const REPO='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
const NO_DATA={stat:'很抱歉，沒有符合條件的資料!'};
// MI_INDEX type=MS for a trading day: the "漲跌證券數合計" table.
const BREADTH_TABLE={stat:'OK',tables:[{title:'漲跌證券數合計',fields:['類型','整體市場','股票'],
 data:[['上漲(漲停)','5,000(100)','600(20)'],['下跌(跌停)','4,000(10)','300(2)'],['持平','100','50'],['未成交','10','5'],['無比價','1','1']]}]};
const OPENAPI_SUMMARY=[{類型:'股票',上漲:'610',下跌:'290',持平:'50',未成交:'5',無比價:'1',漲停:'21',跌停:'2',出表日期:'1150102'}];
const miIndexDates=requested=>requested.filter(url=>url.pathname.endsWith('/MI_INDEX')).map(url=>url.searchParams.get('date'));
const feed=url=>url.hostname+' '+url.pathname.split('/').pop()+(url.searchParams.get('type')?' type='+url.searchParams.get('type'):'');

test('a home-page burst shares one request per official feed with indicators',async t=>{
 const row=(symbol,market)=>({symbol,name:symbol,market,industry:'半導體業',price:100,changePct:1,volume:1,turnoverTwd:1,dataDate:'2026-10-16'});
 const snapshot=JSON.stringify({savedAt:Date.now()-1000,data:{dataDate:'2026-10-16',meta:{partial:false,sources:{TWSE:'ready',TPEX:'ready'}},
  radar:[row('2330','TWSE'),row('2303','TWSE'),row('8299','TPEX'),row('6488','TPEX')]}});
 const requested=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input?.url??input));
  if(url.href===REPO+'data/tw-radar.json')return new Response(snapshot);
  requested.push(url);
  // Slow, failing official hosts: every endpoint is still waiting when the next one asks.
  await new Promise(resolve=>setTimeout(resolve,20));
  return new Response('unavailable',{status:503});
 });
 const env={ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
 const responses=await Promise.all(['market-pulse','breadth','money-flow','indicators'].map(path=>worker.fetch(new Request('https://ox.test/api/v1/tw/'+path),env,{})));
 assert.deepEqual(responses.map(response=>response.status),[502,502,502,200]);
 const counts={};for(const url of requested)counts[feed(url)]=(counts[feed(url)]||0)+1;
 // Before: indicators repeated all three feeds, and breadth walked 11 dates on each failure.
 assert.deepEqual(counts,{
  'www.twse.com.tw MI_5MINS_HIST':1,'www.tpex.org.tw tpex_daily_trading_index':1,'www.tpex.org.tw tpex_mainborad_highlight':2,
  'www.twse.com.tw MI_INDEX type=MS':1,'openapi.twse.com.tw twtazu_od':1,
  'www.twse.com.tw BFI82U type=day':1,'www.tpex.org.tw tpex_3insti_summary':1});
});

test('breadth steps back a day only when TWSE answers that the date has no data',async t=>{
 // Monday 2026-01-05 16:00 in Taipei; the latest close is Friday 01-02.
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-01-05T08:00:00Z')});
 const requested=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input?.url??input));requested.push(url);
  if(url.pathname.endsWith('/MI_INDEX'))return Response.json(url.searchParams.get('date')==='20260102'?BREADTH_TABLE:NO_DATA);
  return new Response('unavailable',{status:503});
 });
 const result=await getOfficialTWBreadth();
 assert.deepEqual(miIndexDates(requested),['20260105','20260104','20260103','20260102']);
 assert.equal(result.markets.TWSE.dataDate,'2026-01-02');assert.equal(result.markets.TWSE.advancers,600);assert.equal(result.markets.TWSE.limitUp,20);
 assert.equal(requested.filter(url=>url.pathname.endsWith('/twtazu_od')).length,0);
});

test('a failing or unreadable MI_INDEX is asked once, then the OpenAPI summary answers',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-01-06T08:00:00Z')});
 let miIndex=()=>new Response('unavailable',{status:503});
 const requested=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input?.url??input));requested.push(url);
  if(url.pathname.endsWith('/MI_INDEX'))return miIndex();
  if(url.pathname.endsWith('/twtazu_od'))return Response.json(OPENAPI_SUMMARY);
  return new Response('unavailable',{status:503});
 });
 const failed=await getOfficialTWBreadth();
 assert.deepEqual(miIndexDates(requested),['20260106']);assert.equal(failed.markets.TWSE.source,'TWSE-OPENAPI');
 // Past the shared minute, a trading-day answer whose table cannot be read.
 t.mock.timers.tick(60001);requested.length=0;miIndex=()=>Response.json({stat:'OK',tables:[]});
 const unreadable=await getOfficialTWBreadth();
 assert.deepEqual(miIndexDates(requested),['20260106']);assert.equal(unreadable.markets.TWSE.advancers,610);
 assert.equal(requested.filter(url=>url.pathname.endsWith('/twtazu_od')).length,1);
});

test('shared results: one load in flight, success kept for a minute, failures never kept',async t=>{
 t.mock.timers.enable({apis:['Date'],now:0});
 let loads=0,failing=false;
 const shared=shareRecentResult(async()=>{loads++;await Promise.resolve();if(failing)throw Error('down');return {load:loads};});
 const [a,b]=await Promise.all([shared(),shared()]);
 assert.equal(loads,1);assert.equal(a,b);
 t.mock.timers.tick(59999);assert.equal(await shared(),a);assert.equal(loads,1);
 t.mock.timers.tick(1);failing=true;
 const failures=await Promise.allSettled([shared(),shared()]);
 assert.deepEqual(failures.map(result=>result.status),['rejected','rejected']);assert.equal(loads,2,'callers share the failing request');
 failing=false;const c=await shared();
 assert.equal(loads,3,'the failure was not kept');assert.deepEqual(c,{load:3});
});
