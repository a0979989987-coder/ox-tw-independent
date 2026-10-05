import { revealStyledShadow } from '../../../components/style-ready.js?v=20261005-stable18';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
export const signed=(n,d=2)=>Number.isFinite(n)?(n>0?'+':'')+fmt(n,d):'—';
export const color=n=>n>0?'up':n<0?'down':'neutral';
export const pct=n=>Number.isFinite(n)?signed(n)+'%':'—';
export const money=n=>Number.isFinite(n)?n>=1e8?fmt(n/1e8,2)+' 億':n>=1e4?fmt(n/1e4,1)+' 萬':fmt(n,0):'—';
export const amount=n=>Number.isFinite(n)?'NT$ '+fmt(n,0):'—';
export const iconSearch='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.8"/><path d="m16 16 5 5"/></svg>';
export function shell(host,title){
  const node=document.createElement('div');host.append(node);const shadow=node.attachShadow({mode:'open'}), life=new AbortController();
  shadow.innerHTML=`<link rel="stylesheet" href="${new URL('./style.css?v=20261005-spacing6',import.meta.url)}"><main aria-label="${esc(title)}" data-style-pending="true" inert style="visibility:hidden!important"><div class="loading" role="status">正在載入 ${esc(title)}…</div></main>`;
  node.style.setProperty('--ox-light-up','#ce3c4d');node.style.setProperty('--ox-light-down','#168366');
  revealStyledShadow(shadow,life.signal,'main',360);
  return {node,shadow,life,main:shadow.querySelector('main'),destroy(){life.abort();node.remove();}};
}
export function tabs(items,selected,attr='data-tab'){return `<div class="tabs" role="tablist">${items.map(([id,name])=>`<button type="button" role="tab" aria-selected="${id===selected}" ${attr}="${id}" class="${id===selected?'active':''}">${esc(name)}</button>`).join('')}</div>`;}
export function sourceNote(catalog){const dates=[...new Set(catalog?.rows?.map(r=>r.date).filter(Boolean))].sort();const acquired=catalog?.snapshot&&catalog.acquiredAt?new Date(catalog.acquiredAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):null;return `<span>${esc(catalog?.snapshot?'已發布資料快照':catalog?.stale?'上次有效資料':catalog?.partial?'部分來源待更新':'官方收盤')} · ${dates.join(' / ')||'日期待公布'}${acquired?' · 取得 '+esc(acquired):''}</span>`;}
export function selector(rows,value,name,label){return `<label>${esc(label)}<select name="${name}">${rows.filter(r=>name==='a'||name==='b'||r.currency==='TWD').map(r=>`<option value="${r.symbol}" ${value===r.symbol?'selected':''}>${r.symbol} ${esc(r.name)}</option>`).join('')}</select></label>`;}
export function input(name,label,value,{min=0,max=1e10,step=1,suffix=''}={}){return `<label>${esc(label)}<span class="input-unit"><input required name="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" inputmode="decimal">${suffix?`<span>${esc(suffix)}</span>`:''}</span></label>`;}
export function chart(points,{label='資產試算',unit='歲',marker=null}={}){
  if(!points.length)return '';
  const w=typeof matchMedia==='function'&&matchMedia('(max-width:760px)').matches?360:760,h=230,pad=34,max=Math.max(1,...points.map(p=>p.value)), x=i=>pad+i*(w-2*pad)/Math.max(1,points.length-1), y=v=>h-pad-v/max*(h-2*pad);
  const path=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' '), ticks=[0,Math.floor((points.length-1)/2),points.length-1];
  const mi=marker==null?-1:points.findIndex(p=>p.x===marker);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${[.25,.5,.75,1].map(r=>`<line class="grid" x1="${pad}" y1="${y(max*r)}" x2="${w-pad}" y2="${y(max*r)}"/><text x="${pad+4}" y="${y(max*r)-5}">${money(max*r)}</text>`).join('')}<path d="${path} L${x(points.length-1)} ${h-pad} L${pad} ${h-pad} Z" fill="#afbabc20"/><path d="${path}" fill="none" stroke="#e5e9e8" stroke-width="2.5"/>${mi>=0?`<line x1="${x(mi)}" x2="${x(mi)}" y1="${pad}" y2="${h-pad}" stroke="#c9b786" stroke-dasharray="4 5"/><text x="${x(mi)+4}" y="${h-pad-8}">退休</text>`:''}${ticks.map(i=>`<text x="${x(i)}" y="${h-10}" text-anchor="middle">${points[i].x}${esc(unit)}</text>`).join('')}</svg>`;
}
export const palette=['#e1e4df','#9dacad','#c6b88e','#7a8b94','#6e7f72','#a398a8','#565e65','#3d454b'];
export function donut(sectors,title){
  let sum=0;const groups=sectors.length>7?[...sectors.slice(0,6),{name:'其餘產業',weight:sectors.slice(6).reduce((s,r)=>s+r.weight,0)}]:sectors;
  const slices=groups.map((s,i)=>{const start=sum;sum+=s.weight;return `${palette[i%palette.length]} ${start}% ${sum}%`;}).join(',');
  return `<div class="donut-block"><div class="donut" role="img" aria-label="${esc(title)}：${esc(groups.map(s=>s.name+' '+fmt(s.weight)+'%').join('、'))}" style="background:conic-gradient(${slices||'#363b40 0% 100%'})"><span>${esc(title)}</span></div><div class="legend">${groups.map((s,i)=>`<div><i style="background:${palette[i%palette.length]}"></i><span>${esc(s.name)}</span><b>${fmt(s.weight)}%</b></div>`).join('')}</div></div>`;
}
