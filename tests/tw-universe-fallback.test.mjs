import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {getOfficialTWThemes} from '../api/v1/tw/providers/themes.js';
import {getOfficialTWIndicators} from '../api/v1/tw/providers/indicators.js';

// Nothing in this file may reach a real host, including work that outlives a test.
globalThis.fetch=async input=>{throw Error('network disabled in tests: '+String(input?.url??input));};

const REPO='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
const UNIVERSE=/MI_INDEX\?[^#]*type=ALLBUT0999|otc_quotes_no1430|STOCK_DAY_ALL|tpex_mainboard_quotes|tpex_mainboard_daily_close_quotes|t187ap05_[LO]/;
const row=(symbol,market,industry,changePct)=>({symbol,name:symbol,market,industry,theme:industry,price:100,change:null,changePct,volume:1000,turnoverTwd:100000,dataDate:'2026-10-16',oxScore:null,tier:''});
const snapshot=({partial=false,tpexIndustry='半導體業'}={})=>JSON.stringify({savedAt:Date.now()-1000,data:{dataDate:'2026-10-16',updatedAt:'2026-10-16T10:04:51.633Z',
 meta:{partial,sources:{TWSE:'ready',TPEX:partial?'error':'ready'}},
 radar:[row('2330','TWSE','半導體業',1),row('2303','TWSE','半導體業',-1),row('8299','TPEX',tpexIndustry,6),row('6488','TPEX',tpexIndustry,2)]}});

// TWSE answers, every TPEx host fails: the live list can only hold one market.
let published=null;
function tpexDown(requested){
 return async input=>{
  const url=new URL(String(input?.url??input));requested.push(url.href);
  if(url.href===REPO+'data/tw-radar.json')return published?new Response(published):new Response('missing',{status:404});
  if(url.hostname.endsWith('tpex.org.tw'))return new Response('unavailable',{status:503});
  if(url.pathname.endsWith('/STOCK_DAY_ALL'))return Response.json([
   {Date:'1151015',Code:'2330',Name:'台積電',TradeVolume:'1000',TradeValue:'2440000',OpeningPrice:'2430',HighestPrice:'2450',LowestPrice:'2420',ClosingPrice:'2440',Change:'10',Transaction:'10'},
   {Date:'1151015',Code:'2303',Name:'聯電',TradeVolume:'1000',TradeValue:'50000',OpeningPrice:'50',HighestPrice:'51',LowestPrice:'49',ClosingPrice:'50',Change:'-0.5',Transaction:'10'}]);
  if(url.pathname.endsWith('/t187ap05_L'))return Response.json([{公司代號:'2330',公司名稱:'台積電',產業別:'半導體業'},{公司代號:'2303',公司名稱:'聯電',產業別:'半導體業'}]);
  if(url.pathname.endsWith('/MI_INDEX'))return Response.json({stat:'很抱歉，沒有符合條件的資料!'});
  return new Response('missing',{status:404});
 };
}
const incomplete=code=>error=>{assert.equal(error.code,code);assert.deepEqual(error.details.sources,{TWSE:'ready',TPEX:'error'});return true;};

test('without a published list, a one-market live list is reported, not ranked or totalled',async t=>{
 const requested=[];t.mock.method(globalThis,'fetch',tpexDown(requested));
 // No snapshot reader outside the Worker: the live rebuild is the only path.
 assert.equal(globalThis.__twReadAsset,undefined);
 await assert.rejects(getOfficialTWThemes(),incomplete('TW_THEME_UNIVERSE_INCOMPLETE'));
 await assert.rejects(getOfficialTWIndicators(),incomplete('TW_INDICATORS_UNIVERSE_INCOMPLETE'));
 assert(requested.some(url=>url.includes('tpex.org.tw')),'TPEx was attempted');
});

test('a published list without TPEx industries cannot rank themes but still feeds indicators',async t=>{
 const requested=[];t.mock.method(globalThis,'fetch',tpexDown(requested));
 const bytes=snapshot({tpexIndustry:''});
 globalThis.__twReadAsset=async path=>{assert.equal(path,'data/tw-radar.json');return new TextEncoder().encode(bytes);};
 t.after(()=>{delete globalThis.__twReadAsset;});
 await assert.rejects(getOfficialTWThemes(),incomplete('TW_THEME_UNIVERSE_INCOMPLETE'));
 assert(requested.some(url=>url.endsWith('/STOCK_DAY_ALL')),'themes fell back to the live list');
 requested.length=0;
 const indicators=await getOfficialTWIndicators();
 assert.equal(indicators.meta.universeSource,'independent-verified-snapshot');
 assert.equal(indicators.indicators.rapidRise.value,1);
 assert.deepEqual(requested.filter(url=>UNIVERSE.test(url)),[]);
});

test('in the Worker, a partial published list falls back live and a one-market result is 503',async t=>{
 const requested=[];t.mock.method(globalThis,'fetch',tpexDown(requested));
 published=snapshot({partial:true});
 const env={ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
 for(const [path,code]of [['themes','TW_THEME_UNIVERSE_INCOMPLETE'],['indicators','TW_INDICATORS_UNIVERSE_INCOMPLETE']]){
  const response=await worker.fetch(new Request('https://ox.test/api/v1/tw/'+path),env,{});
  const body=await response.json();
  assert.equal(response.status,503,path);assert.equal(body.ok,false);assert.equal(body.error.code,code);
  assert.match(body.error.message,/來源不完整/);assert.deepEqual(body.error.details.sources,{TWSE:'ready',TPEX:'error'});
 }
 assert(requested.includes(REPO+'data/tw-radar.json'),'the published list was consulted first');
 assert(requested.some(url=>url.includes('tpex.org.tw')),'the live list was attempted');
});
