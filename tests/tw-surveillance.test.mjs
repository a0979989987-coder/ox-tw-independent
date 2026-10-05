import test from 'node:test';
import assert from 'node:assert/strict';
import { officialDate, tradingCalendar, tradingDaysBetween, attentionProgress, batchMinutes, buildTWSurveillance, loadTWSEAttentionForDate, loadTWSurveillance } from '../server/markets/tw/surveillance.js';

const ok = rows => ({ ok: true, rows });
const calendar = [
  { Date: '1150925', Name: '中秋節' },
  { Date: '1150928', Name: '教師節' },
  { Date: '1150102', Name: '國曆新年開始交易日' }
];
const feeds = () => ({
  calendar: ok(calendar),
  twseDisposal: ok([{ Code:'2305', Name:'全友', Date:'1150917', DispositionPeriod:'115/09/18～115/09/30', Detail:'约每二分鐘撮合一次', ReasonsOfDisposition:'連續五次' },
    { Code:'3443', Name:'創意', Date:'1150924', DispositionPeriod:'115/09/29～115/10/05', Detail:'約每2分鐘撮合一次' }]),
  tpexDisposal: ok([{ SecuritiesCompanyCode:'5314', CompanyName:'世紀', Date:'1150921', DispositionPeriod:'1150922~1150930', DisposalCondition:'約每20分鐘撮合一次' },
    { SecuritiesCompanyCode:'22211', CompanyName:'大甲一', Date:'1150923', DispositionPeriod:'1150924~1151006' }]),
  twseRisk: ok([{ Code:'1560', Name:'中砂', RecentlyMetAttentionSecuritiesCriteria:'115年9月23日至115年9月24日連續二次' },
    { Code:'053040', Name:'權證', RecentlyMetAttentionSecuritiesCriteria:'115年9月23日至115年9月24日連續二次' }]),
  tpexRisk: ok([]), twseMargin: ok([]), tpexMargin: ok([]), twseDay: ok([]), tpexDay: ok([]), futures: ok([])
});
const options = { now: new Date('2026-09-27T11:00:00Z'), dataDate:'2026-09-24' };

test('near-threshold warning retains exact-date full attention announcement without replacing risk counts',()=>{
 const input=feeds();input.twseAttentionHistory=ok([{日期:'1150924',證券代號:'1560',證券名稱:'中砂',注意交易資訊:'最近六個營業日累積漲幅達公告标准。'},{日期:'1151001',證券代號:'1560',注意交易資訊:'未來公告'}]);
 const row=buildTWSurveillance(input,[],options).modes.risk.find(r=>r.symbol==='1560');
 assert.equal(row.disposition.noticeText,'最近六個營業日累積漲幅達公告标准。');assert.equal(row.disposition.noticeTextDate,'2026-09-24');assert(row.disposition.riskBasis.includes('連續二次'));
});

