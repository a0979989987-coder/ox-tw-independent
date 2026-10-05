// Port of the source project's update-morning.py. Dates and comparison prices
// remain explicit; null quotes never become zero and Asia excludes report day.
import {XMLParser} from 'fast-xml-parser';
export const MARKETS=[
 ['us','道瓊','^DJI',2,''],['us','S&P 500','^GSPC',2,''],['us','NASDAQ','^IXIC',2,''],['us','費城半導體','^SOX',2,''],
 ['us','台積電 ADR','TSM',2,'USD'],
 ['asia','台灣加權','^TWII',2,''],['asia','日經 225','^N225',2,''],['asia','韓國 KOSPI','^KS11',2,''],['asia','上海綜合','000001.SS',2,''],
 ['indicators','VIX','^VIX',2,''],['indicators','歐洲 STOXX 50','^STOXX50E',2,''],
 ['commodities','黃金期貨','GC=F',2,'USD/盎司'],['commodities','白銀期貨','SI=F',3,'USD/盎司'],['commodities','WTI 原油期貨','CL=F',2,'USD/桶'],['commodities','布蘭特原油期貨','BZ=F',2,'USD/桶'],
 ['fx','EUR/USD','EURUSD=X',5,''],['fx','USD/JPY','JPY=X',3,''],['fx','USD/CNY','CNY=X',4,''],['fx','USD/TWD','TWD=X',4,''],['fx','美元指數 DXY','DX-Y.NYB',2,'']
];
export const finite=value=>typeof value==='number'&&Number.isFinite(value);
const price=value=>finite(value)&&value>0;
export function marketDate(stamp,timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000));}
export async function readSource(url){
 const response=await fetch(url,{headers:{Accept:'application/json,text/html,text/xml','User-Agent':'Mozilla/5.0'},cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(`來源連線失敗（${response.status}）`);return response;
}
export function parseMarket(raw,symbol,cutoff,reportDate=null){
 const result=raw?.chart?.result?.[0],meta=result?.meta;
 // Yahoo now also resolves the legacy JPY=X route to canonical USDJPY=X.
 // Accept only this verified same-currency alias; unrelated symbols still fail.
 const sameSymbol=meta?.symbol===symbol||symbol==='JPY=X'&&meta?.symbol==='USDJPY=X'&&meta.currency==='JPY';
 if(!sameSymbol)throw Error('來源代號不符');
 const timezone=meta.exchangeTimezoneName||'UTC',closes=result.indicators?.quote?.[0]?.close||[];
 const pairs=(result.timestamp||[]).map((stamp,i)=>({stamp,date:marketDate(stamp,timezone),value:closes[i]})).filter(p=>p.stamp<=cutoff&&price(p.value)).sort((a,b)=>a.stamp-b.stamp);
 if(reportDate){
  const closed=pairs.filter(p=>p.date<reportDate);if(closed.length<2)throw Error('前一交易日與比較日收盤資料不足');
  const last=closed.at(-1),prev=closed.at(-2);
  return {value:last.value,change:last.value-prev.value,changePct:(last.value/prev.value-1)*100,previousClose:prev.value,marketDate:last.date,comparisonDate:prev.date,quotedAt:null,quoteKind:'previous-close',status:'ok'};
 }
 const stamp=meta.regularMarketTime,value=meta.regularMarketPrice;
 if(!price(value)||!finite(stamp)||stamp>cutoff)throw Error('報價缺漏或時間超出快照');
 const date=marketDate(stamp,timezone),prev=pairs.filter(p=>p.date<date).at(-1);if(!prev)throw Error('缺少前一交易日收盤價');
 let previous=prev.value;
 if(price(meta.previousClose))previous=meta.previousClose;
 else if(finite(meta.fulldayChange)&&price(meta.fulldayPrice)&&Math.abs(meta.fulldayPrice-value)<1e-6&&price(value-meta.fulldayChange))previous=value-meta.fulldayChange;
 return {value,change:value-previous,changePct:(value/previous-1)*100,previousClose:previous,marketDate:date,quotedAt:new Date(stamp*1000).toISOString(),quoteKind:'source-quote',status:'ok'};
}
export function parseTreasury(xml,cutoff){
 const raw=new XMLParser({removeNSPrefix:true,parseTagValue:false}).parse(xml),entries=raw?.feed?.entry;
 const rows=(Array.isArray(entries)?entries:entries?[entries]:[]).map(e=>e.content?.properties).filter(Boolean).map(p=>({date:String(p.NEW_DATE||'').slice(0,10),two:Number(p.BC_2YEAR),ten:Number(p.BC_10YEAR)})).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.date<=cutoff&&price(r.two)&&price(r.ten)).sort((a,b)=>a.date.localeCompare(b.date));
 if(!rows.length)throw Error('美債殖利率尚未公布');return rows;
}
export function retainMarket(row,previous,reportDate){
 if(row.status!=='unavailable'||!price(previous?.value))return row;
 // Old snapshots must still obey the Asia cutoff when carried forward.
 if(row.group==='asia'&&(!(previous.marketDate<reportDate)||previous.quoteKind!=='previous-close'))return row;
 return {...previous,status:'stale',error:row.error,checkedAt:row.checkedAt};
}
export async function collectBriefing(previous,now=new Date(),read=readSource,receivedNow=()=>new Date()){
 const date=marketDate(now.getTime()/1000,'Asia/Taipei'),cutoff=Math.floor(now.getTime()/1000),checkedAt=now.toISOString();
 const old=new Map((previous?.rows||[]).map(row=>[row.id,row]));let index=0;const rows=new Array(MARKETS.length);
 const worker=async()=>{while(index<MARKETS.length){const i=index++,item=MARKETS[i], [group,name,id,decimals,unit]=item;
  let row={group,name,id,decimals,unit,source:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(id)+'/',checkedAt};
  try{const raw=await(await read('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(id)+'?interval=1d&range=1mo')).json(),received=receivedNow();row={...row,...parseMarket(raw,id,Math.max(cutoff,Math.floor(received.getTime()/1000)),group==='asia'?date:null),collectedAt:received.toISOString()};}
  catch(error){row={...row,value:null,change:null,changePct:null,status:'unavailable',error:error.message};}
  rows[i]=retainMarket(row,old.get(id),date);
 }};await Promise.all(Array.from({length:4},worker));
 const sourceUrl='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value='+now.getUTCFullYear();
 let yields,error;
 try{yields=parseTreasury(await(await read(sourceUrl)).text(),marketDate(cutoff,'America/New_York'));}catch(e){error=e.message;}
 for(const [id,name,key] of [['US2Y','美債 2 年期','two'],['US10Y','美債 10 年期','ten']]){
  const last=yields?.at(-1),prior=yields?.at(-2);let row={id,name,group:'yields',source:'美國財政部',sourceUrl,unit:'%',decimals:2,changeUnit:'bp',value:last?.[key]??null,change:prior?(last[key]-prior[key])*100:null,changePct:null,marketDate:last?.date??null,quotedAt:null,quoteKind:'daily-yield',collectedAt:last?checkedAt:null,checkedAt,status:last?'ok':'unavailable',...(error?{error}:{})};
  rows.push(retainMarket(row,old.get(id),date));
 }
 return {date,startedAt:checkedAt,collectedAt:new Date().toISOString(),scheduledTime:'05:30 Asia/Taipei',rows,complete:rows.every(row=>row.status==='ok')};
}
