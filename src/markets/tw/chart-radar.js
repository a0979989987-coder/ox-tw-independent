import { evaluateClassic, compareClassic } from '../../core/classic.js?v=20261002-rank8';
import { classicTWRow } from './classic.js?v=20261002-rank8';
import {patternFrameTier} from './timeframe-tiers.js?v=20261002-rank8';
import {FRAME_LABELS} from './patterns/model.js';
import { rankChartRows, chartUniverse } from './chart-radar-model.js?v=20261002-radarkeep1';
import { escapeTW as esc } from './radar-card.js';
import { savedResearch } from './research-data.js?v=20261001-twhome1';
import { bundleState, bundleEntry, bundleClassification, subscribeBundle, preloadBundle, awaitBundleSymbol } from './patterns/bundle.js?v=20261005-load16';
import { fetchSeries } from './patterns/source.js?v=20261002-rank8';
import { CHART_FRAMES, aggregateChartCandles, stockDetails, chartTickFormatter } from './chart-data.js?v=20261001-loading1';
import { radarPart, attachRadarStyles } from '../../components/radar/market-workspace.js';
import { chartHistory, loadHistoryPage, preserveHistoryViewport, mergeDailyHistory } from './chart-history.js?v=20261001-tiercomb1';
const UP='#f16a70',DOWN='#48b78e';
const num=n=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
const change=n=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'—';
const money=n=>Number.isFinite(n)?`${(n/1e8).toFixed(2)} 億`:'—';
const viewports=new Map();
const glyph=type=>`<svg viewBox="0 0 24 24" aria-hidden="true">${({search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7M12 3v9"/>',fire:'<path d="M13 3c1 5-4 6-3 10 2-1 3-3 3-3 4 3 5 5 4 8-1 3-7 4-10 0-3-5 2-8 6-15Z"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',fold:'<path d="m15 6-6 6 6 6M3 3v18"/>'})[type]}</svg>`;
export function mountTWChartRadar(host,{state:marketState,watchlist=new Set()}={}) {
 const life=new AbortController(),$=s=>host.querySelector(s),listen=(el,type,fn,options={})=>el?.addEventListener(type,fn,{...options,signal:life.signal});
 let tab='all',tier='all',side='long',query='',symbol='',frame='1D',focus=false,folded=false,serial=0,controller=null,drawings,gestures,holdTimer,held=false,levelLines=[],classicSeries=[];
 const state={symbol:'',period:frame,candleData:[],chart:null,candleSeries:null,chartPriceViewport:null};
 let historyRecord=null,historyJob=null,fitAll=true;
 host.innerHTML='<div class="tw-chart-radar"></div>';
 const surface=$('.tw-chart-radar');
 const summary=radarPart('.compact-summary');
 summary.querySelectorAll('.radar-analysis-cell').forEach(n=>n.remove());
 summary.classList.add('twcr-quote');
 summary.querySelector('[id$="-ticker-pair"]').removeAttribute('role');
 summary.querySelector('[id$="-ticker-pair"]').removeAttribute('aria-label');
 const nameNode=summary.querySelector('[id$="-ticker-pair"]');nameNode.dataset.quoteName='';nameNode.textContent='選擇股票';
 nameNode.removeAttribute('tabindex');nameNode.removeAttribute('data-provider-bound');
 // Discard the cloned Crypto picker, including any runtime-injected control.
 summary.querySelector('.market-line-price').querySelectorAll('button').forEach(n=>n.remove());
 summary.querySelector('.market-line-price').insertAdjacentHTML('beforeend','<button class="twcr-search-open" type="button" data-action="search" aria-label="搜尋股票" aria-haspopup="dialog" aria-expanded="false">'+glyph('search')+'</button>');
 summary.querySelector('[id$="-price"]').dataset.quotePrice='';
 summary.querySelector('[id$="-change"]').dataset.quoteChange='';
 summary.querySelector('[id$="-change"]').classList.remove('positive','negative');
 summary.querySelector('[id$="-btc-rel"]').textContent='官方日行情 · 非即時';
 summary.querySelector('[id$="-change"]').previousElementSibling.textContent='日漲跌幅';
 summary.querySelector('[id$="-quote"]').dataset.quoteTurnover='';
 summary.querySelector('[id$="-quote-rank"]').textContent='成交額（新台幣）';
 summary.querySelector('[id$="-quote"]').previousElementSibling.textContent='日成交額';
 const dateNode=summary.querySelector('[id$="-ticker-meta"]'),date=document.createElement('div');date.id=dateNode.id;date.className='twcr-date';dateNode.replaceWith(date);
 const workspace=radarPart('.workspace');
 workspace.classList.add('twcr-workspace');
 const chartBox=workspace.querySelector('.chart-box');
 chartBox.classList.add('twcr-chart-box');
 chartBox.querySelectorAll(':scope > :not(.chart-controls)').forEach(n=>n.remove());
 const controls=chartBox.querySelector('.chart-controls');
 const strip=controls.querySelector('.chart-timeframe-strip');
 strip.innerHTML=Object.keys(CHART_FRAMES).map(f=>`<button class="btn-tf ${f===frame?'active':''}" type="button" data-twcr-frame="${f}" aria-pressed="${f===frame}">${CHART_FRAMES[f]}${f==='1Q'?'<span class="tf-hint">▾</span>':''}</button>`).join('')+'<span class="tf-glass-indicator" aria-hidden="true"></span>';
 controls.querySelector('[id$="-indicator-open"]').dataset.action='indicators';
 controls.querySelector('[id$="-scanner-toggle"]').dataset.action='fold';
 controls.querySelector('[id$="-fullscreen"]').dataset.action='focus';
 chartBox.insertAdjacentHTML('beforeend','<div id="tw-radar-chart" class="chart-container" aria-label="台股 K 線圖"><div class="twcr-status chart-loading-overlay" role="status"></div></div><button type="button" class="twcr-exit chart-tool-icon" data-action="exit" aria-label="退出全螢幕" hidden>'+glyph('close')+'</button>');
 const scanner=workspace.querySelector('aside');
 scanner.classList.add('twcr-scanner');
 scanner.querySelectorAll(':scope > :not(.scanner-tabs)').forEach(n=>n.remove());
 scanner.querySelector('.scanner-tabs').classList.add('twcr-tabs');
 for(const b of scanner.querySelectorAll('[data-tab]')){b.dataset.twcrTab=b.dataset.tab;delete b.dataset.tab;}
 scanner.querySelector('.radar-tier-current').dataset.tierLabel='';
 scanner.querySelector('[id$="-badge-surge"]').dataset.surgeCount='';
 scanner.querySelector('[id$="-badge-watch"]').dataset.watchCount='';
 scanner.querySelector('[data-twcr-tab="surge"]').setAttribute('aria-label','當日成交額前 50 名');
 scanner.querySelector('[data-twcr-tab="watch"]').setAttribute('aria-label','自選股票');
 const direction=scanner.querySelector('[id$="-direction-toggle"]');
 direction.dataset.action='side';
 direction.setAttribute('aria-label','切換當日上漲或下跌股票池');
 scanner.insertAdjacentHTML('beforeend','<div class="twcr-pool-info"></div><div class="twcr-classification-note" role="status" hidden></div><div id="tw-radar-screener-list" class="twcr-results" role="list"></div>');
 const details=radarPart('#ox-detail-panel');
 details.classList.add('twcr-details');details.setAttribute('aria-label','目前股票資訊');
 details.querySelector('.panel-title').innerHTML='OX 股票詳情 · <span data-details-title></span>';
 details.querySelector('.pill').dataset.detailsMarket='';
 details.querySelector('.detail-grid').dataset.details='';details.querySelector('.detail-grid').replaceChildren();
 details.querySelector('.detail-reasons').innerHTML='<h4>行情資訊</h4><div class="detail-reason" data-details-source></div><div class="detail-reason twcr-series-note" data-series-note></div><div class="detail-reason" data-details-risk></div><div class="detail-reason" data-history-status role="status"></div><button type="button" class="twcr-history-retry" data-action="history-retry" hidden>重試歷史資料</button>';
 details.querySelector('.alert-state-row').innerHTML='<span class="alert-chip" data-details-date></span><span class="alert-chip">官方日行情 · 非即時</span><span class="alert-chip">資訊板為當日行情；K 線依上方所選級別顯示</span>';
 chartBox.after(details);
 surface.append(summary,workspace);
 surface.insertAdjacentHTML('beforeend',`<div class="twcr-tier-menu" role="menu" hidden>${['all','T1','T2','T3'].map(t=>`<button type="button" role="menuitemradio" data-twcr-tier="${t}" aria-checked="${t===tier}">${t==='all'?'全部':t}</button>`).join('')}</div>
 <dialog class="chart-tools-overlay twcr-tools" aria-label="台股圖表設定" aria-hidden="true"><section class="chart-tools-dialog" role="dialog" aria-modal="true" aria-label="台股圖表設定" tabindex="-1">
 <div class="chart-tools-panel" data-tw-panel="indicators"><h3>指標</h3><div class="chart-indicator-options"><label class="chart-indicator-option"><input type="checkbox" data-volume checked><span>成交量</span></label><label class="chart-indicator-option"><input type="checkbox" data-levels><span>觸發／目標／結構失效</span></label></div><div class="chart-tier-filter" data-tw-tier-filter></div><button class="chart-tools-save" data-action="reset">重設圖表縮放</button><button class="chart-tools-save" data-action="native-fullscreen">全螢幕圖表</button></div>
 <div class="chart-tools-panel" data-tw-panel="timeframes" hidden><div class="chart-timeframe-preferences">${Object.keys(CHART_FRAMES).map(f=>`<label><input type="checkbox" value="${f}" checked><span>${CHART_FRAMES[f]}</span></label>`).join('')}</div><button class="chart-tools-save" data-action="frames-save">儲存時間級別</button></div><button class="chart-tools-close" data-action="tools-close" aria-label="關閉圖表設定">${glyph('close')}</button></section></dialog>
 <dialog class="twcr-search-dialog" aria-label="搜尋台股股票"><header><strong>搜尋股票</strong><button type="button" data-action="search-close" aria-label="關閉股票搜尋">${glyph('close')}</button></header><input type="search" placeholder="股票名稱或代號" aria-label="搜尋台股圖表標的" autocomplete="off"><div class="twcr-search-results" aria-label="股票搜尋結果"></div><small data-search-count role="status"></small></dialog>`);
 const releaseStyles=attachRadarStyles(surface,{summaryColumns:3});
 $('.twcr-tier-menu').id='tw-radar-radar-tier-menu';
 const root=$('.tw-chart-radar'),box=$('.chart-box'),el=$('#tw-radar-chart');
 const scannerSize=new ResizeObserver(()=>{$('.twcr-scanner').style.height=`${el.clientHeight+box.querySelector('.chart-controls').offsetHeight+2}px`;marker();});scannerSize.observe(el);scannerSize.observe(controls);
 const snapshot=()=>{const b=bundleState();return [{date:b.date,stocks:b.stocks},savedResearch(),{date:marketState?.data?.radarDataDate,stocks:marketState?.data?.radar}].filter(r=>r?.date&&r.stocks?.length).sort((a,b)=>b.date.localeCompare(a.date))[0];};
 const universe=()=>chartUniverse(marketState,snapshot());
 function latestDaily(row){
  const liveDate=row?.dataDate||marketState?.data?.radarDataDate,indexed=bundleEntry(row?.symbol,'1D',bundleState().date)?.data;
  const live=liveDate?mergeDailyHistory([],[{...row?.currentCandle,date:liveDate,volume:row?.volume,turnoverTwd:row?.turnoverTwd}],liveDate):[];
  if(live.at(-1)?.date===liveDate&&(!indexed?.dataDate||liveDate>=indexed.dataDate))return {asOf:liveDate,daily:live};
  return indexed?{asOf:indexed.dataDate,daily:indexed.candles}:null;
 }
 function status(message){const node=$('.twcr-status');if(/載入中|正在載入/.test(message)&&window.OXLoading)OXLoading.render(node,message,0,1);else node.textContent=message;node.classList.toggle('show',!!message);}
 const tierFilters=window.OXTierFilters?.mount($('[data-tw-tier-filter]'),{market:'tw',frames:Object.entries(FRAME_LABELS).map(([id,label])=>({id,label})),signal:life.signal});
 listen(document,'ox:timeframe-tier-change',event=>{if(event.detail.market==='tw'){renderList();preloadBundle().catch(()=>{});}});
 const cardNodes=new Map();
 function renderSearch(){
  const value=$('.twcr-search-dialog input').value.trim().toLowerCase(),stocks=universe().filter(r=>`${r.symbol} ${r.name}`.toLowerCase().includes(value)),rows=stocks.slice(0,60);
  $('.twcr-search-results').innerHTML=rows.map(r=>`<button type="button" data-search-symbol="${esc(r.symbol)}"><span><b>${esc(r.symbol)}</b> ${esc(r.name)}</span><small>${num(r.price)}</small></button>`).join('')||'<p>沒有符合的股票</p>';
  $('[data-search-count]').textContent=stocks.length>60?`符合 ${stocks.length} 檔，請輸入更多文字縮小範圍`:`符合 ${stocks.length} 檔`;
 }
 function closeSearch(){const dialog=$('.twcr-search-dialog');if(!dialog.open)return;dialog.close();$('[data-action="search"]').setAttribute('aria-expanded','false');}
 function renderQuote(){
  const row=universe().find(r=>r.symbol===symbol);$('[data-quote-name]').textContent=`${symbol} ${row?.name||''}`;$('[data-quote-name]').title=`${symbol} ${row?.name||''}`;$('[data-quote-price]').textContent=num(row?.price);$('[data-quote-change]').textContent=change(row?.changePct);$('[data-quote-change]').style.color=row?.changePct>=0?UP:DOWN;$('[data-quote-turnover]').textContent=money(row?.turnoverTwd);
  $('[data-details-title]').textContent=`${symbol} ${row?.name||''}`;
  const asOf=snapshot()?.date,latest=bundleEntry(symbol,'1D',asOf)?.data?.candles?.at(-1),candle={...row?.currentCandle};
  if(latest?.date===asOf)for(const key of ['open','high','low','volume'])if(!Number.isFinite(candle[key]))candle[key]=latest[key];
  const facts=stockDetails({...row,currentCandle:candle},asOf);
  facts.splice(2,0,['日漲跌幅',change(row?.changePct)],['日成交額',money(row?.turnoverTwd)]);
  $('[data-details]').innerHTML=facts.map(([label,value])=>`<div class="detail-cell"><label>${esc(label)}</label><strong title="${esc(value)}">${esc(value)}</strong></div>`).join('');
  $('[data-details-market]').textContent=facts[0][1];
  $('[data-details-source]').textContent=`行情來源：${row?.market==='TPEX'?'櫃買中心':row?.market==='TWSE'?'臺灣證券交易所':'官方日行情'} · 金額為新台幣，成交量為股數`;
  $('[data-details-risk]').textContent=`處置／注意：${facts.find(([label])=>label==='處置／注意')[1]} · 雷達級別 ${row?.tier||'—'}`;
  $('[data-details-date]').textContent=`資料日：${asOf||'—'}`;
 }
 function renderList(){
  if(life.signal.aborted)return;
  const config=window.OXTierFilters?.get('tw'),indexed=bundleState(),classificationDate=indexed.date;
  const candidateStocks=chartUniverse(marketState,{date:classificationDate,stocks:indexed.stocks},{asOf:classificationDate});
  const stocks=candidateStocks.map(r=>classicTWRow(r,bundleClassification(r.symbol,'1D',classificationDate),classificationDate));
  const pool=config?.enabled?stocks.flatMap(row=>{const match=window.OXTierFilters.resolve(row,config,(r,f)=>patternFrameTier(bundleClassification(r.symbol,f,classificationDate),side));return match?[{...row,...match.value,sourceTier:row.tier,tier:match.tier,filterFrame:match.frame}]:[];}):stocks;
  const rows=rankChartRows(tab==='all'?pool:universe(),{tab,tier,side,watchlist,query,strictTier:config?.enabled});
  $('[data-tier-label]').textContent=tier==='all'?'':tier;
  host.querySelectorAll('[data-twcr-tab]').forEach(b=>{const selected=b.dataset.twcrTab===tab;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));});
  host.querySelectorAll('[data-twcr-tier]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.twcrTier===tier)));
  $('[data-surge-count]').textContent=rankChartRows(universe(),{tab:'surge'}).length;
  $('[data-watch-count]').textContent=watchlist.size;
  const direction=$('[data-action="side"]');
  direction.classList.toggle('is-long',side==='long');direction.classList.toggle('is-short',side==='short');
  direction.querySelector('.direction-toggle-icon').textContent=side==='long'?'↑':'↓';
  direction.setAttribute('aria-pressed',String(side==='short'));
  direction.setAttribute('aria-checked',String(side==='short'));
  direction.title=side==='long'?'OX 經典多頭候選':'OX 經典空頭候選';
  $('.twcr-pool-info').textContent=tab==='all'?`OX 經典${side==='long'?'多頭':'空頭'} · ${rows.length} 檔`:tab==='surge'?`當日成交額前 ${rows.length} 檔`:`自選 ${rows.length} 檔`;
  const note=$('.twcr-classification-note'),quoteDate=snapshot()?.date;
  note.hidden=tab!=='all'||!classificationDate||!quoteDate||classificationDate===quoteDate;
  note.textContent=note.hidden?'':`候選分類 ${classificationDate} · 最新行情 ${quoteDate}；新分類公布後自動更新。`;
  $('.twcr-date').textContent=snapshot()?.date?`資料日 ${snapshot().date}`:'官方資料載入中';
  if(symbol)renderQuote();if($('.twcr-search-dialog').open)renderSearch();
  const list=$('.twcr-results'),top=list.scrollTop,wanted=new Set(rows.map(r=>r.symbol));
  list.querySelector('.twcr-empty')?.remove();
  for(const child of [...list.children])if(!wanted.has(child.dataset.stock))child.remove();
  rows.forEach((r,i)=>{
   const starButton=type=>`<button type="button" class="watch-star ${type} twcr-star ${watchlist.has(r.symbol)?'is-starred saved':''}" data-favorite="${r.symbol}" aria-pressed="${watchlist.has(r.symbol)}" aria-label="${watchlist.has(r.symbol)?'移除':'加入'} ${esc(r.name)} 自選">${glyph('star')}</button>`;
   let card=cardNodes.get(r.symbol);
   if(!card){card=document.createElement('article');card.className='coin-card twcr-card';card.dataset.stock=r.symbol;card.dataset.symbol=r.symbol;card.setAttribute('role','button');card.tabIndex=0;cardNodes.set(r.symbol,card);}
   const starts=tab==='all'&&rows[i-1]?.displayTier!==r.displayTier,ends=tab==='all'&&rows[i+1]?.displayTier!==r.displayTier;
   card.classList.toggle('is-tier-start',starts);card.classList.toggle('is-tier-end',ends);card.classList.toggle('selected',r.symbol===symbol);
   card.setAttribute('aria-label',`開啟 ${r.symbol} ${r.name} 圖表`);card.setAttribute('aria-pressed',String(r.symbol===symbol));
   const html=`${starts?'<span class="coin-tier-heading">'+esc(r.displayTier)+'</span>':''}
    <div class="coin-top"><span class="coin-title"><span class="coin-symbol-full">${esc(r.symbol)} ${esc(r.name)}</span><span class="coin-symbol-mobile" title="${esc(r.symbol+' '+r.name)}">${esc(r.symbol)} <span class="twcr-name">${esc(r.name)}</span></span></span><span class="coin-top-right"><span class="twcr-card-price">${num(r.price)}</span>${starButton('watch-star-desktop')}</span></div>
    <div class="coin-mid"><span class="coin-status twcr-card-turnover"><span>成交額</span> <span>${money(r.turnoverTwd)}</span></span><span class="coin-change desktop-coin-change twcr-desktop-change" style="color:${r.changePct>=0?UP:DOWN}">${change(r.changePct)}</span></div>
    <div class="coin-mobile-bottom">${starButton('watch-star-mobile')}<span class="coin-change" style="color:${r.changePct>=0?UP:DOWN}">${change(r.changePct)}</span></div>
    ${tab==='all'?'<small class="twcr-card-rank">'+esc(r.filterFrame||'1D')+' · '+esc(r.stage)+'</small>':''}`;
   if(card._markup!==html){card.innerHTML=html;card._markup=html;}
   if(list.children[i]!==card)list.insertBefore(card,list.children[i]||null);
  });
  if(!rows.length){const empty=document.createElement('div');empty.className='twcr-empty';empty.textContent=tab==='all'&&(!classificationDate||indexed.loading)&&!indexed.classified?'型態分類資料載入中…':config?.enabled?'目前沒有符合時間組合的股票；未完成分類的級別不列入':marketState?.status==='loading'?'官方雷達資料載入中…':marketState?.status==='error'?'雷達請求失敗，尚無可用候選資料':tab==='watch'?'尚未收藏股票，點選星星加入自選':'目前沒有符合條件的股票';list.append(empty);}
  list.scrollTop=top;
 }
 function refreshRange(){state.candleSeries?.applyOptions({autoscaleInfoProvider:provider});}
 function provider(original){const info=original();return state.chartPriceViewport?{...info,priceRange:state.chartPriceViewport,margins:{above:0,below:0}}:info;}
 function getRange(){const h=el.clientHeight-state.chart.timeScale().height(),maxValue=state.candleSeries.coordinateToPrice(0),minValue=state.candleSeries.coordinateToPrice(h-1);return Number.isFinite(maxValue)&&maxValue>minValue?{minValue,maxValue}:null;}
 function setRange(range){const margins=state.chart.priceScale('right').options().scaleMargins,h=el.clientHeight-state.chart.timeScale().height(),span=range.maxValue-range.minValue;state.chartPriceViewport={minValue:range.minValue+span*h*margins.bottom/(h-1),maxValue:range.maxValue-span*h*margins.top/(h-1)};refreshRange();}
 function syncChartTheme(){
  const light=document.body.classList.contains('theme-light');
  state.chart?.applyOptions({layout:{background:{color:light?'#ffffff':'#101216'},textColor:light?'#616d7c':'#a9abb1'},grid:{horzLines:{color:light?'#94a3b81a':'#ffffff12'}},timeScale:{borderColor:light?'#d7dee7':'#ffffff1a'},rightPriceScale:{borderColor:light?'#d7dee7':'#ffffff1a'},crosshair:{vertLine:{labelBackgroundColor:light?'#8d712e':'#4c525e'},horzLine:{labelBackgroundColor:light?'#8d712e':'#4c525e'}}});
  if(state.candleData.length)levels();
  const up=light?'#d34260':UP,down=light?'#16876a':DOWN;
  state.candleSeries?.applyOptions({upColor:up,downColor:down,borderUpColor:up,borderDownColor:down,wickUpColor:up,wickDownColor:down});
 }
 listen(document,'ox:themechange',syncChartTheme);
 function ensureChart(){
  if(state.chart)return true;
  const lib=window.LightweightCharts;if(!lib){$('.twcr-status').textContent='圖表元件載入中，請稍後重試';return false;}
  state.chart=lib.createChart(el,{autoSize:true,layout:{background:{color:'#101216'},textColor:'#a9abb1',fontSize:10},grid:{vertLines:{visible:false},horzLines:{color:'#ffffff12'}},rightPriceScale:{visible:true,autoScale:true,scaleMargins:matchMedia('(max-width:720px)').matches?{top:.08,bottom:.14}:{top:.15,bottom:.2}},leftPriceScale:{visible:false},timeScale:{timeVisible:false,rightOffset:matchMedia('(max-width:720px)').matches?2:5,borderColor:'#ffffff1a'},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:false,vertTouchDrag:false},handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:false},localization:{locale:'zh-TW'},crosshair:{mode:0}});
  state.candleSeries=state.chart.addCandlestickSeries({upColor:UP,downColor:DOWN,borderUpColor:UP,borderDownColor:DOWN,wickUpColor:UP,wickDownColor:DOWN,autoscaleInfoProvider:provider});
  state.volumeSeries=state.chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});state.chart.priceScale('volume').applyOptions({scaleMargins:{top:matchMedia('(max-width:720px)').matches ? .88 : .85,bottom:0},visible:false});
  gestures=window.OXChartGestures?.({container:el,state,formatPrice:num,getRange,setRange,refreshRange,isDrawing:()=>el.querySelector('.chart-drawing-layer.is-editing')});
  drawings=window.OXChartDrawings?.({box,chartEl:el,state,market:'tw',isExpanded:()=>focus});syncChartTheme();return true;
 }
 function levels(){
  for(const line of levelLines)state.candleSeries?.removePriceLine(line);levelLines=[];
  for(const line of classicSeries)state.chart?.removeSeries(line);classicSeries=[];
  if(!$('[data-levels]').checked||!state.candleData.length)return;
  const signals=['long','short'].map(side=>evaluateClassic(state.candleData,{side,frame}));
  const signal=signals.filter(s=>s.eligible).sort(compareClassic)[0]||signals[side==='short'?1:0];
  for(const [title,level,darkColor]of [['觸發',signal.pressure,'#eee7df'],['下一目標',signal.target,'#f7bd52'],['結構失效',signal.invalidation,'#5ca5ff']]){
   if(!level)continue;
   const color=document.body.classList.contains('theme-light')?({'#eee7df':'#8d712e','#f7bd52':'#8d712e','#5ca5ff':'#4598df'}[darkColor]||darkColor):darkColor;
   if(level.kind==='diagonal'){
    const line=state.chart.addLineSeries({color,lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:()=>null});
    line.setData(level.points.map(p=>({time:p.time,value:p.price})));classicSeries.push(line);
   }else levelLines.push(state.candleSeries.createPriceLine({title,price:level.level,color,lineStyle:2,lineWidth:1,axisLabelVisible:true}));
  }
 }

 function renderHistory(initial=false){
  const record=historyRecord;if(!record)return;
  const previous=state.candleData,range=state.chart.timeScale().getVisibleLogicalRange(),candles=aggregateChartCandles(record.daily,frame,record.asOf,{coverageStart:record.coverageStart});
  state.candleData=candles;state.candleSeries.setData(candles);state.volumeSeries.setData(candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#f16a7035':'#48b78e35'})));
  if(fitAll||initial){
   if(matchMedia('(max-width:720px)').matches&&candles.length){const count=Math.max(36,Math.min(72,Math.floor(el.clientWidth/5)));state.chart.timeScale().setVisibleLogicalRange({from:Math.max(-1,candles.length-count),to:candles.length+3});}
   else state.chart.timeScale().fitContent();
  }else if(range)state.chart.timeScale().setVisibleLogicalRange(preserveHistoryViewport(previous,candles,range));
  refreshRange();levels();drawings?.sync();
  const span=candles.length?`${candles[0].date} ～ ${candles.at(-1).lastDate||candles.at(-1).date}`:'尚無已完成 K 線';
  $('[data-series-note]').textContent=`${CHART_FRAMES[frame]} K · ${candles.length} 根${frame==='1D'?'':'已完成 K 線'} · ${span} · 未復權`;
  $('[data-history-status]').textContent=record.error?'歷史載入暫停，已載入資料保留':record.complete?'官方可取得歷史已全部載入':`正在補載歷史 · 已查至 ${record.coverageStart}`;
  $('[data-history-status]').title=record.error?.message||'';
  $('[data-action="history-retry"]').hidden=!record.error;
  status(candles.length?'':record.complete?'官方來源沒有此級別的已完成 K 線':'正在載入更早的官方 K 線');
 }
 async function fillHistory(){
  const run=serial,record=historyRecord,signal=controller.signal;if(!record||record.complete)return;
  if(historyJob?.run===run)return historyJob.promise;
  const promise=(async()=>{try{while(!record.complete){await loadHistoryPage(record,signal);if(run!==serial||life.signal.aborted)return;renderHistory();}}
   catch(error){if(run===serial&&!life.signal.aborted&&error.name!=='AbortError')renderHistory();}
   finally{if(historyJob?.run===run)historyJob=null;}
  })();historyJob={run,promise};return promise;
 }
 async function openSymbol(next){
  if(!/^\d{4}$/.test(next)||life.signal.aborted)return;
  if(next===state.symbol&&frame===state.period&&state.candleData.length){renderList();return;}
  if(state.candleData.length){const logical=state.chart.timeScale().getVisibleLogicalRange(),anchor=Math.min(state.candleData.length-1,Math.max(0,Math.floor(logical?.from||0)));viewports.set(`${state.symbol}:${state.period}`,{logical,anchorTime:state.candleData[anchor].time,anchorIndex:anchor,price:state.chartPriceViewport});}
  symbol=next;state.symbol=next;state.period=frame;state.chartPriceViewport=null;const run=++serial;controller?.abort();controller=new AbortController();historyRecord=null;historyJob=null;fitAll=true;
  renderQuote();$('[data-series-note]').textContent='';
  $('[data-history-status]').textContent='歷史 K 線載入中';$('[data-action="history-retry"]').hidden=true;
  status('官方 K 線載入中');renderList();if(!ensureChart())return;
  state.chart.applyOptions({timeScale:{timeVisible:false,tickMarkFormatter:chartTickFormatter(frame)}});
  state.candleData=[];state.candleSeries.setData([]);state.volumeSeries.setData([]);levels();
  try{status('正在載入股票 K 線');if(!bundleEntry(next,'1D',snapshot()?.date))await awaitBundleSymbol(next,controller.signal).catch(()=>{});if(run!==serial||life.signal.aborted)return;
   status('正在整理股票 K 線');const row=universe().find(r=>r.symbol===next),latest=latestDaily(row),base=bundleEntry(next,'1D',bundleState().date)?.data,asOf=snapshot()?.date;
   const data=base&&latest?.asOf===asOf?{...base,dataDate:asOf,candles:mergeDailyHistory(base.candles,latest.daily,asOf)}:await fetchSeries(next,'1D',controller.signal,asOf,{minimum:1});if(run!==serial||life.signal.aborted)return;
   status('正在開啟歷史 K 線');const record=await chartHistory(next,universe().find(r=>r.symbol===next)?.market,snapshot()?.date,data.candles,controller.signal);if(run!==serial||life.signal.aborted)return;
   historyRecord=record;renderHistory(true);const viewport=viewports.get(`${next}:${frame}`);if(viewport?.logical){fitAll=false;const index=state.candleData.findIndex(c=>c.time===viewport.anchorTime),shift=index<0?0:index-viewport.anchorIndex;state.chart.timeScale().setVisibleLogicalRange({from:viewport.logical.from+shift,to:viewport.logical.to+shift});state.chartPriceViewport=viewport.price;refreshRange();}
   fillHistory();refreshSelectedCandle().catch(()=>{});
  }catch(error){if(run===serial&&!life.signal.aborted&&error.name!=='AbortError'){console.warn('Taiwan chart load failed',error);$('[data-history-status]').title=error.message;status('官方 K 線暫時無法取得，請稍後重試');$('[data-history-status]').textContent='歷史資料暫時無法取得';$('[data-action="history-retry"]').hidden=false;}}
 }
 async function refreshSelectedCandle(){
  const old=historyRecord,run=serial;if(!symbol||!old||life.signal.aborted)return;
  const row=universe().find(r=>r.symbol===symbol),latest=latestDaily(row),asOf=latest?.asOf;
  if(!asOf||asOf<old.asOf)return;
  const daily=mergeDailyHistory([],latest.daily,asOf),last=daily.at(-1),previous=old.daily.at(-1);
  if(last?.date!==asOf||last.date===previous?.date&&['open','high','low','close','volume'].every(k=>last[k]===previous[k]))return;
  const record=await chartHistory(symbol,row?.market,asOf,[...old.daily,...daily],controller.signal);
  if(run!==serial||life.signal.aborted)return;
  if(old.coverageStart<record.coverageStart){record.coverageStart=old.coverageStart;record.cursor=old.cursor;record.complete=old.complete;}
  serial++;controller.abort();controller=new AbortController();historyJob=null;historyRecord=record;
  renderHistory();fillHistory();
 }
 function setFocus(value){focus=value;document.body.classList.toggle('tw-chart-focus',value);root.classList.toggle('is-focused',value);$('[data-action="exit"]').hidden=!value;$('[data-action="focus"]').hidden=value;drawings?.sync();requestAnimationFrame(()=>{if(!life.signal.aborted)state.chart?.resize(el.clientWidth,el.clientHeight);});}
 const all=$('[data-twcr-tab="all"]');const menu=value=>{const m=$('.twcr-tier-menu'),r=all.getBoundingClientRect();m.style.left=`${Math.min(r.left,innerWidth-110)}px`;m.style.top=`${r.bottom+5}px`;m.hidden=!value;all.setAttribute('aria-expanded',String(value));};
 let press=null;
 const cancelHold=()=>{clearTimeout(holdTimer);press=null;};
 listen(all,'pointerdown',event=>{held=false;press={x:event.clientX,y:event.clientY};clearTimeout(holdTimer);holdTimer=setTimeout(()=>{held=true;menu(true);},2000);});
 listen(all,'pointermove',event=>{if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10){held=true;cancelHold();}});
 listen(host,'scroll',cancelHold,{capture:true,passive:true});
 for(const event of ['pointerup','pointercancel','pointerleave'])listen(all,event,()=>clearTimeout(holdTimer));
 listen(all,'dblclick',()=>menu(true));listen(all,'contextmenu',event=>event.preventDefault());
 function marker(){const active=$('[data-twcr-frame][aria-pressed="true"]'),glass=$('.tf-glass-indicator');if(active){glass.style.width=`${active.offsetWidth}px`;glass.style.transform=`translateX(${active.offsetLeft}px)`;$('.chart-timeframe-strip').classList.add('is-ready');}}
 let previousFocus=null;
 function tools(panel){previousFocus=document.activeElement;host.querySelectorAll('[data-tw-panel]').forEach(n=>n.hidden=n.dataset.twPanel!==panel);$('.twcr-tools').dataset.activePanel=panel;if(!$('.twcr-tools').open)$('.twcr-tools').showModal();$('.twcr-tools').classList.add('is-open');$('.twcr-tools').setAttribute('aria-hidden','false');$('.chart-tools-dialog').focus({preventScroll:true});}
 function closeTools(){if($('.twcr-tools').open)$('.twcr-tools').close();$('.twcr-tools').classList.remove('is-open');$('.twcr-tools').setAttribute('aria-hidden','true');previousFocus?.focus({preventScroll:true});}
 listen($('.twcr-tools'),'click',event=>{if(event.target===$('.twcr-tools'))closeTools();});
 listen($('.chart-timeframe-strip'),'scroll',marker,{passive:true});listen(window,'resize',marker,{passive:true});requestAnimationFrame(marker);
 listen(document,'fullscreenchange',()=>{if(!document.fullscreenElement&&focus)setFocus(false);});
 listen(host,'click',event=>{
  if(event.target.closest('.chart-drawing-tools'))return;
  const favorite=event.target.closest('[data-favorite]');
  const card=event.target.closest('[data-stock]');if(card&&!favorite){openSymbol(card.dataset.stock);return;}
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.searchSymbol){closeSearch();openSymbol(b.dataset.searchSymbol);return;}
  if(b.dataset.twcrFrame){if(b.dataset.twcrFrame===frame&&b===host.querySelector('.chart-timeframe-strip [data-twcr-frame]:last-of-type')){tools('timeframes');return;}frame=b.dataset.twcrFrame;host.querySelectorAll('.chart-timeframe-strip [data-twcr-frame]').forEach(n=>{if(n.dataset.twcrFrame===frame)n.hidden=false;n.setAttribute('aria-pressed',String(n.dataset.twcrFrame===frame));n.classList.toggle('active',n.dataset.twcrFrame===frame);});marker();if(symbol)openSymbol(symbol);return;}
  if(b.dataset.twcrTier){tier=b.dataset.twcrTier;tab='all';menu(false);renderList();return;}
  if(b.dataset.twcrTab){if(b.dataset.twcrTab==='all'){if(held){held=false;return;}if(tab==='all'){const options=['all','T1','T2','T3'];tier=options[(options.indexOf(tier)+1)%options.length];}tab='all';}else tab=b.dataset.twcrTab;menu(false);renderList();return;}
  if(b.dataset.symbol){openSymbol(b.dataset.symbol);return;}
  if(b.dataset.favorite){const value=b.dataset.favorite;watchlist.has(value)?watchlist.delete(value):watchlist.add(value);try{localStorage.setItem('ox-tw-independent:ox-tw-radar-watchlist-v1',JSON.stringify([...watchlist]));}catch{}renderList();return;}
  if(b.dataset.action==='history-retry'){if(historyRecord){historyRecord.error=null;historyJob=null;renderHistory();fillHistory();}else if(symbol)openSymbol(symbol);return;}
  switch(b.dataset.action){case 'search':{renderSearch();$('.twcr-search-dialog').showModal();b.setAttribute('aria-expanded','true');$('.twcr-search-dialog input').focus();break;}case 'search-close':closeSearch();break;case 'indicators':tools('indicators');break;case 'tools-close':closeTools();break;case 'frames-save':{const checked=[...host.querySelectorAll('.chart-timeframe-preferences input:checked')].map(n=>n.value);host.querySelectorAll('[data-twcr-frame]').forEach(n=>n.hidden=!checked.includes(n.dataset.twcrFrame)&&n.dataset.twcrFrame!==frame);closeTools();marker();break;}case 'side':side=side==='long'?'short':'long';renderList();break;case 'fold':folded=!folded;root.classList.toggle('is-folded',folded);b.setAttribute('aria-expanded',String(!folded));b.setAttribute('aria-label',folded?'展開候選列表':'收合候選列表');break;case 'focus':setFocus(true);break;case 'native-fullscreen':closeTools();setFocus(true);box.requestFullscreen?.().catch(()=>{});break;case 'exit':if(document.fullscreenElement===box)document.exitFullscreen();setFocus(false);break;case 'reset':state.chartPriceViewport=null;refreshRange();state.chart?.timeScale().fitContent();break;}
 });
 listen($('[data-levels]'),'change',levels);
 listen(el,'pointerdown',()=>{fitAll=false;},{passive:true});listen(el,'wheel',()=>{fitAll=false;},{passive:true});
 listen($('[data-volume]'),'change',event=>state.volumeSeries?.applyOptions({visible:event.target.checked}));
 listen(host,'keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-stock]')){event.preventDefault();openSymbol(event.target.dataset.stock);}if(event.key==='Tab'&&$('.twcr-tools').classList.contains('is-open')){const nodes=[...$('.chart-tools-dialog').querySelectorAll('button,input')].filter(n=>!n.closest('[hidden]'));if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}});
 listen($('.twcr-search-dialog input'),'input',renderSearch);
 listen($('.twcr-search-dialog input'),'keydown',event=>{if(event.key==='Enter'){const first=$('.twcr-search-results button');if(first){closeSearch();openSymbol(first.dataset.searchSymbol);}}});
 listen($('.twcr-search-dialog'),'click',event=>{if(event.target===$('.twcr-search-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSearch();}});
 listen($('.twcr-search-dialog'),'close',()=>{$('[data-action="search"]').setAttribute('aria-expanded','false');$('[data-action="search"]').focus({preventScroll:true});});
 listen(document,'keydown',event=>{if(event.key==='Escape'){if($('.twcr-search-dialog').open){closeSearch();return;}menu(false);closeTools();if(focus)setFocus(false);}});
 listen(document,'ox:tw-close-refresh',()=>{renderList();refreshSelectedCandle().catch(()=>{});});
 const unsubscribe=subscribeBundle(()=>{renderList();if(symbol)refreshSelectedCandle().catch(()=>{});else{const first=rankChartRows(universe(),{side})[0]||universe()[0];if(first)openSymbol(first.symbol);}});
 renderList();const initial=rankChartRows(universe(),{side})[0]||universe()[0];if(initial)openSymbol(initial.symbol);else preloadBundle().catch(()=>{});
 return {openSymbol,update(next){marketState=next;renderList();if(symbol)refreshSelectedCandle().catch(()=>{});else{const first=rankChartRows(universe(),{side})[0]||universe()[0];if(first)openSymbol(first.symbol);}},destroy(){tierFilters?.destroy();life.abort();serial++;controller?.abort();clearTimeout(holdTimer);unsubscribe();scannerSize.disconnect();releaseStyles();document.body.classList.remove('tw-chart-focus');gestures?.destroy();drawings?.destroy();state.chart?.remove();host.textContent='';}};
}
