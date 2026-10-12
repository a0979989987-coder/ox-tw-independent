import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTWSurveillance} from '../server/markets/tw/surveillance.js';
import {hydrateTWStockCard, rowsForTWMode, renderTWStockCard} from '../src/markets/tw/radar-card.js';
import {currentTWDisposition} from '../src/markets/tw/disposition-calendar.js';
import {riskDetailContent} from '../src/markets/tw/risk-detail.js';

const ok = rows => ({ok: true, rows});
const calendar = {years:['2026'], closed:['2026-10-09'], open:[]};
const options = {now:new Date('2026-10-12T02:00:00Z'), dataDate:'2026-10-08'};
test('full exchange disposal reports add omitted members and replace an older extended period', () => {
  const feeds = {
    calendar:ok([{Date:'1151009',Name:'國慶日補假'}]),
    twseDisposal:ok([]), tpexDisposal:ok([{SecuritiesCompanyCode:'6708',CompanyName:'天擎',Date:'1151002',DispositionPeriod:'1151005~1151013',DisposalCondition:'每2分鐘撮合一次'}]),
    twseDisposalHistory:ok([{公布日期:'115/10/08',證券代號:'8021',證券名稱:'昇陽半',處置起迄時間:'115/10/12～115/10/16',處置條件:'连续三次',處置內容:'每二分鐘撮合一次',處置措施:'第一次處置'}]),
    tpexDisposalHistory:ok([{公布日期:'115/10/08',證券代號:'6708',證券名稱:'天擎(../../mainboard/listed/company-detail.html?code=6708)',處置起訖時間:'115/10/12~115/10/16',處置原因:'延長處置',處置內容:'每20分鐘撮合一次',處置措施:'第二次處置'},
      {公布日期:'115/10/08',證券代號:'5475',證券名稱:'德宏',處置起訖時間:'115/10/12~115/10/16',處置內容:'每2分鐘撮合一次'}])
  };
  const result = buildTWSurveillance(feeds, [], options);
  assert.deepEqual(new Set(result.modes.disposal.map(r=>r.symbol)), new Set(['8021','6708','5475']));
  const extended = result.modes.disposal.find(r=>r.symbol==='6708');
  assert.equal(extended.disposition.endDate,'2026-10-16');
  assert.equal(extended.disposition.resumeDate,'2026-10-19');
  assert.equal(extended.disposition.batchMinutes,20);
  assert.equal(extended.name,'天擎');
  assert(result.modes.disposal.every(r=>r.disposition.detail));
});
test('missing daily quotes use a dated official announcement close, never a fake current quote', () => {
  const data = buildTWSurveillance({tpexAttentionHistory:ok([{證券代號:'6661',證券名稱:'威健生技',公告日期:'115/10/02',收盤價:'16.75',注意交易資訊:'成交量異常'}])}, [], options);
  const row = data.modes.risk[0];
  assert.equal(row.price,16.75); assert.equal(row.dataDate,'2026-10-02');
  assert.equal(row.change,undefined); assert.equal(row.quoteLabel,'2026-10-02 公告收盤價');
  assert.match(renderTWStockCard(row,new Set()), /2026-10-02 公告收盤價/);
  assert.match(riskDetailContent(row,null), /2026-10-02 公告收盤價/);
});
test('sparse announcement rows retain available quote facts and their actual session', () => {
  const source = {symbol:'8021',name:'昇陽半',market:'TWSE',price:null,dataDate:'2026-10-08',disposition:{status:'active',detail:'官方完整處置內容'}};
  const quote = {symbol:'8021',market:'TWSE',industry:'半導體業',price:301,change:2,changePct:0.67,dataDate:'2026-10-07'};
  const row = hydrateTWStockCard(source,[quote]);
  assert.equal(row.price,301); assert.equal(row.dataDate,'2026-10-07');
  assert.equal(row.industry,'半導體業'); assert.equal(row.disposition.detail,'官方完整處置內容');
  assert.equal(row.quoteLabel,'2026-10-07 最近收盤價');
  assert.equal(hydrateTWStockCard(source,[{...quote,market:'TPEX'}]).price,null);
});
test('cached periods advance across the official holiday and include a now-started disposition', () => {
  const active = {symbol:'3016',disposition:{status:'active',startDate:'2026-10-01',endDate:'2026-10-12',releaseDays:1}};
  const scheduled = {symbol:'8021',disposition:{status:'risk',scheduled:true,startDate:'2026-10-12',endDate:'2026-10-16',releaseDays:5}};
  const ended = {symbol:'2000',disposition:{status:'active',startDate:'2026-10-01',endDate:'2026-10-08',releaseDays:0}};
  const state = {data:{radarModes:{disposal:[active,ended],risk:[scheduled]},radarModesMeta:{calendar}}};
  const rows = rowsForTWMode(state,'disposal',[],new Set(),'2026-10-12');
  assert.deepEqual(rows.map(r=>r.symbol),['3016','8021']);
  assert.equal(rows[0].disposition.releaseDays,0); assert.equal(rows[1].disposition.releaseDays,4);
  assert.equal(currentTWDisposition(active,calendar,'2026-10-08').disposition.releaseDays,1);
  assert.equal(active.disposition.releaseDays,1);
});
test('newer empty quotes cannot erase a valid price; same-session facts fill only missing fields', () => {
  const source={symbol:'8021',market:'TWSE',price:100,dataDate:'2026-10-08'};
  const blank=hydrateTWStockCard(source,[{symbol:'8021',market:'TWSE',price:null,dataDate:'2026-10-12'}]);
  assert.equal(blank.price,100); assert.equal(blank.dataDate,'2026-10-08');
  const filled=hydrateTWStockCard(source,[{symbol:'8021',market:'TWSE',price:100,change:3,changePct:3.09,dataDate:'2026-10-08'}]);
  assert.equal(filled.change,3); assert.equal(filled.changePct,3.09);
});
test('an expired period does not remove still-published risk notices or retain a stale countdown', () => {
  const row={symbol:'3016',disposition:{status:'active',startDate:'2026-10-01',endDate:'2026-10-08',releaseDays:0,batchMinutes:2,noticeDate:'2026-10-08',riskBasis:'連續二次',riskLabel:'最快 1 個交易日後可能再次處置',checkedAt:'2026-10-08T09:00:00Z'}};
  const state={data:{radarModes:{risk:[row]},radarModesMeta:{calendar}}};
  const risk=rowsForTWMode(state,'risk',[],new Set(),'2026-10-12');
  assert.equal(risk.length,1); assert.equal(risk[0].disposition.status,'risk');
  assert.equal(risk[0].disposition.batchMinutes,null); assert.equal(risk[0].disposition.endDate,'');
  assert.equal(currentTWDisposition({...row,disposition:{...row.disposition,endDate:'2026-10-16',releaseDays:4}},null,'2026-10-12').disposition.releaseDays,null);
});
test('an empty current quote falls back to the proper-market official notice', () => {
  const feeds={tpexAttentionHistory:ok([{證券代號:'6661',證券名稱:'威健生技',公告日期:'115/10/02',收盤價:'16.75',注意交易資訊:'成交量異常'}])};
  for (const quote of [{symbol:'6661',market:'TPEX',price:null,dataDate:'2026-10-08'}, {symbol:'6661',market:'TWSE',price:99,dataDate:'2026-10-08'}]) {
    const row=buildTWSurveillance(feeds,[quote],options).modes.risk[0];
    assert.equal(row.price,16.75);assert.equal(row.market,'TPEX');assert.equal(row.dataDate,'2026-10-02');
  }
});
test('official report endpoints recover calendar and accumulated warnings when OpenAPI is unavailable', async t => {
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('/rwd/zh/holidaySchedule/'))return Response.json({stat:'ok',fields:['日期','名稱','說明'],data:[['2026-10-09','國慶日','休市']]});
    if(String(url)==='https://www.twse.com.tw/announcement/notetrans?response=json')return Response.json({stat:'OK',fields:['編號','證券代號','證券名稱','近期達本公司「公布注意交易資訊」標準之情形'],data:[[1,'2492','華新科','115年10月7日至115年10月8日連續二次']]});
    return new Response('temporarily unavailable',{status:503});
  });
  const {loadTWSurveillance}=await import('../server/markets/tw/surveillance.js?official-report-fallback');
  const feeds=await loadTWSurveillance({now:options.now});
  assert.equal(feeds.calendar.ok,true);assert.equal(feeds.calendar.rows[0].Date,'2026-10-09');
  assert.equal(feeds.twseRisk.ok,true);assert.equal(feeds.twseRisk.rows[0].Code,'2492');
});
test('an unavailable full disposal report cannot certify lagging OpenAPI as complete', () => {
  const result=buildTWSurveillance({twseDisposal:ok([]),tpexDisposal:ok([]),twseDisposalHistory:ok([]),tpexDisposalHistory:{ok:false,rows:[]}},[],options);
  assert.equal(result.modesMeta.disposal.status,'partial');
});
