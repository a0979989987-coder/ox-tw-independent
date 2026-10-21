import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConferenceList, parseTaiex, priceReaction, baseIndex, monthsAround } from '../server/markets/tw/conferences.js';

// Layout of the MOPS list (two header rows, then one row per conference).
const html = `<html><body><table>
<tr><th>公司代號</th><th>公司名稱</th><th>召開法人說明會日期</th><th>召開法人說明會時間</th><th>召開法人說明會地點</th><th>法人說明會擇要訊息</th><th colspan=2>法人說明會簡報內容</th></tr>
<tr><th>中文檔案</th><th>英文檔案</th></tr>
<tr><td>2330</td><td>台積電</td><td>115/10/15</td><td>14:00</td><td>線上法說會</td><td>公布第3季財務報告</td><td><a>233020261015M001.pdf</a></td><td>233020261015E001.pdf</td><td>https://investor.tsmc.com</td><td></td><td>無</td><td></td></tr>
<tr><td>2221</td><td>大甲</td><td>115/10/08 至 115/10/13</td><td>9:30</td><td>線上</td><td>營運概況 &amp; 美吾髮&amp;#174;展望</td><td>222120261008M001.pptx</td><td>222120261008E001.pdf</td><td></td><td></td><td></td><td></td></tr>
<tr><td>3105</td><td>穩懋</td><td>115/10/23</td><td>14:00</td><td>網路直播</td><td>第三季</td><td>內容檔案於當日會後公告於公開資訊觀測站</td><td>內容檔案於當日會後公告於公開資訊觀測站</td><td></td><td></td><td></td><td></td></tr>
</table></body></html>`;

test('the MOPS list is parsed into conferences with slide links', () => {
  const rows = parseConferenceList(html, 'TWSE');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { id:'TWSE:2330:2026-10-15:14:00', symbol:'2330', name:'台積電', market:'TWSE', date:'2026-10-15', endDate:null, time:'14:00', location:'線上法說會', summary:'公布第3季財務報告',
    zhUrl:'https://mopsov.twse.com.tw/nas/STR/233020261015M001.pdf', enUrl:'https://mopsov.twse.com.tw/nas/STR/233020261015E001.pdf', slideNote:null });
  assert.equal(rows[1].date, '2026-10-08'); assert.equal(rows[1].endDate, '2026-10-13'); assert.equal(rows[1].time, '09:30');
  assert.equal(rows[1].summary, '營運概況 & 美吾髮®展望'); assert.match(rows[1].zhUrl, /222120261008M001\.pptx$/);
  assert.equal(rows[2].zhUrl, null); assert.equal(rows[2].enUrl, null); assert.equal(rows[2].slideNote, '內容檔案於當日會後公告於公開資訊觀測站');
  assert.deepEqual(parseConferenceList('<html>查無資料</html>', 'TPEX'), []);
  assert.throws(() => parseConferenceList('<html><body>系統忙碌</body></html>', 'TPEX'), /layout/);
});

test('TAIEX closes are read from the official monthly history', () => {
  const rows = parseTaiex({ stat:'OK', fields:['日期','開盤指數','最高指數','最低指數','收盤指數'], data:[['115/10/20','46,712.57','46,967.91','46,163.03','46,292.93']] }, '2026-10');
  assert.deepEqual(rows, [{ date:'2026-10-20', close:46292.93 }]);
  assert.throws(() => parseTaiex({ stat:'error' }, '2026-10'), /unavailable/);
});

const days = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10));
const series = (start, step) => new Map(days.map((day, i) => [day, start + i * step]));

test('the base is the last close before the conference', () => {
  assert.equal(days[baseIndex(days, days[12], '14:00')], days[12], 'after 13:30 the same day closed first');
  assert.equal(days[baseIndex(days, days[12], '13:30')], days[12]);
  assert.equal(days[baseIndex(days, days[12], '10:00')], days[11], 'during the session the previous close is the base');});

test('price reaction windows, excess return and sessions not yet closed', () => {
  const stock = series(100, 1), index = series(1000, 5);
  const reaction = priceReaction({ date: days[12], time: '14:00' }, days, stock, index);
  assert.equal(reaction.baseDate, days[12]);
  assert.equal(reaction.stock.pre10, Math.round((112 / 102 - 1) * 10000) / 100);
  assert.equal(reaction.stock.day1, Math.round((113 / 112 - 1) * 10000) / 100);
  assert.equal(reaction.index.post10, Math.round((1110 / 1060 - 1) * 10000) / 100);
  assert.equal(reaction.excess.post5, Math.round((reaction.stock.post5 - reaction.index.post5) * 100) / 100);
  assert.equal(reaction.series.length, 21); assert.equal(reaction.series[10].stock, 0); assert.equal(reaction.eventDate, days[12]);

  const late = priceReaction({ date: days[20], time: '14:00' }, days, stock, index);
  assert.notEqual(late.stock.post5, undefined);
  assert.equal(late.stock.post5, null, 'five sessions after the base have not closed');
  assert.equal(late.excess.post5, null);
  assert.equal(late.stock.day1, Math.round((121 / 120 - 1) * 10000) / 100);

  const future = priceReaction({ date: '2026-10-30', time: '14:00' }, days, stock, index);
  assert.equal(future.baseDate, null, 'a conference after the last known session has no base yet'); assert.deepEqual(future.stock, {});

  const missing = priceReaction({ date: days[12], time: '14:00' }, days, new Map(), index);
  assert.deepEqual(missing.stock, {}); assert.deepEqual(missing.series, []);
});

test('the list covers this month and next month', () => {
  assert.deepEqual(monthsAround('2026-10-21'), [[2026, 10], [2026, 11]]);
  assert.deepEqual(monthsAround('2026-12-30'), [[2026, 12], [2027, 1]]);
});
