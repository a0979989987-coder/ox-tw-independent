import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { getOfficialTWCandles } from '../api/v1/tw/providers/candles.js';

// Market identification needs both exchanges in the official list; a list with
// only TPEx rows is incomplete and is answered with 503, not used.
const twseDailyAll = [{ Date:'1150924', Code:'2330', Name:'台積電', TradeVolume:'1000', TradeValue:'1000000', OpeningPrice:'995', HighestPrice:'1005', LowestPrice:'990', ClosingPrice:'1000', Change:'5', Transaction:'10' }];

test('TPEx detail reads the current official tables schema and normalizes volume units', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    requests.push(url);
    let data = [];
    if (url.pathname.endsWith('/mopsfin_t187ap05_O')) data = [{ SecuritiesCompanyCode:'6221', CompanyName:'晉泰', Industry:'資訊服務業' }];
    if (url.pathname.endsWith('/tpex_mainboard_quotes')) data = [{ Date:'1150924', SecuritiesCompanyCode:'6221', CompanyName:'晉泰', Close:'32.20', Change:'0.60', Open:'31.90', High:'32.80', Low:'31.90', TradingShares:'840000', TransactionAmount:'27079000' }];
    if (url.pathname.endsWith('/STOCK_DAY_ALL')) data = twseDailyAll;
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
  if(url.pathname.endsWith('/STOCK_DAY_ALL'))data=twseDailyAll;
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

// The published K-line pack is read from this repository's data/tw-patterns.
const packRead = async path => new Uint8Array(await readFile(new URL(`../${path}`, import.meta.url)));
const packManifest = JSON.parse(await readFile(new URL('../data/tw-patterns/manifest.json', import.meta.url), 'utf8'));
async function packEntry(symbol) {
  const chunk = packManifest.chunks.find(row => row.symbols.includes(symbol));
  const payload = JSON.parse(gunzipSync(await readFile(new URL(`../data/tw-patterns/${chunk.file}`, import.meta.url))));
  return payload.entries.find(entry => entry.data.symbol === symbol).data;
}
const ohlcv = candle => [candle.date, candle.open, candle.high, candle.low, candle.close, candle.volume];
// Every candle inside the pack range is the pack's own candle.
function assertPackRange(result, entry, symbol) {
  const start = result.from > packManifest.dates[0] ? result.from : packManifest.dates[0], inPack = candle => candle.date >= start && candle.date <= packManifest.date;
  assert.deepEqual(result.candles.filter(inPack).map(ohlcv), entry.candles.filter(inPack).map(ohlcv), symbol);
}
const dayAfterPack = days => new Date(Date.parse(packManifest.date) + days * 86400000).toISOString().slice(0, 10);
const rocDate = iso => `${Number(iso.slice(0, 4)) - 1911}/${iso.slice(5, 7)}/${iso.slice(8)}`;

test('3M candles for 2330, 6210 and 8299 come from the K-line pack without official requests', async t => {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async input => { requests.push(String(input)); return new Response('unavailable', { status:503 }); };
  globalThis.__twReadAsset = packRead;
  t.after(() => { globalThis.fetch = original; delete globalThis.__twReadAsset; });
  for (const symbol of ['2330', '6210', '8299']) {
    const entry = await packEntry(symbol);
    const result = await getOfficialTWCandles(symbol, { range:'3M', to:packManifest.date, adjusted:false });
    assert.ok(result.candles.length > 0, symbol);
    assertPackRange(result, entry, symbol);
    assert.equal(result.market, entry.board, symbol);
    assert.equal(result.partial, false);
    assert.equal(result.meta.source, 'TW-PATTERNS-PACK');
    assert.equal(result.meta.packDate, packManifest.date);
  }
  assert.deepEqual(requests, []);
});

test('ranges older than the pack fetch only the missing official months before the pack', async t => {
  const original = globalThis.fetch, months = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (!url.pathname.endsWith('/STOCK_DAY')) return new Response('unavailable', { status:503 });
    const date = url.searchParams.get('date'); months.push(date);
    const roc = `${Number(date.slice(0, 4)) - 1911}/${date.slice(4, 6)}/05`;
    return new Response(JSON.stringify({ stat:'OK', data:[[roc,'1,000','1,000,000','100','101','99','100','+1','10']] }), { status:200 });
  };
  globalThis.__twReadAsset = packRead;
  t.after(() => { globalThis.fetch = original; delete globalThis.__twReadAsset; });
  const entry = await packEntry('2330');
  const result = await getOfficialTWCandles('2330', { range:'1Y', to:packManifest.date, adjusted:false });
  assert.ok(months.length > 0);
  assert.ok(months.every(month => `${month.slice(0, 4)}-${month.slice(4, 6)}` <= packManifest.dates[0].slice(0, 7)));
  const before = result.candles.filter(candle => candle.date < packManifest.dates[0]);
  assert.ok(before.length > 0 && before.every(candle => candle.close === 100));
  assertPackRange(result, entry, '2330');
  assert.equal(result.meta.source, 'TW-PATTERNS-PACK+TWSE-STOCK-DAY');
});

