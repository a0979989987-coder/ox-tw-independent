import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInstitutional, joinResearchStocks } from '../server/markets/tw/research.js';
import { SECTOR_TAXONOMY_VERSION } from '../src/markets/tw/sector-taxonomy.js';
import { mergeResearchHistory } from '../src/markets/tw/research-data.js';

const date = '2026-10-05';
const fields = ['證券代號', '三大法人買賣超股數'];
const data = Array.from({ length: 600 }, (_, i) => [String(1000 + i), String(i - 300)]);
const payload = { stat: 'OK', date: '20261005', fields, data };
const fetcher = body => async () => new Response(JSON.stringify(body));
const quotes = [...data.map(([symbol]) => ({ symbol, market: 'TWSE', dataDate: date, price: 10 })),
  { symbol: '2330', market: 'TWSE', dataDate: date, price: 20 }];

test('a complete dated whole-market report establishes sparse no-activity records without changing reported flows', async () => {
  const feed = await loadInstitutional(date, 'TWSE', fetcher(payload));
  assert.equal(feed.report.complete, true);
  const stocks = joinResearchStocks(quotes, [feed], date);
  assert.equal(stocks[0].netTwd, -3000);
  assert.equal(stocks.at(-1).netTwd, 0);
  assert.equal(stocks.at(-1).flowBasis, 'not-listed-in-complete-report');
});

test('samples, broken values, truncated reports and another date never turn unknown activity into zero', async () => {
  for (const body of [{ ...payload, data: data.slice(0, 10) }, { ...payload, totalCount: 601 },
    { ...payload, data: [...data.slice(0, -1), ['1599', '--']] }]) {
    const feed = await loadInstitutional(date, 'TWSE', fetcher(body));
    assert.equal(feed.report.complete, false);
    assert.equal(joinResearchStocks(quotes, [feed], date).at(-1).netTwd, null);
  }
  const feed = await loadInstitutional(date, 'TWSE', fetcher(payload));
  assert.equal(joinResearchStocks([{ ...quotes.at(-1), dataDate: '2026-10-06' }], [feed], '2026-10-06')[0].netTwd, null);
  assert.equal(joinResearchStocks([{ symbol: '9999', market: 'TWSE', dataDate: date, price: 20 }], [feed], date)[0].netTwd, null);
  await assert.rejects(loadInstitutional(date, 'TWSE', fetcher({ ...payload, date: '20261002' })), /date mismatch/);
});

test('TPEx grouped headers follow the official 24-column template and unpaginated row count', async () => {
  const grouped = ['代號','名稱', ...Array.from({length: 7}, () => ['買進股數','賣出股數','買賣超股數']).flat(), '三大法人買賣超股數合計'];
  const rows = data.map(([symbol]) => [symbol, '公司', ...Array(22).fill('0')]);
  for (const row of rows) { row[4] = '2'; row[13] = '3'; row[22] = '4'; row[23] = '9'; }
  const feed = await loadInstitutional(date, 'TPEX', fetcher({stat:'ok',date:'20261005',tables:[{date:'115/10/05',fields:grouped,data:rows,totalCount:600}]}));
  assert.equal(feed.report.complete, true);
  assert.deepEqual([feed[0].foreignShares, feed[0].trustShares, feed[0].dealerShares, feed[0].netShares], [2,3,4,9]);
});

test('legacy refreshes cannot erase repaired history, even when their timestamp is newer', async () => {
  const complete = { date, updatedAt: '2026-10-06T01:00:00Z', stocks: [{ symbol:'2330', netTwd:0 }],
    coverageVersion:'complete-market-report-v2', sourceHealth:{TWSE:{complete:true},TPEX:{complete:true}} };
  const repaired = { ...complete, themeVersion:SECTOR_TAXONOMY_VERSION, sectors:[{name:'A',flow:0}], themes:[{name:'A',flow:0}] };
  const legacy = { date, updatedAt: '2026-10-06T02:00:00Z', stocks:[{symbol:'2330',netTwd:null}], history:[{date,sectors:[],themes:[],themeVersion:SECTOR_TAXONOMY_VERSION}] };
  assert.deepEqual(mergeResearchHistory([repaired],legacy.history,date),[repaired]);
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem:()=>JSON.stringify(legacy),setItem(){} };
  globalThis.fetch = async url => ({ok:true,json:async()=>String(url).includes('data/tw-research.json')
    ? structuredClone({...complete,history:[repaired]}) : {data:structuredClone(legacy)}});
  try {
    const module = await import('../src/markets/tw/research-data.js?complete-coverage-test');
    await module.loadResearch({force:true});
    assert.equal(module.savedResearch().stocks[0].netTwd,0);
    assert.deepEqual(module.savedResearch().history,[repaired]);
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});
