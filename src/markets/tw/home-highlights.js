import {escape,number,pct,money,direction} from './research-ui.js';
import {taipeiTime} from './home-content.js';
import {buildPremarketBriefing,buildAftermarketBriefing,homeBriefingInput} from './briefing-formatter.js?v=20261005-briefingdate';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const signed=(n,digits=2)=>finite(n)?`${n>0?'+':''}${number(n,digits)}`:'—';
const sourceLink=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const entry=(title,text,{date,source,url,stale=false,tone='flat'}={})=>({title,text,date,source,url,stale,tone});

// Summaries use the same verified snapshots as the homepage. Missing values
// stay missing, and estimates are labelled at the point where they are shown.
export function homeHighlights(home,phase='after',research=null){
 const entries=[],before=phase==='before';
 if(before){
  const n=home.night;
  if(n?.status!=='unavailable'&&finite(n?.close))entries.push(entry('台指期夜盤',`收盤 ${number(n.close)} 點，${signed(n.change)} 點（${pct(n.changePct)}）；最高 ${number(n.high)}、最低 ${number(n.low)}，成交 ${number(n.volume,0)} 口。`,{date:n.tradeDate||n.sessionEnd?.slice(0,10),source:n.source,url:n.sourceUrl,stale:n.status==='stale'||Boolean(home.nightStatus?.error),tone:direction(n.change)}));
  for(const group of ['us','indicators','commodities','fx','yields','asia']){
   const rows=(home.briefing?.rows||[]).filter(r=>r.group===group&&finite(r.value));
   if(!rows.length)continue;
   const names={us:'美股收盤',indicators:'風險指標',commodities:'商品行情',fx:'匯率與美元',yields:'美債殖利率',asia:'亞洲前一交易日'};
   entries.push(entry(names[group],rows.map(r=>`${r.name} ${number(r.value,r.decimals??2)}${r.unit?' '+r.unit:''}（${r.group==='yields'?signed(r.change)+' bp':pct(r.changePct)}）`).join('；')+'。',{
    date:[...new Set(rows.map(r=>r.marketDate).filter(Boolean))].join('／'),source:rows[0].source,url:rows[0].sourceUrl,stale:rows.some(r=>r.status==='stale')
   }));
  }
 }else{
  const r=home.core;
  if(r?.index&&finite(r.index.close)){
   entries.push(entry('台股收盤',`加權收盤 ${number(r.index.close)} 點，${signed(r.index.change)} 點（${pct(r.index.changePct)}）。`,{date:r.date,source:'臺灣證券交易所',url:'https://www.twse.com.tw/zh/trading/historical/mi-index.html',tone:direction(r.index.change),stale:Boolean(home.coreStatus?.error)}));
   const stocks=(r.stocks||[]).filter(s=>finite(s.points)),up=[...stocks].sort((a,b)=>b.points-a.points).filter(s=>s.points>0).slice(0,3),down=[...stocks].sort((a,b)=>a.points-b.points).filter(s=>s.points<0).slice(0,3);
   entries.push(entry('權值股貢獻',`十二大權值股合計 ${signed(r.totals?.net)} 點（估算）。${up.length?'主要推升：'+up.map(s=>s.name+' '+signed(s.points)+' 點').join('、')+'。':''}${down.length?'主要拖累：'+down.map(s=>s.name+' '+signed(s.points)+' 點').join('、')+'。':''}`,{date:r.date,source:'公開收盤與公布權重；貢獻為估算'}));
   const institutions=r.institutional;
   if(finite(institutions?.total))entries.push(entry('三大法人',`上市＋上櫃合計${institutions.total>=0?'淨買超':'淨賣超'} ${money(Math.abs(institutions.total)).replace(/^\+/,'')}；上市 ${money(institutions.markets?.TWSE?.total)}，上櫃 ${money(institutions.markets?.TPEX?.total)}。`,{date:institutions.date,source:'TWSE／TPEx 官方彙總',tone:direction(institutions.total),stale:['TWSE','TPEX'].some(k=>institutions.markets?.[k]?.status==='stale')}));
  }
  if(research?.date&&research.date===r?.date){
   const sectors=(research.sectors||[]).filter(s=>finite(s.flow)),buys=[...sectors].sort((a,b)=>b.flow-a.flow).filter(s=>s.flow>0).slice(0,3),sells=[...sectors].sort((a,b)=>a.flow-b.flow).filter(s=>s.flow<0).slice(0,3);
   if(sectors.length)entries.push(entry('法人產業動向',`${buys.length?'買超集中：'+buys.map(s=>s.name+' '+money(s.flow)).join('、')+'。':''}${sells.length?'賣超集中：'+sells.map(s=>s.name+' '+money(s.flow)).join('、')+'。':''}`,{date:research.date,source:'官方股數 × 收盤價（估算）'}));
  }
 }
 const input=homeBriefingInput(home,phase,research),summary=before?buildPremarketBriefing(input):buildAftermarketBriefing(input);
 return {title:before?'盤前重點':'盤後重點',date:before?home.briefing?.date:home.core?.date,updated:before?home.briefing?.collectedAt:home.core?.savedAt,entries,summary};
}
export function highlightsContent(home,phase,research){
 const report=homeHighlights(home,phase,research);
 const brief=report.summary,summary=`<article class="twx-highlight twx-highlight-summary"><h3>【${escape(brief.title)}】</h3><p>${escape(brief.text||'尚無可核對的摘要資料，請查看下方來源狀態。')}</p><footer><span>${escape(brief.date||'—')}</span><small>${escape(brief.basis)}</small></footer></article>`;
 const rows=report.entries.map(item=>`<article class="twx-highlight"><h3 class="${item.tone}">${escape(item.title)}</h3><p>${escape(item.text)}</p><footer><span>${escape(item.date||'日期待公布')}${item.stale?' · 上次有效資料':''}</span>${sourceLink(item.url)?`<a href="${escape(sourceLink(item.url))}" target="_blank" rel="noopener noreferrer">${escape(item.source||'資料來源')} ↗</a>`:`<small>${escape(item.source||'')}</small>`}</footer></article>`).join('');
 return `<div class="twx-highlights-meta"><span>${escape(report.date||'等待資料')}</span><small>更新 ${escape(taipeiTime(report.updated))}</small></div>${summary}${rows||'<div class="twx-empty">資料尚未取得，更新後會整理重點。</div>'}`;
}
