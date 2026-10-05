import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPremarketBriefing,buildAftermarketBriefing,homeBriefingInput} from '../src/markets/tw/briefing-formatter.js';
import {homeHighlights,highlightsContent} from '../src/markets/tw/home-highlights.js';

const before = {
  date: '2026-10-02', previousSessionDate: '2026-10-01',
  sox: {date:'2026-10-01',changePct:1.58}, adr:{date:'2026-10-01',changePct:0.7},
  us:{date:'2026-10-01',changePct:0.2}, night:{date:'2026-10-02',change:223,close:48475},
  strongSectors:[{date:'2026-10-01',us:'半導體',tw:'半導體',changePct:1.58}],
  foreignShort:{date:'2026-10-01',change:1000}, fx:{date:'2026-10-02',pair:'USD/TWD',changePct:-0.034}
};
test('premarket keeps 50–100 characters, three axes and a measurable final action',()=>{
  const report=buildPremarketBriefing({...before,us:undefined});
  assert.equal(report.complete,true);assert([...report.text].length>=50&&[...report.text].length<=100);
  for(const part of ['費半+1.58%','ADR+0.7%','夜盤+223點收48475','美股半導體','台股半導體','空單增1000口','偏開高'])assert(report.text.includes(part));
  assert.match(report.text,/前15分鐘.*昨同期不追價。$/);
});
test('missing data stays explicit and an index is never invented as a sector ranking',()=>{
  const report=buildPremarketBriefing({date:before.date,sox:before.sox,us:before.us,night:{...before.night,change:-223}});
  assert.equal(report.complete,false);assert(report.missing.includes('台積電 ADR'));
  assert.doesNotMatch(report.text,/待補|待確認|強勢族群|外資空單|偏開/);
  assert(!report.text.includes('半導體強'));assert([...report.text].length<=100);
  const empty=buildPremarketBriefing();assert([...empty.text].length<=100);assert.equal(empty.complete,false);
});
test('stale or after-08:30 evidence cannot support the morning prediction',()=>{
  const report=buildPremarketBriefing({...before,sox:{...before.sox,date:'2026-09-24'},night:{...before.night,date:'2026-10-01'},fx:{...before.fx,quotedAt:'2026-10-02T15:00:00+08:00'},foreignShort:{...before.foreignShort,status:'stale'}});
  assert.doesNotMatch(report.text,/費半|夜盤|空單|偏開|待補|待確認/);assert(!report.text.includes('台幣升'));
  assert(report.missing.includes('08:30 前台幣匯率'));
});
test('long supplied sector names cannot expand the compact morning body beyond 100 characters',()=>{
  const report=buildPremarketBriefing({...before,strongSectors:[{date:'2026-10-01',us:'美國大型科技半導體設計族群',tw:'台灣半導體製造設備產業鏈',changePct:2.12}],foreignShort:{date:'2026-10-01',change:12345}});
  assert([...report.text].length<=100);assert.match(report.text,/昨同期不追價。$/);
  for(const value of [999999,99999999,Number.MAX_SAFE_INTEGER,1e200]){
    const extreme=buildPremarketBriefing({...before,sox:{...before.sox,changePct:value},adr:{...before.adr,changePct:value},night:{...before.night,close:value,change:value},foreignShort:{...before.foreignShort,change:Math.min(value,Number.MAX_SAFE_INTEGER)}});
    assert([...extreme.text].length<=100);assert.match(extreme.text,/昨同期不追價。$/);
  }
});
test('inconsistent US dates, invalid report dates and inverse currency pairs stay unconfirmed',()=>{
  const report=buildPremarketBriefing({...before,adr:{...before.adr,date:'2026-09-30'},fx:{...before.fx,pair:'TWD/USD'}});
  assert.doesNotMatch(report.text,/偏開|待補|待確認/);assert(report.missing.includes('台積電 ADR'));assert(report.missing.includes('08:30 前台幣匯率'));
  assert.equal(buildPremarketBriefing({...before,date:'2026-99-99'}).date,null);
  assert.equal(buildAftermarketBriefing({date:'2026-02-30'}).date,null);
});
test('aftermarket follows index, buys, sells and anomalies order with per-amount estimates',()=>{
  const date='2026-10-02';const report=buildAftermarketBriefing({date,index:{date,changePct:.25},buyTheme:{date,name:'電子'},
    sectors:[{date,name:'半導體',netTwd:3e9,estimated:true},{date,name:'電子零組件',netTwd:2e9,estimated:true},{date,name:'電腦週邊',netTwd:1e9,estimated:true},{date,name:'金融',netTwd:-5e8,estimated:true}],
    buyStrength:{date,baselineTwd:3e9,baselineLabel:'20日均值'},chipAnomalies:{date,count:12,rule:'同日已核對異常清單'},rotation:{date,label:'積極',basis:'買超族群由2個增至5個'}});
  assert.equal(report.complete,true);assert.match(report.text,/大盤\+0.25%。法人主要掃貨電子/);
  assert.match(report.text,/估算30億、估算20億、估算10億/);assert.match(report.text,/金融賣超估算5億/);
  assert.match(report.text,/力道明顯.*20日均值2倍/);
  assert(report.text.indexOf('賣超')>report.text.indexOf('買超'));assert(report.text.indexOf('籌碼異常')>report.text.indexOf('賣超'));assert.match(report.text,/轉向相當積極/);
});
test('aftermarket rejects wrong-date flows and anomaly counts without a stated rule',()=>{
  const date='2026-10-02';const report=buildAftermarketBriefing({date,index:{date,changePct:.25},sectors:[{date:'2026-10-01',name:'過期族群',netTwd:9e9}],chipAnomalies:{date,count:99},rotation:{date,label:'劇烈'}});
  assert(!report.text.includes('過期族群'));assert(!report.text.includes('99'));assert(!report.text.includes('劇烈'));assert.equal(report.complete,false);assert.equal(report.text,'大盤+0.25%。');
});
test('verified zero flows are not presented as missing data',()=>{
  const date='2026-10-02';const report=buildAftermarketBriefing({date,index:{date,changePct:0},sectors:[{date,name:'半導體',netTwd:0,estimated:true}],chipAnomalies:{date,count:0,rule:'已核對異常清單'}});
  assert.match(report.text,/未見淨買超/);assert.match(report.text,/未見淨賣超/);assert.match(report.text,/籌碼異常股數0檔/);assert(!report.missing.includes('當日法人產業買超'));
});
test('a partial source outage keeps same-day verified flows with explicit coverage',()=>{
  const date='2026-10-02';
  const home={core:{date,index:{changePct:.25}},coreStatus:{reportDate:date}};
  const research={date,methodology:'net-shares-times-daily-close-v1',sourceHealth:{TWSE:{ok:true},TPEX:{ok:false,stale:true}},
    sectors:[{name:'半導體',flow:8.2e9},{name:'金融',flow:-1e9}]};
  const report=buildAftermarketBriefing(homeBriefingInput(home,'after',research));
  assert.match(report.text,/已收錄族群中，法人主要掃貨半導體/);
  assert.match(report.text,/估算82億/);assert.match(report.text,/金融賣超估算10億/);
  assert.match(report.basis,/部分來源未更新，採同日已取得資料/);
  assert.equal(report.complete,false);assert(report.missing.includes('部分法人來源待更新'));
  assert(!report.missing.includes('當日法人產業買超'));
  assert.equal(homeBriefingInput(home,'after',{...research,date:'2026-10-01'}).sectors.length,0);
});
test('snapshot adapter uses exact dates and preserves all detailed source cards',()=>{
  const home=JSON.parse(readFileSync(new URL('../data/tw-home.json',import.meta.url),'utf8'));
  const research={date:'1900-01-01',methodology:'net-shares-times-daily-close-v1',sectors:[{name:'錯日族群',flow:1e9}]};
  assert.equal(homeBriefingInput(home,'after',research).sectors.length,0);
  const beforeReport=homeHighlights(home,'before');assert(beforeReport.entries.some(e=>e.title==='台指期夜盤'));assert(beforeReport.summary.missing.includes('外資期貨空單增減'));
  const html=highlightsContent(home,'after',research);assert.match(html,/【AI 盤後總結】/);assert.match(html,/權值股貢獻/);assert(!html.includes('錯日族群'));
});

