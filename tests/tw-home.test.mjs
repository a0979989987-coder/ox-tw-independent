import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculate,parseReport,parseWeights,taipeiClock,tradingDates} from '../server/markets/tw/home-close.js';
import {parseMarket,parseTreasury,retainMarket,collectBriefing,MARKETS} from '../server/markets/tw/home-markets.js';
import {parseNight,collectNight} from '../server/markets/tw/home-night.js';
import {collectCore,refreshHomeSection,getHomeSection} from '../server/markets/tw/home-provider.js';
import {validCloseReport,validBriefing,validNight,acceptHomeSection,withOfficialTaiwanClose} from '../src/markets/tw/home-model.js';
import {coreContent,briefingContent} from '../src/markets/tw/home-content.js';
const seed=JSON.parse(await readFile(new URL('../data/tw-home.json',import.meta.url),'utf8'));
const weights={date:'2026-09-18',rows:Array.from({length:12},(_,i)=>({rank:i+1,code:String(2000+i),name:'Stock '+i,weight:i===0?.3:.01}))};
const report=(date,indexClose,indexChange,price)=>({date,indexClose,indexChange,stocks:new Map(weights.rows.map(w=>[w.code,{name:w.name,close:price}]))});
test('morning Taiwan index uses the verified prior cash close without admitting report-day or invalid data',()=>{
 const next=new Date(seed.core.date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
 const briefing={...seed.briefing,date:next.toISOString().slice(0,10),rows:seed.briefing.rows.map(r=>r.group==='asia'?{...r,marketDate:seed.core.previousDate,quoteKind:'previous-close'}:r)};
 const aligned=withOfficialTaiwanClose(briefing,seed.core),tw=aligned.rows.find(r=>r.id==='^TWII');
 assert.equal(tw.marketDate,seed.core.date);assert.equal(tw.value,seed.core.index.close);assert.equal(tw.changePct,seed.core.index.changePct);assert.equal(tw.source,'臺灣證券交易所');assert(validBriefing(aligned));
 const sameDay={...briefing,date:seed.core.date};assert.equal(withOfficialTaiwanClose(sameDay,seed.core),sameDay);
 assert.equal(withOfficialTaiwanClose(briefing,{...seed.core,stocks:[]}),briefing);
 assert.equal(withOfficialTaiwanClose(briefing,null),briefing);
 const html=briefingContent({...seed,briefing:aligned},false);assert(html.includes('收盤 '+seed.core.date));assert(html.includes('盤前報告 '+briefing.date));assert(html.includes('最近可得完整收盤'));
});
test('contribution preserves the source formula, completeness, weight vintage and exact sums',()=>{
 const prior=report('2026-09-18',23000,0,100),current=report('2026-09-21',23126.35,126.35,100);
 current.stocks.get('2000').close=101;current.stocks.get('2001').close=98;
 const r=calculate(current.date,prior.date,current,prior,weights);assert.equal(r.stocks[0].points,69);assert(Math.abs(r.totals.net-64.4)<1e-9);assert(validCloseReport(r));
 assert(!validCloseReport({...r,totals:{...r.totals,net:999}}));assert(!validCloseReport({...r,stocks:r.stocks.slice(1)}));
 current.stocks.delete('2011');assert.throws(()=>calculate(current.date,prior.date,current,prior,weights),/缺少/);
 assert.throws(()=>parseReport({stat:'OK',date:'20260918',tables:[]},'2026-09-21'),/尚未發布/);
 assert.throws(()=>parseWeights('<html>maintenance</html>'),/不完整/);
 assert(validCloseReport(seed.core));assert(validBriefing(seed.briefing));assert(validNight(seed.night));
});
test('Asia ignores report-day intraday quotes, walks holiday gaps and compares two prior closes',()=>{
 const raw={chart:{result:[{meta:{symbol:'TEST',regularMarketTime:345600,regularMarketPrice:999,exchangeTimezoneName:'UTC',chartPreviousClose:80},timestamp:[0,86400,345600],indicators:{quote:[{close:[90,100,999]}]}}]}};
 const asia=parseMarket(raw,'TEST',345601,'1970-01-05');assert.equal(asia.value,100);assert.equal(asia.marketDate,'1970-01-02');assert.equal(asia.comparisonDate,'1970-01-01');assert.equal(asia.quoteKind,'previous-close');assert.equal(asia.quotedAt,null);
 const current=parseMarket(raw,'TEST',345601);assert.equal(current.previousClose,100);assert.throws(()=>parseMarket(raw,'WRONG',345601),/代號/);
 raw.chart.result[0].meta.fulldayPrice=999;raw.chart.result[0].meta.fulldayChange=2;assert.equal(parseMarket(raw,'TEST',345601).change,2);
 assert.equal(MARKETS.length,20);assert.equal(new Set(MARKETS.map(m=>m[2])).size,20);
});
test('USD/JPY accepts the source canonical alias only with JPY currency and rejects reversed or unrelated symbols',()=>{
 const meta={symbol:'USDJPY=X',currency:'JPY',exchangeTimezoneName:'UTC',regularMarketTime:86400,regularMarketPrice:158};
 const raw={chart:{result:[{meta,timestamp:[0,86400],indicators:{quote:[{close:[157,158]}]}}]}};
 assert.equal(parseMarket(raw,'JPY=X',86401).value,158);
 assert.throws(()=>parseMarket(raw,'EURUSD=X',86401),/代號/);
 meta.currency='USD';assert.throws(()=>parseMarket(raw,'JPY=X',86401),/代號/);
 meta.symbol='JPYUSD=X';meta.currency='JPY';assert.throws(()=>parseMarket(raw,'JPY=X',86401),/代號/);
});
const nightHtml=(session='2026/09/30',date='2026/10/01')=>`<input name="queryDate" value="${date}"><p>${session} 15:00~次日05:00 盤後交易時段行情表</p><table>`+[
 ['TX','202610/202611',...Array(13).fill('1')],['TX','202610W1',...Array(13).fill('1')],['TX','202611','48000','48600','47900','48430','▼-64','▼-0.13%','210',...Array(6).fill('-')],['TX','202610','48320','48592','48158','48298','▼-32','▼-0.07%','28717',...Array(6).fill('-')]
 ].map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
test('night excludes weekly/spread/day sessions, accepts only actually completed night and keeps attribution separate',()=>{
 const now=new Date('2026-10-01T06:00:00+08:00'),r=parseNight(nightHtml(),'2026-10-01',now);
 assert.equal(r.contract,'202610');assert.equal(r.close,48298);assert.equal(r.change,-32);assert.equal(r.tradeDate,'2026-10-01');assert.equal(r.sessionStart,'2026-09-30T15:00:00+08:00');assert.equal(r.sessionEnd,'2026-10-01T05:00:00+08:00');
 assert.throws(()=>parseNight(nightHtml().replace('盤後交易時段行情表','一般交易時段行情表'),'2026-10-01',now),/夜盤/);
 assert.throws(()=>parseNight(nightHtml(),'2026-10-02',now),/歸屬日/);
 assert.throws(()=>parseNight(nightHtml(),'2026-10-01',new Date('2026-10-01T04:59:00+08:00')),/尚未結束/);
 assert(!validNight({...r,collectedAt:now.toISOString(),close:Infinity},now.getTime()));
});
test('night walks holidays and a full upstream failure retains the previous completed session',async()=>{
 let calls=0;const now=new Date('2026-10-02T14:00:00+08:00');
 const r=await collectNight(seed.night,now,async()=>({text:async()=>++calls===1?'holiday':nightHtml()}));assert.equal(calls,2);assert.equal(r.tradeDate,'2026-10-01');
 const failed=await collectNight(seed.night,now,async()=>{throw Error('offline');});assert.equal(failed.status,'stale');assert.equal(failed.close,seed.night.close);assert.equal(failed.collectedAt,seed.night.collectedAt);assert(failed.checkedAt);
});
test('yields are percentages with bp changes, future dates excluded, unavailable is null and stale Asia stays bounded',()=>{
 const xml='<feed xmlns:d="d" xmlns:m="m"><entry><content><m:properties><d:NEW_DATE>2026-09-30T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.88</d:BC_2YEAR><d:BC_10YEAR>5.29</d:BC_10YEAR></m:properties></content></entry><entry><content><m:properties><d:NEW_DATE>2026-10-01T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.90</d:BC_2YEAR><d:BC_10YEAR>5.31</d:BC_10YEAR></m:properties></content></entry></feed>';
 const rows=parseTreasury(xml,'2026-09-30');assert.equal(rows.length,1);assert.equal(rows[0].two,4.88);
 const unavailable={id:'asia',group:'asia',value:null,change:null,changePct:null,status:'unavailable',error:'offline'};
 assert.equal(retainMarket(unavailable,{value:100,marketDate:'2026-10-01',quoteKind:'previous-close'},'2026-10-01').value,null);
 assert.equal(retainMarket(unavailable,{value:100,marketDate:'2026-09-30',quoteKind:'previous-close'},'2026-10-01').status,'stale');
});
test('close gate uses Taipei time, never selects intraday, and source empty first month falls back one month',async()=>{
 assert.equal(taipeiClock(new Date('2026-09-21T05:29:00Z')).minutes,809);
 let chosen;
 await collectCore(seed.core,new Date('2026-10-01T05:29:00Z'),{tradingDates:async()=>['2026-09-29','2026-09-30','2026-10-01'],collect:async(date,prior)=>{chosen=[date,prior];return seed.core;}});assert.deepEqual(chosen,['2026-09-30','2026-09-29']);
 const native=global.fetch,urls=[];global.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>url.includes('20261001')?{stat:'很抱歉，沒有符合條件的資料!'}:{stat:'OK',data:[['115/09/29'],['115/09/30']]}};};
 try{assert.deepEqual(await tradingDates('2026-10-01'),['2026-09-29','2026-09-30']);assert.equal(urls.length,2);}finally{global.fetch=native;}
});
test('manual refresh bypasses cache and fetches sources even before publication; failure keeps valid data and acquisition time',async()=>{
 let count=0;const collectors={core:async()=>{count++;return seed.core;},briefing:async()=>{count++;return seed.briefing;}};
 // Keep this pre-publication scenario independent of daily seed refreshes.
 const now=new Date(seed.core.date+'T03:00:00Z');
 do{now.setUTCDate(now.getUTCDate()+1);}while(taipeiClock(now).weekend);
 const a=await getHomeSection('core',{refresh:true,now,collectors});assert.equal(count,1);assert(a.refreshed);assert.equal(a.publication,'pending');
 const b=await getHomeSection('core',{now,collectors});assert.equal(count,1);assert.equal(b.refreshed,false);
 await getHomeSection('core',{refresh:true,now,collectors});assert.equal(count,2);
 const fresh={...seed.briefing,date:taipeiClock(now).date,collectedAt:now.toISOString()};
 const morning=await refreshHomeSection('briefing',seed.briefing,now,{briefing:async()=>{count++;return fresh;}});assert.equal(count,3);assert.equal(morning.data,fresh);assert.equal(morning.publication,'published');assert.equal(morning.data.date,taipeiClock(now).date);
 const failure=await refreshHomeSection('core',seed.core,now,{core:async()=>{throw Error('offline');}});assert.equal(failure.status,'stale');assert.equal(failure.data.savedAt,seed.core.savedAt);assert.equal(failure.error,'offline');
});
test('05:30 Taipei briefing publishes new data independently of the cash close gate and preserves partial sources',async()=>{
 const next=new Date(seed.briefing.date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);
 const date=next.toISOString().slice(0,10),now=new Date(date+'T05:30:00+08:00');
 const fresh={...seed.briefing,date,collectedAt:now.toISOString()};
 const morning=await refreshHomeSection('briefing',seed.briefing,now,{briefing:async()=>fresh});assert.equal(morning.data,fresh);assert.equal(morning.publication,'published');
 const partial={...fresh,complete:false,rows:fresh.rows.map((r,i)=>i===0?{...r,status:'stale',error:'upstream timeout'}:r)};
 const degraded=await refreshHomeSection('briefing',seed.briefing,now,{briefing:async()=>partial});assert.equal(degraded.data,partial);assert.equal(degraded.status,'stale');assert(degraded.error);
 const failure=await refreshHomeSection('briefing',seed.briefing,now,{briefing:async()=>{throw Error('offline');}});assert.equal(failure.data,seed.briefing);assert.equal(failure.status,'stale');
 const collector=await readFile(new URL('../scripts/collect-tw-home.mjs',import.meta.url),'utf8');assert.doesNotMatch(collector,/clock.minutes<810/);
});
test('briefing accepts quotes acquired after collection starts, while rejecting timestamps beyond receipt',async()=>{
 const start=new Date('2026-10-02T05:30:00+08:00'),received=new Date(start.getTime()+30000);
 const read=async url=>({json:async()=>{
  const id=decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
  const stamp=Math.floor(start.getTime()/1000)+(id==='^VIX'?31:20);
  return {chart:{result:[{meta:{symbol:id,regularMarketTime:stamp,regularMarketPrice:110,previousClose:100,exchangeTimezoneName:'UTC'},timestamp:[stamp-3*86400,stamp-2*86400,stamp],indicators:{quote:[{close:[90,100,110]}]}}]}};
 },text:async()=>'<feed/>'});
 const r=await collectBriefing(null,start,read,()=>received),fx=r.rows.find(row=>row.id==='JPY=X'),future=r.rows.find(row=>row.id==='^VIX');
 assert.equal(fx.status,'ok');assert.equal(fx.value,110);assert.equal(fx.collectedAt,received.toISOString());assert.equal(future.status,'unavailable');assert.match(future.error,/時間超出/);
});
test('home renders only one actual change field, estimates, independent dates, native market groups and bp/units',()=>{
 const html=coreContent(seed,false)+briefingContent(seed,false);
 assert(!html.includes('當日加權指數實際漲跌'));assert.equal((html.match(/今日大盤漲跌/g)||[]).length,1);assert(html.includes('十二大權值股淨貢獻'));assert(html.includes('估算'));assert(html.includes('上漲貢獻合計'));assert(html.includes('下跌拖累合計'));assert(!html.includes('<iframe'));
 assert(html.includes('台指期盤後／夜盤'));assert(!html.includes('交易歸屬日'));assert(!html.includes('資料取得'));assert(!html.includes('TX 近月'));assert(!html.includes('Yahoo Finance'));assert(html.includes('USD/桶'));assert(html.includes(' bp'));
 const blank=coreContent({},false);assert(!blank.includes('0.00'));assert(blank.includes('—'));
 assert.throws(()=>acceptHomeSection('briefing',{...seed.briefing,rows:seed.briefing.rows.map(row=>row.group==='asia'?{...row,marketDate:seed.briefing.date}:row)}),/驗證/);
});