test('official days after the pack are appended; inside the pack range the pack wins', async t => {
  const original = globalThis.fetch, after = dayAfterPack(1);
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (!url.pathname.endsWith('/STOCK_DAY')) return new Response('unavailable', { status:503 });
    return new Response(JSON.stringify({ stat:'OK', data:[
      [rocDate(packManifest.date),'1,000','1,000,000','1','1','1','1','0','1'],
      [rocDate(after),'2,000','2,000,000','10','12','9','11','+1','20']
    ] }), { status:200 });
  };
  globalThis.__twReadAsset = packRead;
  t.after(() => { globalThis.fetch = original; delete globalThis.__twReadAsset; });
  const entry = await packEntry('2330');
  const result = await getOfficialTWCandles('2330', { range:'3M', to:dayAfterPack(3), adjusted:false });
  assertPackRange(result, entry, '2330');
  assert.deepEqual(ohlcv(result.candles.at(-1)), [after, 10, 12, 9, 11, 2000]);
  assert.equal(result.meta.afterPackCandles, 1);
  assert.equal(result.partial, false);
  assert.equal(result.meta.source, 'TW-PATTERNS-PACK+TWSE-STOCK-DAY');
});

test('a failed or slow official day after the pack returns the pack alone, not partial', async t => {
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis:['setTimeout'] });
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.searchParams.get('code') === '8299') return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    return new Response('unavailable', { status:503 });
  };
  globalThis.__twReadAsset = packRead;
  t.after(() => { globalThis.fetch = original; delete globalThis.__twReadAsset; });
  for (const symbol of ['6210', '8299']) {
    const entry = await packEntry(symbol);
    let settled = null;
    const pending = getOfficialTWCandles(symbol, { range:'3M', to:dayAfterPack(3), adjusted:false }).then(value => settled = value);
    // Advance mocked time while the pack is read for real, until the request settles.
    const started = Date.now();
    while (!settled && Date.now() - started < 20000) {
      await new Promise(resolve => setImmediate(resolve));
      t.mock.timers.tick(100);
    }
    assert.ok(settled, symbol + ' must settle without waiting for the official feed');
    const result = await pending;
    assertPackRange(result, entry, symbol);
    assert.equal(result.candles.at(-1).date, entry.candles.at(-1).date, symbol);
    assert.equal(result.partial, false, symbol);
    assert.equal(result.meta.afterPackCandles, 0, symbol);
    assert.equal(result.meta.source, 'TW-PATTERNS-PACK', symbol);
  }
});

test('a failed official month returns the months received and is marked partial', async () => {
  const original = globalThis.fetch;
  let failAll = false;
  globalThis.fetch = async input => {
    const url = new URL(input);
    let data = [];
    if (url.pathname.endsWith('/mopsfin_t187ap05_O')) data = [{ SecuritiesCompanyCode:'6221', CompanyName:'晉泰', Industry:'資訊服務業' }];
    if (url.pathname.endsWith('/tpex_mainboard_quotes')) data = [{ Date:'1150924', SecuritiesCompanyCode:'6221', CompanyName:'晉泰', Close:'32.20', Change:'0.60', Open:'31.90', High:'32.80', Low:'31.90', TradingShares:'840000', TransactionAmount:'27079000' }];
    if (url.pathname.endsWith('/STOCK_DAY_ALL')) data = twseDailyAll;
    if (url.pathname.endsWith('/tradingStock')) {
      const date = url.searchParams.get('date');
      if (failAll || date === '2025/02/01') return new Response('not json', { status:200 });
      data = { tables:[{ data:[[`114/${date.slice(5, 7)}/10`,'840','27,079','31.90','32.80','31.90','32.20','0.60','766']] }] };
    }
    return new Response(JSON.stringify(data), { status:200 });
  };
  try {
    const result = await getOfficialTWCandles('6221', { from:'2025-01-01', to:'2025-03-31', adjusted:false });
    assert.equal(result.partial, true);
    assert.deepEqual(result.meta.failedMonths, ['2025-02']);
    assert.deepEqual(result.candles.map(candle => candle.date), ['2025-01-10', '2025-03-10']);
    failAll = true;
    await assert.rejects(getOfficialTWCandles('6221', { from:'2025-04-01', to:'2025-05-31', adjusted:false }), { code:'TW_CANDLES_PARTIAL_FAILURE' });
  } finally { globalThis.fetch = original; }
});
