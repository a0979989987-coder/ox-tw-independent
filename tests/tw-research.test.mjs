import test from 'node:test';
import assert from 'node:assert/strict';
import { numeric, normalizeInstitutional, joinResearchStocks, aggregateSectors, enrichResearch } from '../server/markets/tw/research.js';
import { normalizeHistoricalQuotes } from '../server/markets/tw/research-history.js';
import { quadrant, selectSectors } from '../src/markets/tw/research-data.js';
import { bubbleChart, bubblePoints, flowScale } from '../src/markets/tw/research-bubbles.js';
test('missing values are not zero; shares remain shares until joined to same-day close',()=>{
  assert.equal(numeric('--'),null);assert.equal(numeric(null),null);assert.equal(numeric('0'),0);
  const rows=normalizeInstitutional({fields:['證券代號','外陸資買賣超股數(不含外資自營商)','投信買賣超股數','自營商買賣超股數','三大法人買賣超股數'],data:[['2330','1,000','-200','0','800']]},'TWSE','2026-09-24');
  assert.equal(rows[0].netShares,800);
  const stocks=joinResearchStocks([{symbol:'2330',dataDate:'2026-09-24',price:100,industry:'半導體',market:'TWSE'},{symbol:'9999',dataDate:'2026-09-24',price:50,industry:'半導體',market:'TWSE'},{symbol:'2330',dataDate:'2026-09-23',price:90,market:'TWSE'}],[rows],'2026-09-24');
  assert.equal(stocks.length,2);assert.equal(stocks[0].netTwd,80000);assert.equal(stocks[1].netTwd,null);
  const sector=aggregateSectors(stocks)[0];assert.equal(sector.covered,1);assert.equal(sector.count,2);
});
test('20-day momentum requires full coverage; dates deduplicated and future excluded',()=>{
 const sectors=[{name:'半導體',count:2,covered:2,flow:100}];
 const history=Array.from({length:20},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,sectors}));
 const snapshot={date:'2026-09-20',stocks:[{industry:'半導體',netTwd:50},{industry:'半導體',netTwd:50}]};
 const data=enrichResearch(snapshot,[...history,history[0],{date:'2026-10-01',sectors}]);
 assert.equal(data.history.length,20);assert.equal(data.sectors[0].flow5,500);assert.equal(data.sectors[0].momentum,0);
 assert.equal(enrichResearch(snapshot,history.slice(10)).sectors[0].momentum,null);
 history[3]={...history[3],sectors:[{...sectors[0],covered:1}]};assert.equal(enrichResearch(snapshot,history).sectors[0].momentum,null);
});
test('all quadrants and chart no-data states are distinct',()=>{
 assert.deepEqual([[1,1],[1,-1],[-1,1],[-1,-1]].map(([x,y])=>quadrant(x,y)),[0,1,2,3]);
 assert.match(bubbleChart([],'momentum'),/20 個交易日/);
 const chart=bubbleChart([{name:'<script>',flow:1,changePct:2,turnoverTwd:100}]);
 assert.doesNotMatch(chart,/<script>/);assert.match(chart,/&lt;script&gt;/);
});
test('compressed scales are reversible and every rendered bubble retains its name',()=>{
 const scale=flowScale([-385e8,-14e8,-4e8,1e8,4e8,15e8]);
 assert.ok(scale.position(-14e8)<-.3);
 assert.ok(scale.position(-385e8)<scale.position(-14e8));
 assert.equal(scale.position(0),0);
 assert.equal(scale.position(15e8)>0,true);
 const sectors=Array.from({length:32},(_,i)=>({name:`產業${i}`,flow:(i-16)*1e8,changePct:(i-16)*.05,turnoverTwd:1e9}));
 sectors.push({name:'半導體',flow:-385e8,changePct:.1,turnoverTwd:1e11});
 const chart=bubbleChart(sectors);
 assert.equal((chart.match(/class="twx-bubble /g)||[]).length,33);
 assert.equal((chart.match(/class="twx-bubble-label"/g)||[]).length,33);
 const top=bubbleChart(sectors,'day','',{density:'top'});
 assert.equal((top.match(/class="twx-bubble-label"/g)||[]).length,10);
 for(const value of [-385e8,-1e8,0,1e8,385e8]) assert.ok(Math.abs(scale.value(scale.position(value))-value)<.0001);
 assert.match(chart,/壓縮刻度/);
});
test('momentum bubble size is the absolute 20-day institutional amount, never turnover',()=>{
 const sector={name:'半導體',flow:100,flow5:-200,flow20:-400,momentum:-20,turnoverTwd:99999,changePct:1};
 assert.deepEqual(bubblePoints([sector],'momentum').map(s=>[s.x,s.y,s.size]),[[-200,-20,400]]);
 assert.equal(bubblePoints([{...sector,flow20:null}],'momentum').length,0);
 assert.equal(bubblePoints([sector],'day')[0].size,99999);
});
test('watchlist selects sectors while preserving all their constituents and historical totals',()=>{
 const original=globalThis.localStorage;
 globalThis.localStorage={getItem:()=>JSON.stringify(['2330'])};
 try {
  const data={stocks:[{symbol:'2330',industry:'半導體',market:'TWSE',netTwd:100,changePct:1},{symbol:'2303',industry:'半導體',market:'TWSE',netTwd:-60,changePct:-1},{symbol:'2881',industry:'金融',market:'TWSE',netTwd:20,changePct:1}],sectors:[{name:'半導體',flow5:500,flow20:400,momentum:80}]};
  const result=selectSectors(data,{scope:'watch'});
  assert.equal(result.length,1); assert.equal(result[0].flow,40);assert.equal(result[0].rows.length,2);
  assert.equal(result[0].flow20,400); assert.equal(result[0].momentum,80);
 } finally {if(original===undefined)delete globalThis.localStorage;else globalThis.localStorage=original;}
});
test('a missing trading session prevents a 20-day result and substituted quote dates are rejected',()=>{
 const sectors=[{name:'半導體',count:1,covered:1,flow:100}];
 const history=Array.from({length:20},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,sectors}));
 history[8]={date:history[8].date,sectors:[],unavailable:true};
 assert.equal(enrichResearch({date:'2026-09-20',stocks:[{industry:'半導體',netTwd:100}]},history).sectors[0].momentum,null);
 assert.throws(()=>normalizeHistoricalQuotes({date:'20260923'},'TWSE','2026-09-24',new Map()),/date mismatch/);
});
test('historical quote signs and identity are joined from official fields',()=>{
 const rows=normalizeHistoricalQuotes({tables:[{fields:['證券代號','收盤價','漲跌(+/-)','漲跌價差','成交金額'],data:[['2330','100','<p>-</p>','2','10,000']]}]},'TWSE','2026-09-24',new Map([['TWSE:2330',{name:'台積電',industry:'半導體'}]]));
 assert.ok(rows[0].changePct<0);assert.equal(rows[0].turnoverTwd,10000);
});
test('a same-symbol institutional record from another day is never joined',()=>{
 const rows=joinResearchStocks([{symbol:'2330',market:'TWSE',dataDate:'2026-09-24',price:100}],[[{symbol:'2330',market:'TWSE',date:'2026-09-23',netShares:500}]],'2026-09-24');
 assert.equal(rows[0].netTwd,null);
});
test('TPEx table fields normalize full institutional names',()=>{
 const rows=normalizeInstitutional({tables:[{fields:['代號','外資及陸資(不含外資自營商)買賣超股數','投信買賣超股數','自營商買賣超股數','三大法人買賣超股數合計'],data:[['6488','-1,000','200','100','-700']]}]},'TPEX','2026-09-24');
 assert.equal(rows[0].foreignShares,-1000);assert.equal(rows[0].netShares,-700);
});
