import { classifyTWSeries } from '../classic.js?v=20261002-rank8';
import { qualifyClassicRow, compareClassic, rankClassicTiers } from '../../../core/classic.js?v=20261002-rank8';
import { preloadBundle, awaitBundleManifest, subscribeBundle, bundleEntry, bundleEntries, bundleState } from './bundle.js?v=20261005-load16';
import { twProvider } from '../api.js?v=20261005-recovery20';
import { createTWMarketState } from '../engine.js?v=20261005-recovery20';
import { savedResearch, loadResearch } from '../research-data.js?v=20261001-twhome1';
import { TIMEFRAMES, selectUniverse, dailyCandles } from './model.js';
import { aggregateChartCandles } from '../chart-data.js?v=20261001-loading1';
export { TIMEFRAMES };
export const detailStamp = row => `${row.frame!=='1D'?'已完成合併 K · 截至':'資料日'} ${row.candles.at(-1).lastDate || row.candles.at(-1).date}`;
export const id = 'tw', label = '台股 · TWSE／TPEx', asset = '股票', currency = '元', period = '當日', defaultFrames = ['1D'], defaultLimit = 0;
export const displayName = row => `${row.symbol} ${row.name || row.ticker?.name || ''}`.trim();
export const help = '<p>型態畫板使用官方真實 K 線，其他級別由已完成日 K 合併；休市與缺漏不補造 K 線。以實際幾何、轉折及有效水平／斜線搜尋形成中的型態，已明顯上下貫穿的線失效。</p><p>T1 完整量價確認，T2／T3 為部分確認或形成中觀察；型態搜尋沒有雷達名額上限，未達完整量價者保留並明確標示。未畫圖時瀏覽全觀察池，型態相似度不代表勝率，也不會因此取得雷達資格。</p>';
const cache = new Map();
export function dataDate() { return bundleState().date || savedResearch()?.date || null; }
export function scanCurrent(universe){
 const current=bundleState();
 return !!universe&&universe.dataDate===current.date&&universe.bundleRevision===current.revision&&!current.loading&&!current.failed&&current.classified>=current.expected;
}
export function radarCandidates() {
  const rows = createTWMarketState()?.data?.radar || [];
  const qualified=rows.flatMap(row=>{const signal=qualifyClassicRow(row,'long');return signal?[{...row,classicSignal:signal}]:[];});
  return rankClassicTiers(qualified,{side:'long',compare:(a,b)=>compareClassic(a,b)||(b.oxScore||0)-(a.oxScore||0)})
   .map((row,rank)=>({symbol:row.symbol,tier:Number(row.tier.slice(1)),rank,side:'LONG'}));
}
export async function fetchUniverse(signal, limit = 0) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // Background preload supplies the same snapshot consumed by Home and sectors.
  const prepared=await awaitBundleManifest(signal);
  const snapshot = prepared.stocks.length?{stocks:prepared.stocks,date:prepared.date}:(await loadResearch()).data||savedResearch();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const eligible = selectUniverse(snapshot?.stocks || [], 0), symbols = new Set(radarCandidates().map(row => row.symbol));
  const selected = selectUniverse(eligible, limit);
  const tickers = [...eligible.filter(row => symbols.has(row.symbol)), ...selected.filter(row => !symbols.has(row.symbol))];
  if (!tickers.length || !snapshot?.date) throw Error('官方台股觀察池尚未取得，請稍後重新掃描');
  return { tickers, allTickers: eligible, dataDate: snapshot.date, bundleRevision:prepared.revision, serverTime: Date.now() };
}
export function primeCandleCache(data) {
  if ((TIMEFRAMES[data?.frame] || data?.frame==='1Q') && data.candles?.length >= 1) cache.set(data.symbol + ':' + data.frame, data);
}
export async function fetchSeries(symbol, frame, signal, asOf = dataDate(), {minimum=35}={}) {
  if ((!TIMEFRAMES[frame] && frame!=='1Q') || !asOf) throw Error('台股時間級別或資料日期尚未取得');
  const indexed=bundleEntry(symbol,frame,asOf);if(indexed)return {...indexed.data,classic:indexed.classic,oxScore:indexed.classic.long.eligible?indexed.classic.long.qualityScore:null,preclassified:indexed.matches};
  if(minimum===1){const base=bundleEntry(symbol,'1D',asOf);if(base){const candles=aggregateChartCandles(base.data.candles,frame,asOf);if(candles.length)return {...base.data,frame,candles};}}
  const key = symbol + ':' + frame, cached = cache.get(key);
  if (cached?.dataDate === asOf && cached.candles.length>=minimum) return cached;
  const payload = await twProvider.getCandles(symbol, { interval: '1D', range: ['1M','1Q'].includes(frame) ? '3Y' : frame==='1D'?'3M':'2Y', to: asOf, adjusted: false, signal, timeoutMs: 45000 });
  const daily = dailyCandles(payload?.candles || [], asOf);
  if (daily.at(-1)?.date !== asOf) throw Error(`${symbol} 官方日線缺少資料日，已跳過`);
  const candles = aggregateChartCandles(daily,frame,asOf).slice(-200);
  if (candles.length < minimum) throw Error(`${symbol} ${frame} 官方 K 線不足`);
  const quote = savedResearch()?.stocks?.find(row => row.symbol === symbol);
  const radar = createTWMarketState()?.data?.radar?.find(row => row.symbol === symbol);
  const value = { classic:classifyTWSeries(candles,frame), candles, symbol, name: quote?.name || payload.name, market: 'tw', frame, dataDate: asOf, source: 'TWSE／TPEx', serverTime: Date.now(), turnover: quote?.turnoverTwd ?? null, change: quote?.changePct ?? null, oxScore: radar?.oxScore ?? null };
  primeCandleCache(value); return value;
}
export async function scanUniverse(universe, frames, { signal, onSeries, onProgress }) {
  let done=0,failed=0,coinsDone=0;const total=universe.tickers.length*frames.length,coinsTotal=universe.tickers.length;
  const remaining=new Map(universe.tickers.flatMap(ticker=>frames.map(frame=>[ticker.symbol+':'+frame,{ticker,frame}]))),finishedCoins=new Map();
  let revision=0,wake=null,finished=false;
  const notify=()=>{revision++;wake?.();wake=null;},unsubscribe=subscribeBundle(notify),abort=()=>notify();
  signal.addEventListener('abort',abort,{once:true});
  preloadBundle().then(()=>{finished=true;notify();},()=>{finished=true;notify();});
  const progress=()=>onProgress({done,total,failed,coinsDone,coinsTotal});
  try{
    progress();
    while(remaining.size){
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      const seen=revision,unavailable=new Set(bundleState().unavailable.map(row=>row.symbol));
      for(const [key,{ticker,frame}]of remaining){
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        if(!bundleEntry(ticker.symbol,frame,universe.dataDate)&&!unavailable.has(ticker.symbol)&&!finished)continue;
        remaining.delete(key);
        try{const data=bundleEntry(ticker.symbol,frame,universe.dataDate);if(!data)throw Error('歷史不足或分類資料缺漏');await onSeries({...await fetchSeries(ticker.symbol,frame,signal,universe.dataDate),ticker});}
        catch(error){if(signal.aborted)throw error;failed++;}
        done++;const n=(finishedCoins.get(ticker.symbol)||0)+1;finishedCoins.set(ticker.symbol,n);if(n===frames.length)coinsDone++;
        if(done===1||done%25===0||done===total){progress();await new Promise(resolve=>setTimeout(resolve,0));}
      }
      if(!remaining.size)break;
      if(revision!==seen||finished)continue;
      await new Promise(resolve=>{wake=resolve;if(signal.aborted||revision!==seen){wake=null;resolve();}});
    }
    progress();
  }finally{unsubscribe();signal.removeEventListener('abort',abort);wake=null;}
}
export { preloadBundle as preloadPatterns };