test('browser manual refresh makes three uncached API acquisitions, preserves newer same-day data and failure state',async()=>{
 const nativeFetch=global.fetch,nativeStorage=global.localStorage,requests=[];
 const recent={...seed.core,savedAt:new Date().toISOString()},stored={...seed,core:recent,coreStatus:{checkedAt:recent.savedAt,status:'ok'}};
 global.localStorage={getItem:()=>JSON.stringify(stored),setItem:()=>{}};
 let fail=false;
 global.fetch=async input=>{const url=String(input);requests.push(url);if(url.includes('data/tw-home.json'))return {ok:true,json:async()=>seed};
  if(fail)return {ok:false};const section=new URL(url,'https://test.invalid').searchParams.get('section');
  return {ok:true,json:async()=>({data:{section,data:seed[section],checkedAt:new Date().toISOString(),status:'ok',refreshed:url.includes('refresh=1')}})};
 };
 try{
  const {twProvider}=await import('../src/markets/tw/api.js?v=20261005-recovery20');twProvider.configure({apiBase:'https://test.invalid/api'});
  const {loadHome,savedHome}=await import('../src/markets/tw/home-data.js?test-cache');
  await loadHome();assert.equal(savedHome().core.savedAt,recent.savedAt);
  requests.length=0;const progress=[];await loadHome({force:true,onChange:(_,count)=>count&&progress.push(count.done)});assert.deepEqual(progress,[1,2,3]);assert.equal(requests.length,4);assert(requests.filter(url=>!url.includes('data/tw-home.json')).every(url=>url.includes('refresh=1&t=')));assert.equal(savedHome().core.savedAt,recent.savedAt);
  fail=true;await loadHome({force:true});assert.equal(savedHome().core.savedAt,recent.savedAt);assert.equal(savedHome().coreStatus.status,'stale');assert(savedHome().coreStatus.checkedAt);assert(savedHome().coreStatus.error);
 }finally{global.fetch=nativeFetch;global.localStorage=nativeStorage;}
});
