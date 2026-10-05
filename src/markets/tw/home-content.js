import {escape,number,direction} from './research-ui.js';
import {HOME_GROUPS} from './home-model.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const signed=(n,digits=2)=>finite(n)?(n>0?'+':'')+number(n,digits):'—';
const pct=n=>finite(n)?signed(n)+'%':'—';
export const taipeiTime=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
const statusText=(state,loading)=>loading?'正在取得資料，已載入內容保留':state?.error?`更新未完成：${state.error}${state.message?' · '+state.message:''}`:state?.message||'';
export function coreContent(home,loading){
 const r=home.core,state=home.coreStatus;
 return `<section class="twx-glass twx-market twx-core" aria-label="台股收盤與權值股貢獻"><div class="twx-core-head"><small>收盤日 ${escape(r?.date||'—')} · 台北時間</small></div><div class="twx-core-metrics"><div><small>加權指數收盤點數</small><strong>${number(r?.index?.close)}</strong><small>前收 ${number(r?.index?.previousClose)} · ${escape(r?.previousDate||'—')}</small></div><div><small>今日大盤漲跌</small><strong class="${direction(r?.index?.change)}">${signed(r?.index?.change)} <em>點</em></strong><span class="${direction(r?.index?.change)}">${pct(r?.index?.changePct)}</span></div><div><small>十二大權值股淨貢獻 <span class="twx-estimate">估算</span></small><strong class="${direction(r?.totals?.net)}">${signed(r?.totals?.net)} <em>點</em></strong><small>權重日期 ${escape(r?.weightDate||'—')}</small></div></div><div class="twx-contribution-totals"><div><small>上漲貢獻合計</small><b class="up">${signed(r?.totals?.positive)} 點</b></div><div><small>下跌拖累合計</small><b class="down">${signed(r?.totals?.negative)} 點</b></div></div>${state?.error?'<div class="twx-home-status" role="status">更新未完成，保留上次有效資料</div>':''}${r?`<details class="twx-contribution-detail"><summary>十二大權值股貢獻明細</summary><p>前一交易日加權收盤 × 公布權重 × 個股收盤漲跌幅（估算）</p><div class="twx-contribution-list">${r.stocks.map(s=>`<div><button type="button" data-stock="${escape(s.code)}">${escape(s.name)} <small>${escape(s.code)}</small></button><small>權重 ${number(s.weight*100,4)}%</small><b class="${direction(s.points)}">${signed(s.points)} 點</b></div>`).join('')}</div></details>`:''}</section>`;
}
function marketRow(row,report){
 const change=row.group==='yields'?(finite(row.change)?`${signed(row.change)} bp`:'—'):pct(row.changePct);
 const value=finite(row.value)?number(row.value,row.decimals??2)+(row.unit==='%'?'%':row.unit?' '+row.unit:''):'—';
 const state=row.status==='stale'?' · 上次有效資料':row.status==='unavailable'?' · 尚未公布／來源無資料':'';
 return `<div class="twx-briefing-row" data-market-row="${escape(row.id)}"><div class="twx-briefing-name"><b>${escape(row.name)}</b>${state?`<small>${escape(state.replace(/^ · /,''))}</small>`:''}</div><div class="twx-briefing-value"><strong>${escape(value)}</strong><span class="${direction(row.group==='yields'?row.change:row.changePct)}">${escape(change)}</span></div></div>`;
}
function nightContent(home,loading){
 const r=home.night,state=home.nightStatus,available=r&&r.status!=='unavailable'&&finite(r.close);
 return `<section class="twx-glass twx-night" aria-label="台指期盤後夜盤"><div class="twx-section-head"><span>台指期盤後／夜盤</span></div><div class="twx-night-close"><div><small>最近已完成夜盤收盤</small><strong>${number(available?r.close:null)} <em>點</em></strong></div><div class="${direction(available?r.change:null)}"><b>${signed(available?r.change:null)} 點</b><span>${pct(available?r.changePct:null)}</span></div></div><div class="twx-night-metrics"><div><small>最高</small><b>${number(available?r.high:null)}</b></div><div><small>最低</small><b>${number(available?r.low:null)}</b></div><div><small>成交量</small><b>${number(available?r.volume:null,0)} 口</b></div></div>${state?.error||r?.status==='stale'||!available?`<div class="twx-home-status" role="status">${escape(!available?'夜盤尚未公布':'來源更新失敗，保留上次已完成夜盤')}</div>`:''}</section>`;
}
export function briefingContent(home,loading){
 const report=home.briefing,state=home.briefingStatus;
 return `<section class="twx-briefing" aria-label="盤前市場資訊">${state?.error?'<div class="twx-home-status" role="status">部分來源未更新，保留上次有效資料</div>':''}<div class="twx-briefing-grid">${nightContent(home,loading)}${HOME_GROUPS.map(([group,name])=>`<section class="twx-glass twx-market-group" aria-label="${name}"><div class="twx-section-head"><span>${name}</span>${group==='asia'?'<small>報告日前一交易日收盤</small>':group==='yields'?'<small>殖利率 % · 變動 bp</small>':''}</div>${(report?.rows||[]).filter(row=>row.group===group).map(row=>marketRow(row,report)).join('')||'<div class="twx-muted">尚未公布</div>'}</section>`).join('')}</div></section>`;
}

export function institutionContent(home){
 const r=home.core?.institutional,markets=r?.markets||{};
 const parts=[['上市＋上櫃',r?.total],['上市',markets.TWSE?.total],['上櫃',markets.TPEX?.total]];
 const cell=(label,value)=>`<div><small>${label}</small><b class="${direction(value)}">${signed(finite(value)?value/1e8:null)}</b></div>`;
 const details=['TWSE','TPEX'].map(key=>`<div class="twx-institution-market"><b>${key==='TWSE'?'上市':'上櫃'}</b>${[['外資',markets[key]?.foreign],['投信',markets[key]?.trust],['自營',markets[key]?.dealer]].map(([name,value])=>cell(name,value)).join('')}</div>`).join('');
 return '<section class="twx-glass twx-institution" aria-label="三大法人市場買賣超"><div class="twx-section-head"><span>三大法人買賣超</span><small title="官方有價證券彙總，包含 ETF、ETN 與權證；與個股收盤價估算法不同">官方彙總 · 億元</small></div><div class="twx-institution-metrics">'+parts.map(([name,value],i)=>'<div><small>'+name+'</small><strong class="'+(i===0?'flat':direction(value))+'">'+signed(finite(value)?value/1e8:null)+'</strong></div>').join('')+'</div><div class="twx-institution-details">'+details+'</div>'+(Object.values(markets).some(m=>m.status==='stale')?'<small class="twx-home-status">上次有效資料</small>':'')+'</section>';
}
