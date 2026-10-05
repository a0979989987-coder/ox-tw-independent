import { readFile } from 'node:fs/promises';
import { clean } from './etf-fund-holdings.js';
import { number } from '../../../src/markets/tw/etf/model.js';
const BASE='https://www.sitca.org.tw/ROC/SITCA_ETF/';
const rows=html=>[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(x=>({html:x[1],cells:[...x[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>clean(c[1]))}));
export async function collectFundProfiles(acquire){
  const page=await acquire(BASE+'etf_info.aspx',{text:true}), month=page.match(/<option[^>]*value="(\d{6})"[^>]*>/)?.[1];
  if(!month)throw Error('投信公會資料月份未提供');
  const url=BASE+`etf_info2.aspx?txtYM=${month}&txtR1=0`,html=await acquire(url,{text:true}),result=new Map();
  for(const {cells:c} of rows(html))if(/^00\d{2,4}[A-Z]?$/.test(c[3])){
    const date=c[6]?.replace(/\D/g,''), f=c[9]||'';
    result.set(c[3],{name:c[5],inception:date?.length===8?date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6):null,frequency:/不分配/.test(f)?'不配息':/半年|一年兩次/.test(f)?'半年配':/季配/.test(f)?'季配':/月配/.test(f)?'月配':/年配/.test(f)?'年配':'依公告',date:month.slice(0,4)+'-'+month.slice(4),url});
  }
  return result;
}
export function parseOfferings(html,url){
  return rows(html).filter(({cells:c})=>c.length>=11&&/募集/.test(c[7])).map(({cells:c,html})=>{
    const href=html.match(/window.open\(&#39;([^&]+)&#39;/)?.[1];
    return {symbol:/^00/.test(c[3])?c[3]:null,name:c[5],title:c[7],date:c[8].replace(/年|月/g,'-').replace('日',''),status:/生效/.test(c[7])?'申報生效':/核准/.test(c[7])?'核准':/募集/.test(c[7])?'募集公告':'依公告',startDate:null,type:/追加/.test(c[7])?'追加募集':'首次／依公告',url:href?.startsWith('http://www.sitca.org.tw/')?href.replace('http:','https:'):url};
  }).slice(0,40);
}
export async function collectOfferings(acquire){const url=BASE+'etf_bulletin2.aspx?txtdate=3Months&txtR1=0';return {rows:parseOfferings(await acquire(url,{text:true}),url),source:'投信投顧公會',url,acquiredAt:new Date().toISOString()};}
export async function collectHotStocks(catalog,getHoldings,acquire){
  const candidates=catalog.rows.filter(r=>r.asset==='stock'&&r.region==='台灣'&&!r.leveraged&&/元大|富邦|國泰|永豐/.test(r.issuer)).sort((a,b)=>(b.aum||0)-(a.aum||0)).slice(0,16);
  const groups=new Map();let covered=0;
  for(let i=0;i<candidates.length;i+=4){const results=await Promise.allSettled(candidates.slice(i,i+4).map(r=>getHoldings(r.symbol)));for(const r of results)if(r.status==='fulfilled'&&r.value.holdings.length){covered++;for(const h of r.value.holdings)if(/^\d{4}$/.test(h.code)){const g=groups.get(h.code)||{symbol:h.code,name:h.name,count:0,dates:[]};g.count++;g.dates.push(r.value.date);groups.set(h.code,g);}}}
  let warnings=new Map(),quoteMap=new Map();
  try{const data=JSON.parse(await readFile(new URL('../../../data/tw-radar.json',import.meta.url),'utf8'));for(const [mode,list] of Object.entries(data.data?.modes||{}))for(const r of list)if(['risk','disposal','release'].includes(mode))warnings.set(r.symbol,`${mode==='risk'?'注意股':mode==='disposal'?'處置中':'即將出關'} ${r.dataDate||''}`);}catch{}
  const feeds=await Promise.allSettled(['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'].map(u=>acquire(u)));
  for(const [i,r] of feeds.entries())if(r.status==='fulfilled')for(const q of r.value)quoteMap.set(q.Code||q.SecuritiesCompanyCode,{suffix:i?'TWO':'TW',volume:number(q.TradeVolume??q.TradingShares),turnover:number(q.TradeValue??q.TransactionAmount),date:q.Date});
  // Rank stocks held by at least two covered ETFs. Scope remains visible to the user.
  const hot=[...groups.values()].sort((a,b)=>b.count-a.count).slice(0,32);
  for(let i=0;i<hot.length;i+=8)await Promise.all(hot.slice(i,i+8).map(async r=>{const q=quoteMap.get(r.symbol);Object.assign(r,q||{},{warning:warnings.get(r.symbol)||null,change5d:null});if(!q)return;try{
    const payload=await acquire(`https://query1.finance.yahoo.com/v8/finance/chart/${r.symbol}.${q.suffix}?range=1mo&interval=1d`),result=payload.chart?.result?.[0];
    const adj=result?.indicators?.adjclose?.[0]?.adjclose||[], times=result?.timestamp||[];
    const quoteDate=String(q.date).replace(/\D/g,'');const iso=quoteDate.length===7?String(Number(quoteDate.slice(0,3))+1911)+quoteDate.slice(3):quoteDate;
    const p=times.map((t,i)=>({date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(t*1000)).replaceAll('-',''),value:number(adj[i])})).filter(p=>p.date<=iso&&p.value>0);
    if(p.length>=6)r.change5d=(p.at(-1).value/p.at(-6).value-1)*100;
  }catch{}}));
  return {covered,rows:hot.sort((a,b)=>(b.change5d??-Infinity)-(a.change5d??-Infinity)),acquiredAt:new Date().toISOString()};
}
