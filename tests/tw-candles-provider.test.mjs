import test from 'node:test';
import assert from 'node:assert/strict';
import { getOfficialTWCandles } from '../api/v1/tw/providers/candles.js';

test('TPEx detail reads the current official tables schema and normalizes volume units', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    requests.push(url);
    let data = [];
    if (url.pathname.endsWith('/mopsfin_t187ap05_O')) data = [{ SecuritiesCompanyCode:'6221', CompanyName:'晉泰', Industry:'資訊服務業' }];
    if (url.pathname.endsWith('/tpex_mainboard_quotes')) data = [{ Date:'1150924', SecuritiesCompanyCode:'6221', CompanyName:'晉泰', Close:'32.20', Change:'0.60', Open:'31.90', High:'32.80', Low:'31.90', TradingShares:'840000', TransactionAmount:'27079000' }];
    if (url.pathname.endsWith('/tradingStock')) data = { tables:[{ data:[['115/09/24','840','27,079','31.90','32.80','31.90','32.20','0.60','766']] }] };
    return new Response(JSON.stringify(data), { status:200 });
  };
  try {
    const result = await getOfficialTWCandles('6221', { from:'2026-09-01', to:'2026-09-24', adjusted:false });
    assert.equal(result.candles.length,1);
    assert.equal(result.candles[0].close,32.2);
    assert.equal(result.candles[0].volume,840000);
    assert.equal(result.candles[0].turnoverTwd,27079000);
    const request = requests.find(url => url.pathname.endsWith('/tradingStock'));
    assert.equal(request.searchParams.get('code'),'6221');
    assert.equal(request.searchParams.get('date'),'2026/09/01');
  } finally { globalThis.fetch = original; }
});

test('official history pages preserve empty successful months, bound upstream work and never cache failures',async()=>{
 const original=globalThis.fetch;let mode='empty',calls=0;
 globalThis.fetch=async input=>{const url=new URL(input);let data=[];
  if(url.pathname.endsWith('/mopsfin_t187ap05_O'))data=[{SecuritiesCompanyCode:'6221',CompanyName:'晉泰',Industry:'資訊服務業'}];
  if(url.pathname.endsWith('/tpex_mainboard_quotes'))data=[{Date:'1150924',SecuritiesCompanyCode:'6221',CompanyName:'晉泰',Close:'32.20',Change:'0.60',Open:'31.90',High:'32.80',Low:'31.90',TradingShares:'840000',TransactionAmount:'27079000'}];
  if(url.pathname.endsWith('/tradingStock')){calls++;if(mode==='failure')return new Response('upstream unavailable',{status:503});data={stat:'ok',tables:[]};}
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  const empty=await getOfficialTWCandles('6221',{from:'1994-01-01',to:'1994-06-30',history:true,adjusted:false});
  assert.deepEqual(empty.candles,[]);assert.equal(empty.meta.historyPage,true);assert.equal(empty.meta.earliestAvailableDate,'1994-01-01');
  assert.equal(calls,6);await getOfficialTWCandles('6221',{from:'1994-01-01',to:'1994-06-30',history:true});assert.equal(calls,6);
  await assert.rejects(getOfficialTWCandles('6221',{from:'1994-01-01',to:'1994-07-31',history:true}),{code:'TW_CANDLES_INVALID_RANGE'});
  await assert.rejects(getOfficialTWCandles('6221',{from:'1994-02-30',to:'1994-06-30',history:true}),{code:'TW_CANDLES_INVALID_RANGE'});
  mode='failure';await assert.rejects(getOfficialTWCandles('6221',{from:'1994-07-01',to:'1994-07-31',history:true}),{code:'TW_CANDLES_PARTIAL_FAILURE'});
  mode='empty';const retried=await getOfficialTWCandles('6221',{from:'1994-07-01',to:'1994-07-31',history:true});assert.deepEqual(retried.candles,[]);assert.equal(calls,8);
 }finally{globalThis.fetch=original;}
});