test('official dates parse ROC and Gregorian without accepting invalid dates', () => {
  assert.equal(officialDate('1150924'), '2026-09-24');
  assert.equal(officialDate('20260924'), '2026-09-24');
  assert.equal(officialDate('115年9月24日'), '2026-09-24');
  assert.equal(officialDate('115.09.24'), '2026-09-24');
  assert.equal(officialDate('115/13/01'), '');
  assert.equal(officialDate('115/02/30'), '');
});
test('recent official notices include every distinct listed and OTC stock, with latest date and no invented threshold', () => {
  const f = feeds();
  f.twseAttention = ok([]); f.tpexAttention = ok([]);
  f.twseAttentionHistory = ok(Array.from({length: 70}, (_, i) => ({ '證券代號': String(8000+i), '證券名稱': `上市${i}`, '日期': i === 0 ? '115.09.18' : '115.09.24', '注意交易資訊': '成交異常' })));
  f.tpexAttentionHistory = ok(Array.from({length: 70}, (_, i) => ({ '證券代號': String(9000+i), '證券名稱': `上櫃${i}`, '公告日期': '115/09/24', '注意交易資訊': '週轉率異常' })));
  f.tpexAttentionHistory.rows.push({ '證券代號':'9000', '證券名稱':'上櫃0', '公告日期':'115/09/23' });
  f.tpexAttentionHistory.rows.push({ '證券代號':'22211', '證券名稱':'可轉債', '公告日期':'115/09/24' });
  f.twseAttentionHistory.rows.push({ '證券代號':'2305', '證券名稱':'處置中', '日期':'115.09.24' });
  const result = buildTWSurveillance(f, [], options);
  assert.equal(result.modes.risk.length, 142); // 140 notices + 1 near threshold + 1 scheduled disposition
  assert.equal(result.modes.disposal.length, 2);
  assert.equal(result.modes.release.length, 2);
  assert.equal(result.modes.risk.find(row => row.symbol === '9000').disposition.noticeDate, '2026-09-24');
  assert.equal(result.modes.risk.find(row => row.symbol === '9000').disposition.riskProgress, null);
  assert.equal(result.modes.risk.some(row => row.symbol === '2305'), false);
  assert.equal(result.modesMeta.risk.status, 'ready');
});
test('historical attention fetch requests complete official reports in parallel', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(String(url));
    if (String(url).includes('bulletin/attention')) return { ok:true, json:async()=>({ stat:'ok', tables:[{ fields:['證券代號','證券名稱','公告日期'], data:[['2221','大甲','115/09/29']] }] }) };
    if (String(url).includes('announcement/notice?')) return { ok:true, json:async()=>({ stat:'OK', fields:['證券代號','證券名稱','日期'], data:[['1528','恩德','115.09.29']] }) };
    return { ok:true, json:async()=>[] };
  });
  const loaded = await loadTWSurveillance({now:new Date('2026-09-30T01:30:00Z')});
  assert.deepEqual(loaded.twseAttentionHistory.rows.map(row=>row['證券代號']),['1528']);
  assert.deepEqual(loaded.tpexAttentionHistory.rows.map(row=>row['證券代號']),['2221']);
  assert.ok(urls.some(url=>url.includes('announcement/notice?') && url.includes('startDate=20260831') && url.includes('endDate=20260930')));
  assert.ok(urls.some(url=>url.includes('bulletin/attention?') && url.includes('type=all') && url.includes('response=json')));
});
test('release countdown excludes weekends and official holidays and fails closed across unknown years', () => {
  const c = tradingCalendar(calendar);
  assert.equal(tradingDaysBetween('2026-09-24','2026-09-29',c),1);
  assert.equal(tradingDaysBetween('2026-09-27','2026-09-30',c),2);
  assert.equal(tradingDaysBetween('2026-09-30','2026-09-30',c),0);
  assert.equal(tradingDaysBetween('2026-12-31','2027-01-04',c),null);
  assert.equal(tradingDaysBetween('2026-09-27','2026-09-30',null),null);
});
test('official attention counts support the meter without inventing probabilities', () => {
  assert.deepEqual(attentionProgress('連續二次'),{current:2,target:3,label:'連續注意 2/3 次'});
  assert.equal(attentionProgress('九個營業日已有五次').target,6);
  assert.equal(attentionProgress('不明條件'),null);
  assert.equal(batchMinutes('約每二分鐘撮合一次'),2);
  assert.equal(batchMinutes('約每２０分鐘撮合一次'),20);
});
test('three modes use actual membership, exclude warrants/bonds and separate scheduled dispositions', () => {
  const d = buildTWSurveillance(feeds(),[{symbol:'1560',price:971,change:16},{symbol:'9999',price:500,changePct:10}],options);
  assert.deepEqual(d.modes.risk.map(r=>r.symbol),['1560','3443']);
  assert.deepEqual(d.modes.disposal.map(r=>r.symbol),['2305','5314']);
  assert.equal(d.modes.release.length,2);
  assert.equal(d.modes.release[0].disposition.releaseDays,2);
  assert.equal(d.modes.risk[0].price,971);
  assert.equal(d.modes.risk[0].disposition.noRepeatRisk,null);
  assert.equal(d.modesMeta.disposal.status,'ready');
});
test('failed feeds are errors rather than an empty confirmed list and cannot create release counts', () => {
  const f = feeds();f.calendar={ok:false,rows:[]};f.twseDisposal={ok:false,rows:[]};
  const d = buildTWSurveillance(f,[],options);
  assert.equal(d.modesMeta.disposal.status,'partial');
  assert.equal(d.modesMeta.release.status,'error');
  assert.equal(d.modes.release.length,0);
  assert.equal(d.modes.disposal[0].disposition.releaseDays,null);
});
test('expired warnings and finished dispositions cannot remain current', () => {
  const d=buildTWSurveillance(feeds(),[],{now:new Date('2026-10-06T11:00:00Z'),dataDate:'2026-10-06'});
  assert.equal(d.modes.risk.length,0);
  assert.equal(d.modes.disposal.length,0);
});
test('dated TWSE report maps the complete official daily list, not a sample or radar quote limit', async t => {
  const entries = Array.from({ length: 65 }, (_, i) => [`${8000 + i}`, `測試${i}`, '1', '成交異常', '115/09/24', '50', '10']);
  let requested = '';
  t.mock.method(globalThis, 'fetch', async url => {
    requested = url;
    return { ok: true, json: async () => ({ fields: ['證券代號','證券名稱','累計次數','注意交易資訊','日期','收盤價','本益比'], data: entries }) };
  });
  const daily = await loadTWSEAttentionForDate('2026-09-24');
  assert.match(requested, /startDate=20260924&endDate=20260924/);
  assert.equal(daily.rows.length, 65);
  const f = feeds();
  f.twseAttention = daily;
  const result = buildTWSurveillance(f, [], options);
  assert.equal(result.modes.risk.length, 67);
  assert.equal(result.modes.risk.find(row => row.symbol === '8064').disposition.riskProgress, null);
});
