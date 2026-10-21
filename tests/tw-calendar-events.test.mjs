import test from 'node:test';
import assert from 'node:assert/strict';
import { mopsConferenceEvents, collectMopsConferences, twseDividendResults, mopsDividendRows, mopsPaymentEvents, monthsBetween } from '../scripts/news-tw-events.mjs';
import { inMarket } from '../src/components/news/model.js';
import { MARKET_CATEGORIES, EVENT_PROVIDERS } from '../src/components/news/config.js';

const stamp = '2026-10-21T00:00:00.000Z';
const list = rows => `<html><body><table><tr><th>公司代號</th><th>召開法人說明會日期</th></tr>${rows}</table></body></html>`;
const row = (symbol, name, date, time) => `<tr><td>${symbol}</td><td>${name}</td><td>${date}</td><td>${time}</td><td>線上</td><td>營運概況</td><td>${symbol}M.pdf</td><td>${symbol}E.pdf</td><td></td><td></td><td></td><td></td></tr>`;

test('every MOPS conference becomes a calendar event, including companies outside the TWSE venue table', async () => {
  const pages = [];
  const post = async (endpoint, form) => { pages.push(`${form.TYPEK}:${form.year}/${form.month}`);
    return form.TYPEK === 'sii' && form.month === '10' ? list(row('2330', '台積電', '115/10/15', '14:00') + row('1303', '南亞', '115/10/13', '15:00')) : list(''); };
  const events = await collectMopsConferences(stamp, '2026-10-21', post, 0);
  assert.deepEqual(pages, ['sii:115/9', 'otc:115/9', 'sii:115/10', 'otc:115/10', 'sii:115/11', 'otc:115/11', 'sii:115/12', 'otc:115/12']);
  const tsmc = events.find(e => e.symbol === '2330');
  assert.equal(tsmc.category, 'earnings'); assert.equal(tsmc.occursAt, '2026-10-15T06:00:00.000Z');
  assert.equal(tsmc.sourceId, 'mops-conferences'); assert.match(tsmc.documentUrl, /nas\/STR\/2330M\.pdf$/);
  assert.equal(events.length, 2);
});

test('an incomplete or empty MOPS conference list is a failure, so the last good events are kept', async () => {
  await assert.rejects(collectMopsConferences(stamp, '2026-10-21', async () => list(''), 0), /no listed company this month/);
  await assert.rejects(collectMopsConferences(stamp, '2026-10-21', async (e, form) => { if (form.TYPEK === 'otc') throw Error('timeout'); return list(row('2330', '台積電', '115/10/15', '14:00')); }, 0), /incomplete/);
});

test('TWSE ex-rights/dividend results become dividend events', () => {
  const events = twseDividendResults({ stat: 'OK', fields: ['資料日期','股票代號','股票名稱','除權息前收盤價','除權息參考價','權值+息值','權/息'], data: [['115年10月01日','9927','泰銘','70.10','65.10','5.000000','息']] }, stamp);
  assert.equal(events.length, 1);
  assert.equal(events[0].date, '2026-10-01'); assert.equal(events[0].category, 'dividend'); assert.equal(events[0].title, '泰銘（9927）除息'); assert.equal(events[0].cashDividend, 5);
  assert.throws(() => twseDividendResults({ stat: 'OK', fields: ['日期'], data: [] }, stamp), /layout/);
});

test('MOPS dividend announcements give cash payment dates', () => {
  const head = '<tr><th>公司代號</th><th>公司名稱</th><th>股利所屬期間</th><th>權利分派基準日</th><th>股票股利</th><th>現金股利</th></tr><tr><th>盈餘轉增資配股(元/股)</th><th>法定盈餘公積、資本公積轉增資配股(元/股)</th><th>除權交易日</th><th>盈餘分配之股東現金股利(元/股)</th><th>法定盈餘公積、資本公積發放之現金(元/股)</th><th>特別股配發現金股利(元/股)</th><th>除息交易日</th><th>現金股利發放日</th></tr>';
  const data = ['2028','威致','115年前半年度','115/11/01','','','','0.2','','','115/10/23','115/11/20','','','','324,021,800','115/10/07','09:13:45','新台幣10.0000元'];
  const rows = mopsDividendRows(`<html><table>${head}<tr>${data.map(v => `<td>${v}</td>`).join('')}</tr></table></html>`);
  assert.deepEqual(rows[0], { symbol: '2028', name: '威致', period: '115年前半年度', recordDate: '2026-11-01', exDividendDate: '2026-10-23', paymentDate: '2026-11-20', cash: 0.2, reserveCash: null, stock: null, announcedDate: '2026-10-07' });
  const [event] = mopsPaymentEvents(rows, stamp);
  assert.equal(event.category, 'payment'); assert.equal(event.date, '2026-11-20'); assert.equal(event.cashDividend, 0.2);
  assert.throws(() => mopsDividendRows('<html><table><tr><th>現金股利發放日</th></tr></table></html>'), /layout/);
});

test('the Taiwan calendar shows Taiwan market events only', () => {
  assert.deepEqual(MARKET_CATEGORIES.tw, ['dividend', 'earnings', 'holiday', 'dividend-preview', 'payment']);
  assert.ok(!EVENT_PROVIDERS.holiday.includes('nyse-calendar'));
  for (const sourceId of ['nyse-calendar', 'bls-calendar']) for (const scope of ['tw', 'all']) assert.equal(inMarket({ kind: 'event', category: 'holiday', sourceId, markets: ['tw'], date: '2026-11-26' }, scope), false);
  assert.equal(inMarket({ kind: 'event', category: 'earnings', sourceId: 'mops-conferences', markets: ['tw'], date: '2026-10-15' }, 'tw'), true);
  assert.deepEqual(monthsBetween('2026-01-15', -1, 1), [[2025, 12], [2026, 1], [2026, 2]]);
});
