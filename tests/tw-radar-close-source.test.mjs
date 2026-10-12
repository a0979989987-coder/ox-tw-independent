import test from 'node:test';
import assert from 'node:assert/strict';

function source(t,{date='2026-10-01',missingTpex=false}={}) {
  const requests=[];
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-01T08:00:00Z')});
  t.mock.method(globalThis,'fetch',async url=>{
    const target=String(url);requests.push(target);
    if(target.includes('t187ap05'))return Response.json([{公司代號:'2330',公司名稱:'台積電',產業別:'半導體業'},{公司代號:'6488',公司名稱:'環球晶',產業別:'半導體業'}]);
    if(target.includes('STOCK_DAY_ALL'))return Response.json([{Code:'2330',Name:'台積電',Date:date,ClosingPrice:'100',Change:'1',TradeVolume:'10000',TradeValue:'1000000'}]);
    if(target.includes('tpex_mainboard_quotes')&&!missingTpex)return Response.json([{SecuritiesCompanyCode:'6488',Name:'環球晶',Date:date,Close:'200',Change:'2',TradingShares:'10000',TransactionAmount:'2000000'}]);
    return new Response('temporarily unavailable',{status:503});
  });
  return requests;
}
test('a closing snapshot requires both official exchange quote feeds',async t=>{
  source(t,{missingTpex:true});
  const {getOfficialTWRadar}=await import('../api/v1/tw/providers/radar.js?close-missing-market');
  const individual=await getOfficialTWRadar();assert.equal(individual.meta.partial,true);
  await assert.rejects(getOfficialTWRadar({minimumDate:'2026-10-01'}),{code:'TW_RADAR_COMMON_DATE_NOT_FOUND'});
});
test('a stale quote cache cannot move the verified close backwards, including a warm provider cache',async t=>{
  const requests=source(t,{date:'2026-09-30'});
  const {getOfficialTWRadar}=await import('../api/v1/tw/providers/radar.js?close-stale-market');
  const prior=await getOfficialTWRadar();assert.equal(prior.dataDate,'2026-09-30');
  requests.length=0;
  await assert.rejects(getOfficialTWRadar({minimumDate:'2026-10-01'}),{code:'TW_RADAR_COMMON_DATE_NOT_FOUND'});
  assert(requests.some(url=>url.includes('date=20261001')));
  assert(!requests.some(url=>url.includes('date=20260930')));
});
test('verified current-day quotes from both markets remain eligible',async t=>{
  source(t);
  const {getOfficialTWRadar}=await import('../api/v1/tw/providers/radar.js?close-current-market');
  const data=await getOfficialTWRadar({minimumDate:'2026-10-01'});
  assert.equal(data.dataDate,'2026-10-01');
  assert.deepEqual(new Set(data.radar.map(row=>row.market)),new Set(['TWSE','TPEX']));
});

test('official four-digit DR quotes are retained even without a financial-report industry record',async t=>{
  source(t); const fetch = globalThis.fetch;
  t.mock.method(globalThis,'fetch',async url=>String(url).includes('STOCK_DAY_ALL')
    ? Response.json([{Code:'2330',Name:'台積電',Date:'2026-10-01',ClosingPrice:'100'}, {Code:'9103',Name:'美德醫療-DR',Date:'2026-10-01',ClosingPrice:'5.88',Change:'.53'}, {Code:'0050',Name:'ETF',Date:'2026-10-01',ClosingPrice:'50'}]) : fetch(url));
  const {getOfficialTWRadar}=await import('../api/v1/tw/providers/radar.js?dr-membership');
  const data=await getOfficialTWRadar({minimumDate:'2026-10-01'});
  assert.equal(data.radar.find(row=>row.symbol==='9103').price,5.88);
  assert(!data.radar.some(row=>row.symbol==='0050'));
});

test('Monday recovery reaches the verified pre-holiday session without spending requests on the weekend',async t=>{
  const requests=[];
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-12T02:00:00Z')});
  t.mock.method(globalThis,'fetch',async url=>{
    const target=String(url); requests.push(target);
    if(target.includes('t187ap05')) return Response.json([]);
    if(target.includes('date=20261008')) return Response.json({stat:'OK',tables:[{fields:['證券代號','證券名稱','收盤價','成交股數'],data:[['2330','台積電','100','10000']]}]});
    if(target.includes('115%2F10%2F08')) return Response.json({tables:[{fields:['代號','名稱','收盤','成交股數'],data:[['6488','環球晶','200','10000']]}]});
    return new Response('temporarily unavailable',{status:503});
  });
  const {getOfficialTWRadar}=await import('../api/v1/tw/providers/radar.js?long-holiday');
  const data=await getOfficialTWRadar({minimumDate:'2026-10-08'});
  assert.equal(data.dataDate,'2026-10-08');
  assert(!requests.some(url=>/date=2026101[01]|115%2F10%2F1[01]/.test(url)));
});
