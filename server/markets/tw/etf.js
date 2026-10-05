import { readFile } from 'node:fs/promises';
import { number } from '../../../src/markets/tw/etf/model.js';
import { loadHoldings } from './etf-fund-holdings.js';
import { collectFundProfiles, collectOfferings, collectHotStocks } from './etf-extras.js';
import { applyFees } from './etf-fees.js';

export const SOURCES = {
  twse: 'https://www.twse.com.tw/zh/ETFortune/ajaxProductsResult',
  tpex: 'https://info.tpex.org.tw/api/etfFilter',
  basic: 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L',
  quotes: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  otcQuotes: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
};
const cache = new Map(), pending = new Map();
const ttl = 30*60*1000;
export const taipeiDate = now => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now || new Date());
export const isoDate = v => {
  const s=String(v??'').replace(/[^0-9]/g,'');
  const y=s.length===7?Number(s.slice(0,3))+1911:s.length===8?Number(s.slice(0,4)):0;
  return y>1900 ? `${y}-${s.slice(-4,-2)}-${s.slice(-2)}` : null;
};
export async function acquire(url, { method='GET', text=false, fetcher=fetch }={}) {
  const r=await fetcher(url,{method,headers:{'User-Agent':'Mozilla/5.0','Accept':text?'text/html':'application/json'},cache:'no-store',signal:AbortSignal.timeout(16000)});
  if(!r.ok) throw Error(`來源暫時無法讀取 (${r.status})`);
  return text?r.text():r.json();
}
async function cached(key, refresh, loader, lifetime=ttl) {
  const old=cache.get(key);
  if(!refresh && old && Date.now()-old.at<lifetime)return old.data;
  if(pending.has(key))return pending.get(key);
  const task=loader().then(data=>{cache.set(key,{at:Date.now(),data});return data;}).catch(error=>{
    if(old)return {...old.data,stale:true,status:'更新失敗，保留上次有效資料'};
    throw error;
  }).finally(()=>pending.delete(key));
  pending.set(key,task);return task;
}
export function normalizeCatalog(list,market,basics,quotes,acquiredAt) {
  const bm=new Map(basics.map(x=>[x['基金代號'],x])), qm=new Map(quotes.map(x=>[x.Code||x.SecuritiesCompanyCode,x]));
  return list.filter(x=>/^00\d{2,4}[A-Z]?$/.test(x.stockNo)).map(x=>{
    const b=bm.get(x.stockNo)||{}, q=qm.get(x.stockNo)||{}, desc=(b['基金類型']||'')+' '+(x.indexName||'')+' '+x.stockName;
    const asset=/債|固定收益/.test(desc)?'bond':/期元大|期街口|期元富|期富邦|期貨/.test(desc)?'futures':/平衡|股債|多資產/.test(desc)?'mixed':'stock';
    const price=number(q.ClosingPrice??q.Close), change=number(q.Change);
    const tags=[];
    if(/高息|高股息|高股利|優息|收益|入息/.test(desc))tags.push('dividend');
    if(/50|大型|市值|加權|標普500|S&P500|S&P 500|全市場/.test(desc))tags.push('cap');
    if(/科技|半導體|金融|電動|AI|航太|5G|生技|電力|能源|通訊|ESG|低碳/.test(desc))tags.push('theme');
    if(/公債|美國政府|主權債|主權|美債/.test(desc)&&/20|長天|長期/.test(desc))tags.push('treasury');
    if(/投資級|投等|投資等級|BBB|A級/.test(desc)&&!/非投|非投資/.test(desc))tags.push('investment');
    if(/新興/.test(desc))tags.push('emerging');
    if(/非投等|高收益|非投資/.test(desc))tags.push('highyield');
    const region=b['是否包含國外成分股']==='否'?'台灣':/全球|世界|多國|已開發/.test(desc)?'全球':/美國|美債|納斯達克|標普|NASDAQ/.test(desc)?'美國':/中國|陸股|上証|上證|滬深|A股/.test(desc)?'中國':/日本|日經|東證/.test(desc)?'日本':/台灣|臺灣|富櫃/.test(desc)?'台灣':'—';
    const currency=/\(美元\)|（美元）/.test(x.stockName)?'USD':/人民幣/.test(x.stockName)?'CNY':'TWD';
    return {symbol:x.stockNo,name:x.stockName,fullName:b['基金中文名稱']||null,taxId:b['基金統一編號']||null,market,asset,tags,active:/主動/.test(desc),leveraged:/正2|反1|槓桿|反向/.test(desc),region,currency,
      price:price>0?price:null,change,changePct:price>0&&change!==null&&price-change>0?change/(price-change)*100:null,
      volume:number(q.TradeVolume??q.TradingShares),turnover:number(q.TradeValue??q.TransactionAmount),date:isoDate(q.Date),
      aum:number(x.totalAv),holders:number(x.holders),inception:isoDate(b['成立日期']),listingDate:isoDate(x.listingDate),
      issuer:x.issuer,index:x.indexName||null,expense:null,metadataDate:isoDate(b['出表日期']),acquiredAt,
      source:market==='TWSE'?'證交所':'櫃買中心',url:market==='TWSE'?`https://www.twse.com.tw/zh/ETFortune/etfInfo/${x.stockNo}`:`https://info.tpex.org.tw/ETF/zh/detail.html?query=${x.stockNo}`};
  });
}
export async function collectCatalog(fetcher=fetch) {
  const entries=Object.entries(SOURCES), results=await Promise.allSettled(entries.map(([key,url])=>acquire(url,{fetcher,method:['twse','tpex'].includes(key)?'POST':'GET'})));
  const payload={}, health={};
  results.forEach((r,i)=>{const key=entries[i][0];payload[key]=r.status==='fulfilled'?r.value:null;health[key]={ok:r.status==='fulfilled',url:entries[i][1]};});
  const acquiredAt=new Date().toISOString();
  const rows=[...normalizeCatalog(payload.twse?.data||[],'TWSE',payload.basic||[],payload.quotes||[],acquiredAt),...normalizeCatalog(payload.tpex?.data||[],'TPEX',payload.basic||[],payload.otcQuotes||[],acquiredAt)];
  if(rows.length<100)throw Error('ETF 官方名單暫時無法載入');
  try{const profiles=await collectFundProfiles((u,o={})=>acquire(u,{...o,fetcher}));for(const row of rows){const p=profiles.get(row.symbol);if(p){row.inception ||= p.inception;row.fullName ||= p.name;row.frequency=p.frequency;row.profileDate=p.date;row.profileUrl=p.url;}}}catch{health.profiles={ok:false};}
  try{applyFees(rows,JSON.parse(await readFile(new URL('../../../data/tw-etf/fees.json',import.meta.url),'utf8')));}catch{health.fees={ok:false};}
  return {rows,acquiredAt,health,partial:Object.values(health).some(x=>!x.ok),status:'官方收盤資料',realtime:false};
}
export async function getCatalog({refresh=false}={}) {
  return cached('catalog',refresh,async()=>{
    try{const data=await collectCatalog();if(data.partial){const old=cache.get('catalog')?.data||JSON.parse(await readFile(new URL('../../../data/tw-etf/catalog.json',import.meta.url),'utf8'));const present=new Set(data.rows.map(r=>r.symbol));for(const row of data.rows){const previous=old.rows.find(r=>r.symbol===row.symbol);if(previous&&row.price===null)Object.assign(row,{price:previous.price,change:previous.change,changePct:previous.changePct,volume:previous.volume,turnover:previous.turnover,date:previous.date,quoteStale:true});}for(const row of old.rows)if(!present.has(row.symbol)&&!data.health[row.market==='TWSE'?'twse':'tpex']?.ok)data.rows.push({...row,quoteStale:true});}return data;}catch(error){
      if(cache.has('catalog'))throw error;
      const seed=JSON.parse(await readFile(new URL('../../../data/tw-etf/catalog.json',import.meta.url),'utf8'));
      if(!seed.rows?.length)throw error;
      return {...seed,stale:true,status:'連線暫時中斷，顯示上次有效資料'};
    }
  });
}
export function normalizeHistory(raw, row, now=new Date()) {
  const r=raw?.chart?.result?.[0]; if(!r?.timestamp?.length)throw Error('歷史報酬資料尚未提供');
  const cutoff=taipeiDate(now), taipeiHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).format(now));
  const prices=r.indicators?.quote?.[0]?.close||[], adjusted=r.indicators?.adjclose?.[0]?.adjclose||[];
  // Never count the current incomplete session in returns or projections.
  const points=r.timestamp.map((t,i)=>({date:taipeiDate(new Date(t*1000)),close:number(prices[i]),value:number(adjusted[i])})).filter(p=>p.close>0&&p.value>0&&(p.date<cutoff||(p.date===cutoff&&taipeiHour>=14)));
  if(points.length<2)throw Error('完整歷史資料不足');
  const last=points.at(-1), before=date=>points.findLast(p=>p.date<=date);
  const shift=(date,months)=>{const d=new Date(date+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-months);return d.toISOString().slice(0,10);};
  const ret=months=>{const date=shift(last.date,months),p=before(date);return p&&(new Date(date)-new Date(p.date))/86400000<=10?(last.value/p.value-1)*100:null;};
  const span=(new Date(last.date)-new Date(points[0].date))/86400000/365.25;
  const firstCoverage=row.listingDate&&Math.abs(new Date(points[0].date)-new Date(row.listingDate))/86400000<=10;
  const months=new Map(); for(const p of points)if(p.date.slice(0,7)<last.date.slice(0,7))months.set(p.date.slice(0,7),p.value);
  // Yahoo dividend events are already split-adjusted, matching its split-adjusted closes.
  const dividends=Object.values(r.events?.dividends||{}).map(d=>({date:taipeiDate(new Date(d.date*1000)),amount:number(d.amount)})).filter(d=>d.amount!==null&&d.date<=last.date);
  const splits=Object.values(r.events?.splits||{}).map(s=>({date:taipeiDate(new Date(s.date*1000)),ratio:s.numerator/s.denominator}));
  // Yahoo historical dividends may be on the original share basis. Verify/adjust in the provider before using a multi-year yield across a split.
  const recent=dividends.filter(d=>d.date>shift(last.date,12)), yieldPct=last.close>0&&points[0].date<=shift(last.date,12)&&!splits.some(s=>s.date>shift(last.date,12))?recent.reduce((s,d)=>s+d.amount,0)/last.close*100:null;
  const year=Number(last.date.slice(0,4)), annualYields=[];
  for(let y=year-3;y<year;y++){
    const p=before(`${y}-12-31`), start=before(`${y}-01-01`), ds=dividends.filter(d=>d.date.startsWith(String(y)));
    if(p?.date.startsWith(String(y))&&start&&ds.length&&!splits.some(s=>s.date>=`${y}-01-01`&&s.date<=last.date))annualYields.push({year:y,yield:ds.reduce((s,d)=>s+d.amount,0)/p.close*100});
  }
  const threeYearYield=annualYields.length===3?annualYields.reduce((s,r)=>s+r.yield,0)/3:null;
  return {symbol:row.symbol,date:last.date,return3m:ret(3),return1y:ret(12),returnTotal:firstCoverage?(last.value/points[0].value-1)*100:null,
    annual:span>=1?((last.value/points[0].value)**(1/span)-1)*100:null,historyStart:points[0].date,historyYears:span,
    monthly:[...months].map(([month,value])=>({month,value})),yield:yieldPct,threeYearYield,annualYields,
    frequency:recent.length===12?'月配':recent.length===4?'季配':recent.length===2?'半年配':recent.length===1?'年配':recent.length?`近年 ${recent.length} 次`:'—',
    dividendCount:recent.length,dividends:dividends.slice(-16),splitAffected:splits.some(s=>s.date>=`${year-3}-01-01`),
    source:'Yahoo Finance 調整後收盤價',url:`https://finance.yahoo.com/quote/${row.symbol}.${row.market==='TPEX'?'TWO':'TW'}/history/`,acquiredAt:new Date().toISOString()};
}
export async function getHistory(symbol,{refresh=false}={}) {
  const catalog=await getCatalog(), row=catalog.rows.find(x=>x.symbol===symbol);
  if(!row)throw Error('找不到 ETF 代號');
  return cached('history:'+symbol,refresh,async()=>{
    if(!refresh){try{const seed=await historySeed();const h=seed?.rows?.[symbol];if(h&&Date.now()-new Date(h.acquiredAt).getTime()<6*60*60*1000)return h;}catch{}}
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.${row.market==='TPEX'?'TWO':'TW'}?range=max&interval=1d&events=div%2Csplits`;
    return normalizeHistory(await acquire(url),row);
  },6*60*60*1000);
}
let seedPromise;
const historySeed=()=>seedPromise??=readFile(new URL('../../../data/tw-etf/history.json',import.meta.url),'utf8').then(JSON.parse).catch(()=>null);
export const getOfferings=({refresh=false}={})=>cached('offering',refresh,()=>collectOfferings(acquire),3600000);
export const getHotStocks=({refresh=false}={})=>cached('hot',refresh,async()=>collectHotStocks(await getCatalog(),getHoldings,acquire),3600000);
export async function getHoldings(symbol,{refresh=false}={}) {
  const catalog=await getCatalog(), row=catalog.rows.find(x=>x.symbol===symbol);
  if(!row)throw Error('找不到 ETF 代號');
  return cached('holdings:'+symbol,refresh,()=>loadHoldings(row,acquire),60*60*1000);
}
export async function batchHistory(symbols,options={}) {
  const result=[]; for(let i=0;i<symbols.length;i+=4)result.push(...await Promise.all(symbols.slice(i,i+4).map(async symbol=>{try{return await getHistory(symbol,options);}catch{return {symbol,unavailable:true};}})));
  return {rows:result};
}
