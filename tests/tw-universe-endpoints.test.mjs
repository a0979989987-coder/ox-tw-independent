import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

// Nothing in this file may reach a real host, including work that outlives a test.
globalThis.fetch=async input=>{throw Error('network disabled in tests: '+String(input?.url??input));};

const REPO='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
// The six radar list sources and the four themes sources.
const UNIVERSE=/MI_INDEX\?[^#]*type=ALLBUT0999|otc_quotes_no1430|STOCK_DAY_ALL|tpex_mainboard_quotes|tpex_mainboard_daily_close_quotes|t187ap05_[LO]/;
const row=(symbol,name,market,industry,price,changePct,volume,turnoverTwd)=>({symbol,name,market,industry,theme:industry,price,change:null,changePct,volume,turnoverTwd,
 dataDate:'2026-10-16',classic:null,eligible:false,oxScore:null,tier:'',setup:'結構／量能待確認',updatedAt:'2026-10-16'});
const rows=[
 row('2330','台積電','TWSE','半導體業',2420,0.83,20000000,48400000000),
 row('2303','聯電','TWSE','半導體業',50,-1,60000000,3000000000),
 row('8299','群聯','TPEX','半導體業',1890,6,2000000,3780000000),
 row('2308','台達電','TWSE','電子零組件業',900,1,7000000,6300000000),
 row('6210','慶生','TPEX','電子零組件業',18.75,2,5000000,93750000),
 row('1101','台泥','TWSE','水泥工業',27.3,-0.5,57000000,1556100000),
 row('3105','穩懋','TPEX','',100,9,1000,100000)
];
const snapshot=JSON.stringify({savedAt:Date.now()-1000,data:{dataDate:'2026-10-16',updatedAt:'2026-10-16T10:04:51.633Z',
 meta:{partial:false,total:rows.length,sources:{TWSE:'ready',TPEX:'ready'}},radar:rows}});
// Official month pages for the indicator's symbol mode: one bar on the 15th.
function officialMonth(url){
 if(url.pathname.endsWith('/tradingStock')){const [y,m]=url.searchParams.get('date').split('/');
  return {stat:'ok',tables:[{data:[[`${y-1911}/${m}/15`,'1','2','100.00','110.00','95.00','105.00','5.00','10']]}]};}
 return null;
}
const env={ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
const get=async path=>{const response=await worker.fetch(new Request('https://ox.test/api/v1/tw/'+path),env,{});return [response.status,await response.json()];};

test('themes and indicators read the published list: zero market-list requests, no K-line pack',async t=>{
 let requested=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input?.url??input));requested.push(url.href);
  if(url.href===REPO+'data/tw-radar.json')return new Response(snapshot);
  const month=officialMonth(url);if(month)return Response.json(month);
  // Breadth, market pulse and money flow are separate official feeds; unavailable here.
  return new Response('unavailable',{status:503});
 });

 const [themesStatus,themes]=await get('themes');
 assert.equal(themesStatus,200);assert.equal(themes.ok,true);
 assert.equal(themes.data.dataDate,'2026-10-16');assert.equal(themes.data.meta.partial,false);
 assert.equal(themes.data.meta.universeSource,'independent-verified-snapshot');
 assert.deepEqual(themes.data.meta.rows,{TWSE:4,TPEX:2},'rows without an industry are left out');
 assert.deepEqual(themes.data.themes.map(theme=>[theme.name,theme.stockCount,theme.advanceCount,theme.declineCount,theme.leaderSymbol]),
  [['半導體業',3,2,1,'8299'],['電子零組件業',2,2,0,'6210']],'both exchanges count; single-stock industries are dropped');
 assert.ok(Math.abs(themes.data.themes[0].changePct-(0.83-1+6)/3)<1e-9);
 assert.deepEqual(requested,[REPO+'data/tw-radar.json'],'themes made no official request at all');

 requested=[];
 const [indicatorsStatus,indicators]=await get('indicators');
 assert.equal(indicatorsStatus,200);assert.equal(indicators.data.meta.universeSource,'independent-verified-snapshot');
 assert.equal(indicators.data.meta.sources.radar,'fulfilled');
 const reading=indicators.data.indicators;
 assert.equal(reading.marketTurnover.value,rows.reduce((sum,row)=>sum+row.turnoverTwd,0));
 assert.equal(reading.turnoverRank.display,'#1 2330 台積電');assert.equal(reading.volumeRank.display,'#1 2303 聯電');
 assert.match(reading.themeStrength.display,/^半導體業 /);assert.equal(reading.leaderStatus.display,'8299 群聯');
 assert.equal(reading.rapidRise.value,2,'TPEx rows are part of the market totals');

 const [symbolStatus,symbol]=await get('indicators?symbol=8299');
 assert.equal(symbolStatus,200);assert.equal(symbol.data.indicators.changePct.value,6);
 assert.equal(symbol.data.meta.sources.candles,'fulfilled');

 assert.deepEqual(requested.filter(url=>UNIVERSE.test(url)),[],'no market-list source was requested');
 assert.deepEqual(requested.filter(url=>url.includes('tw-patterns')),[],'the classic evaluation did not load the K-line pack');
 assert.equal(requested.filter(url=>url===REPO+'data/tw-radar.json').length,0,'the published bytes are memoized across endpoints');
});

test('search reads the published list: both exchanges, zero market-list requests, no K-line pack',async t=>{
 const requested=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input?.url??input));requested.push(url.href);
  if(url.href===REPO+'data/tw-radar.json')return new Response(snapshot);
  return new Response('unavailable',{status:503});
 });
 const symbols=async path=>{const [status,body]=await get(path);assert.equal(status,200,path);assert.equal(body.ok,true,path);return body.data.map(found=>found.symbol+' '+found.market);};

 assert.deepEqual(await symbols('search?q=半導體'),['2303 TWSE','2330 TWSE','8299 TPEX'],'an industry search spans both exchanges');
 assert.deepEqual(await symbols('search?q=半導體&market=TPEX'),['8299 TPEX']);
 assert.deepEqual(await symbols('search?q=慶生'),['6210 TPEX']);
 assert.deepEqual(await symbols('search?q=3105'),['3105 TPEX'],'a stock without an industry is still found');
 const [,exact]=await get('search?q=8299');
 assert.deepEqual([exact.data[0].name,exact.data[0].price,exact.data[0].changePct,exact.data[0].updatedAt],['群聯',1890,6,'2026-10-16']);

 assert.deepEqual(requested.filter(url=>url!==REPO+'data/tw-radar.json'),[],'search made no official request and did not load the K-line pack');
});
