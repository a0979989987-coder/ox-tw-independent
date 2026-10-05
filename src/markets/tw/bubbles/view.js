import { mountBubbles } from '../../../components/bubbles/view.js?v=20261005-stable18';
import { savedResearch, loadResearch, readWatchlist, subscribeResearch } from '../research-data.js?v=20261001-twhome1';
import { bundleEntry, bundleState, subscribeBundle, preloadBundle } from '../patterns/bundle.js?v=20261005-load16';
import { TW_BUBBLE_METRICS, twBubbleRows, twBubbleText } from './model.js?v=20261001-twbubbles1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shares=n=>Number.isFinite(n)?`${(n/1000).toLocaleString('zh-TW',{maximumFractionDigits:1})} 張`:'—';
const amount=n=>Number.isFinite(n)?`${(n/1e8).toLocaleString('zh-TW',{maximumFractionDigits:2})} 億`:'—';
export function mountTWBubbles(host,{onOpenRadar}={}){
 host.dataset.bubbleMarket='tw';let snapshot=savedResearch(),busy=false,error='',changed=()=>{},life,target,loading;
 const entryFor=(symbol,date)=>{const entry=bundleEntry(symbol,'1D',date);if(entry)return entry;const b=bundleState(),row=b.unavailable.find(r=>r.symbol===symbol);return b.date===date&&row?.candles?{data:{dataDate:date,candles:row.candles}}:null;};
 const adapter={metrics:TW_BUBBLE_METRICS,format:twBubbleText,palette:{up:'#f16a70',down:'#48b78e'},watching:readWatchlist,
  rows(options){const b=bundleState();return twBubbleRows(snapshot,{...options,entryFor,dates:b.dates||[]});},
  empty(node,{metric,scope,direction}){
   const text=scope==='watch'&&!readWatchlist().size?'先在台股雷達收藏股票，這裡會顯示你的自選':busy?'股票資料載入中':!snapshot?error||'尚無台股官方資料':metric==='volumeTrend'?'目前沒有符合成交量三日連增的股票':metric==='volume'?'此資料日尚無可驗證的成交股數':metric==='institution'?'目前沒有符合條件的法人買賣超資料':`目前沒有符合${direction==='long'?'看多':direction==='short'?'看空':'篩選'}條件的股票`;
   if(busy&&globalThis.OXLoading)OXLoading.render(node,text);else if(node.textContent!==text)node.textContent=text;
  },
  detail(r){return `<strong class="oxb-price">${r.price.toLocaleString('zh-TW',{maximumFractionDigits:2})}<small> TWD</small></strong><dl><div><dt>當日漲跌</dt><dd class="${r.change>=0?'up':'down'}">${twBubbleText(r.change,'change')}</dd></div><div><dt>成交量</dt><dd>${shares(r.volume)}</dd></div><div><dt>三大法人淨買賣超</dt><dd class="${r.netShares>=0?'up':'down'}">${twBubbleText(r.netShares===null?null:r.netShares/1000,'institution')}</dd></div>${[["外資",r.foreignTwd],["投信",r.trustTwd],["自營商",r.dealerTwd]].map(([label,n])=>`<div><dt>${label}</dt><dd>${shares(Number.isFinite(n)?Math.round(n/r.price):null)}</dd></div>`).join('')}<div><dt>成交額</dt><dd>${amount(r.turnoverTwd)} TWD</dd></div>${r.volumeBars?.map(b=>`<div><dt>${esc(b.date)} 成交量</dt><dd>${shares(b.volume)}</dd></div>`).join('')||''}</dl><small class="oxb-note">資料日 ${esc(r.dataDate)} · ${esc(r.market)} · ${esc(r.industry)}<br>官方日資料；法人買賣超為股數統計。三日連增需最近三個交易日各自高於前一日。</small>`;},
  start({onChange,signal,target:node}){changed=onChange;life=signal;target=node;
   const stop=subscribeBundle(b=>{loading?.update(b.classified+b.failed,b.expected||b.total);if(!signal.aborted)changed();});
   const stopResearch=subscribeResearch(data=>{if(!signal.aborted){snapshot=data;changed();}});
   refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},300000);return ()=>{clearInterval(timer);stop();stopResearch();loading?.finish();};
  },refresh
 };
 async function refresh(){if(busy||life?.aborted)return;busy=true;error='';const b=bundleState();loading=globalThis.OXLoading?.begin('tw','載入股票',{target,signal:life,views:['strength'],done:b.classified,total:b.expected||b.total});changed();
  const result=await Promise.allSettled([loadResearch({onCached(data){if(!life.aborted){snapshot=data;changed();}}}),preloadBundle()]);
  if(!life.aborted){if(result[0].status==='fulfilled'){snapshot=result[0].value.data;error=result[0].value.error||'';}else error='台股資料暫時無法更新';busy=false;changed();}
  loading?.finish();loading=null;
 }
 return mountBubbles(host,{adapter,onOpenRadar});
}
