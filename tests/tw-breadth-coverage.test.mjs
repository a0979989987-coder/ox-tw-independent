import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {normalizeTWBreadth} from '../src/markets/tw/engine.js';

// Nothing in this file may reach a real host, including work that outlives a test.
globalThis.fetch=async input=>{throw Error('network disabled in tests: '+String(input?.url??input));};

const REPO='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
const BREADTH_TABLE={stat:'OK',tables:[{title:'漲跌證券數合計',fields:['類型','整體市場','股票'],
 data:[['上漲(漲停)','5,000(100)','600(20)'],['下跌(跌停)','4,000(10)','300(2)'],['持平','100','50'],['未成交','10','5'],['無比價','1','1']]}]};
const row=(symbol,market)=>({symbol,name:symbol,market,industry:'半導體業',price:100,changePct:1,volume:1,turnoverTwd:1,dataDate:'2026-01-02'});
const snapshot=JSON.stringify({savedAt:Date.parse('2026-01-02T07:00:00Z'),data:{dataDate:'2026-01-02',meta:{partial:false,sources:{TWSE:'ready',TPEX:'ready'}},
 radar:[row('2330','TWSE'),row('8299','TPEX')]}});

test('one-market breadth is labelled as that market, in the API and on the indicator text',async t=>{
 // Friday 2026-01-02 16:00 in Taipei: TWSE answers, every TPEx host fails.
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-01-02T08:00:00Z')});
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input?.url??input));
  if(url.href===REPO+'data/tw-radar.json')return new Response(snapshot);
  if(url.pathname.endsWith('/MI_INDEX')&&url.searchParams.get('type')==='MS')return Response.json(BREADTH_TABLE);
  return new Response('unavailable',{status:503});
 });
 const env={ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
 const breadth=await (await worker.fetch(new Request('https://ox.test/api/v1/tw/breadth'),env,{})).json();
 assert.equal(breadth.ok,true);
 assert.equal(breadth.data.breadth.coverage,'TWSE');assert.equal(breadth.data.breadth.complete,false);
 assert.equal(breadth.data.breadth.coverageLabel,'只含上市');assert.equal(breadth.data.meta.partial,true);
 assert.equal(breadth.data.breadth.advancers,600,'the counts are the listed market only');
 const indicators=JSON.stringify(await (await worker.fetch(new Request('https://ox.test/api/v1/tw/indicators'),env,{})).json());
 assert(indicators.includes('只含上市 · 600 漲 / 300 跌'),'the breadth reading names its single market');
 assert(indicators.includes('不是全市場'));assert(!indicators.includes('上市＋上櫃股票廣度'));
 const shown=normalizeTWBreadth(breadth.data);
 assert.deepEqual([shown.coverage,shown.complete,shown.coverageLabel],['TWSE',false,'只含上市']);
});

test('older payloads without coverage still read as the whole market',()=>{
 const shown=normalizeTWBreadth({breadth:{advancers:1,decliners:2}});
 assert.deepEqual([shown.coverage,shown.complete,shown.coverageLabel],['ALL',true,'全市場']);
});