test('Monday morning uses the completed Friday night belonging to Monday, even if fetched later',()=>{
  const home={briefing:{date:'2026-10-05',rows:[
    {id:'^SOX',marketDate:'2026-10-02',changePct:2.4,status:'ok'},
    {id:'TSM',marketDate:'2026-10-02',changePct:2.95,status:'ok'}
  ]},night:{tradeDate:'2026-10-05',sessionEnd:'2026-10-03T05:00:00+08:00',
    collectedAt:'2026-10-05T13:00:00+08:00',close:49346,change:677,status:'ok'}};
  const report=buildPremarketBriefing(homeBriefingInput(home,'before'));
  assert.match(report.text,/夜盤\+677點收49346/);
  assert.match(report.text,/ADR\+2.95%/);
  assert(!report.missing.includes('當日已完成夜盤'));
  assert.doesNotMatch(highlightsContent(home,'before'),/待補|缺項：/);
  assert(homeHighlights(home,'before').entries.some(e=>e.title==='台指期夜盤'&&e.date==='2026-10-05'));
  // A night still trading at 08:30 cannot be used as a completed close.
  const unfinished={...home,night:{...home.night,sessionEnd:'2026-10-06T05:00:00+08:00'}};
  assert(!buildPremarketBriefing(homeBriefingInput(unfinished,'before')).text.includes('夜盤'));
});

test('aftermarket uses the actual completed session, not the next acquisition date',()=>{
  const home={core:{date:'2026-10-02',index:{changePct:.25}},coreStatus:{reportDate:'2026-10-05'}};
  const research={date:'2026-10-02',methodology:'net-shares-times-daily-close-v1',sectors:[
    {name:'電子零組件業',flow:24e9},{name:'電腦週邊業',flow:-11e9}
  ]};
  const report=buildAftermarketBriefing(homeBriefingInput(home,'after',research));
  assert.equal(report.date,'2026-10-02');
  assert.match(report.text,/大盤\+0.25%。法人主要掃貨電子零組件業/);
  assert.match(report.text,/電腦週邊業賣超估算110億/);
  assert.doesNotMatch(highlightsContent(home,'after',research),/待補|缺項：/);
  const wrong=homeBriefingInput(home,'after',{...research,date:'2026-10-01'});
  assert.equal(wrong.sectors.length,0);
});
