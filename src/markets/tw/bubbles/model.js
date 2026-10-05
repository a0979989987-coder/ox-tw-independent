export const TW_BUBBLE_METRICS=[['institution','三大法人買／賣超'],['volumeTrend','成交量三日連增'],['change','漲幅'],['volume','成交量大小']];
const finite=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function volumeWindow(entry,date,dates=[]){
 if(entry?.data?.dataDate!==date)return null;
 const bars=entry.data.candles.slice(-4),expected=dates.filter(d=>d<=date).slice(-4);
 if(bars.length!==4||expected.length!==4||bars.some((b,i)=>b.date!==expected[i]||finite(b.volume)===null||b.volume<0)||bars.at(-1).date!==date)return null;
 return bars;
}
export function threeVolumeIncreases(bars){return !!bars&&bars.slice(1).every((bar,i)=>bar.volume>bars[i].volume);}
export function twBubbleRows(snapshot,{metric='change',direction='both',watch=null,limit=50,entryFor=()=>null,dates=[]}={}){
 const seen=new Set();
 const rows=(snapshot?.stocks||[]).flatMap(stock=>{
  const price=finite(stock.price),change=finite(stock.changePct),symbol=String(stock.symbol);
  if(!/^\d{4}$/.test(symbol)||seen.has(symbol)||!(price>0)||change===null||watch&&!watch.has(symbol))return [];seen.add(symbol);
  const bars=volumeWindow(entryFor(symbol,snapshot.date),snapshot.date,dates),latest=bars?.at(-1);
  const raw=finite(stock.netShares),netTwd=finite(stock.netTwd);
  // Older official snapshots stored shares × closing price. Recover their
  // original integer share count; these are not executed-trade cash flows.
  const netShares=raw??(netTwd===null?null:Math.round(netTwd/price));
  const volume=finite(stock.volumeShares)??finite(latest?.volume);
  const values={change,institution:netShares===null?null:netShares/1000,volume:volume===null?null:volume/1000,volumeTrend:threeVolumeIncreases(bars)?latest.volume/1000:null};
  const value=values[metric],sign=metric==='institution'?netShares:change;
  if(!Number.isFinite(value)||(metric==='volume'||metric==='volumeTrend')&&!(value>0)||direction==='long'&&!(sign>0)||direction==='short'&&!(sign<0))return [];
  return [{...stock,symbol,base:stock.name||symbol,price,change,volume,netShares,value,sign,volumeBars:bars,dataDate:snapshot.date}];
 });
 return rows.sort((a,b)=>(metric==='institution'||metric==='change'?Math.abs(b.value)-Math.abs(a.value):b.value-a.value)||a.symbol.localeCompare(b.symbol)).slice(0,limit);
}
export function twBubbleText(value,metric){
 if(!Number.isFinite(value))return '—';
 if(metric==='change')return `${value>0?'+':''}${value.toFixed(2)}%`;
 const magnitude=Math.abs(value),unit=magnitude>=10000?'萬張':'張',n=magnitude/(unit==='萬張'?10000:1);
 return `${value<0?'−':metric==='institution'&&value>0?'+':''}${n.toLocaleString('zh-TW',{maximumFractionDigits:unit==='萬張'?2:1})}${unit}`;
}
