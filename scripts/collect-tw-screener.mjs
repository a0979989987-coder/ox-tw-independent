import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {technicalMetrics} from '../src/markets/tw/screener/model.js';
import {numeric} from '../server/markets/tw/research.js';
import {parseScreenFlows} from '../server/markets/tw/screener-data.js';
import {parseYuanta} from '../server/markets/tw/etf-holdings.js';
const root=new URL('../',import.meta.url),json=async p=>{const raw=await readFile(new URL(p,root));return JSON.parse(p.endsWith('.gz')?gunzipSync(raw):raw.toString('utf8'));};
const radar=(await json('data/tw-radar.json')).data,research=await json('data/tw-research.json'),manifest=await json('data/tw-patterns/manifest.json');
const previous=await json('data/tw-screener.json.gz').catch(()=>null),oldEtf=await json('data/tw-etf-holdings.json').catch(()=>({funds:[]}));
const date=radar.dataDate,checkedAt=new Date().toISOString(),sources={},old=new Map((previous?.stocks||[]).map(s=>[s.symbol,s]));
const quoteRows=radar.radar||[],rows=quoteRows.filter(s=>s.dataDate===date).map(s=>({symbol:s.symbol,name:s.name,market:s.market,industry:s.industry,price:s.price,changePct:s.changePct,turnover:numeric(s.turnoverTwd)==null?null:s.turnoverTwd/1e8,dataDate:s.dataDate}));
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||rows.length<100)throw Error('Verified universe unavailable');const stocks=new Map(rows.map(s=>[s.symbol,s]));
for(const c of manifest.chunks){const payload=JSON.parse(gunzipSync(await readFile(new URL('data/tw-patterns/'+c.file,root))));if(payload.date!==date)continue;for(const entry of payload.entries){const s=stocks.get(entry.data.symbol);if(s)Object.assign(s,technicalMetrics(entry.data.candles,date));}}
if(research.date===date)for(const r of research.stocks){const s=stocks.get(r.symbol);if(!s||!(s.price>0))continue;for(const [key,k] of [['foreign1','foreignTwd'],['trust1','trustTwd'],['dealer1','dealerTwd']])if(Number.isFinite(r[k]))s[key]=r[k]/s.price/1000;s.institutionsBuy=['foreign1','trust1','dealer1'].every(k=>Number.isFinite(s[k]))?s.foreign1>0&&s.trust1>0&&s.dealer1>0:null;}
async function get(url,key,text=false){
 if(process.env.OX_TW_SCREEN_CACHE){try{const raw=await readFile(process.env.OX_TW_SCREEN_CACHE+'/'+key+'.txt','utf8');return text?raw:JSON.parse(raw);}catch{}}
 let error;for(let attempt=0;attempt<2;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(40000),headers:{'User-Agent':'Mozilla/5.0 OX Market Research','Accept':text?'text/html':'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);return text?await r.text():await r.json();}catch(e){error=e;}}throw error;
}
const sourcesList=[
 ['valuation','TWSE','上市估值','https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL','valuation'],['tpex-val','TPEX','上櫃估值','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis','valuation'],
 ['revenue','TWSE','上市月營收','https://openapi.twse.com.tw/v1/opendata/t187ap05_L','revenue'],['tpex-revenue','TPEX','上櫃月營收','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O','revenue'],
 ['twse-income','TWSE','上市一般業財報','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci','income'],['tpex-income','TPEX','上櫃一般業財報','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci','income'],
 ['twse-company','TWSE','上市公司股數','https://openapi.twse.com.tw/v1/opendata/t187ap03_L','company'],['tpex-company','TPEX','上櫃公司股數','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O','company']
];
const rocDate=x=>{const s=String(x||'').replace(/\D/g,'');return s.length===7?`${Number(s.slice(0,3))+1911}-${s.slice(3,5)}-${s.slice(5,7)}`:s.length===8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:null;};
const keysByType={valuation:['pe','pb','yield','valuationDate'],revenue:['revenue','revenueYoY','revenueMoM','revenuePeriod'],income:['grossMargin','operatingMargin','netMargin','financialPeriod','eps'],company:['shares','marketCap']};
await Promise.all(sourcesList.map(async([id,market,name,url,type])=>{try{
 const data=await get(url,id);if(!Array.isArray(data)||data.length<50)throw Error('Invalid official rows');let matched=0;
 for(const r of data){const s=stocks.get(String(r.Code||r.SecuritiesCompanyCode||r['公司代號']||'').trim());if(!s||s.market!==market)continue;matched++;
 if(type==='valuation'){s.pe=numeric(r.PEratio??r.PriceEarningRatio);s.pb=numeric(r.PBratio??r.PriceBookRatio);s.yield=numeric(r.DividendYield??r.YieldRatio);s.valuationDate=rocDate(r.Date);}
 if(type==='revenue'){s.revenue=numeric(r['營業收入-當月營收'])==null?null:numeric(r['營業收入-當月營收'])/1e5;s.revenueYoY=numeric(r['營業收入-去年同月增減(%)']);s.revenueMoM=numeric(r['營業收入-上月比較增減(%)']);const ym=String(r['資料年月']||'');s.revenuePeriod=ym.length===5?`${Number(ym.slice(0,3))+1911}-${ym.slice(3)}`:ym;}
 if(type==='income'){const rev=numeric(r['營業收入']),ratio=k=>rev>0&&numeric(r[k])!==null?numeric(r[k])/rev*100:null;s.grossMargin=ratio('營業毛利（毛損）淨額');s.operatingMargin=ratio('營業利益（損失）');s.netMargin=ratio('本期淨利（淨損）');const q=Number(r['季別']||r.Season),y=Number(r['年度']||r.Year)+1911;s.financialPeriod=`${y} Q${q} 年初累計`;if(q===1)s.eps=numeric(r['基本每股盈餘（元）']);}
 if(type==='company'){s.shares=numeric(r['已發行普通股數或TDR原股發行股數']??r.IssueShares);s.marketCap=s.shares>0?s.price*s.shares/1e8:null;}
 }
 sources[id]={name,url,ok:true,matched,checkedAt};console.log(id,matched);
 }catch(error){let retained=false;for(const s of rows.filter(s=>s.market===market)){const prev=old.get(s.symbol);if(!prev)continue;for(const k of keysByType[type])if(prev[k]!=null){s[k]=prev[k];retained=true;}if(type==='company'&&s.shares>0)s.marketCap=s.price*s.shares/1e8;}sources[id]={name,url,ok:false,retained,checkedAt,error:String(error.message)};console.log(id,'unavailable');}}));
// Keep date-verified institutional sessions; no sector estimates masquerade as per-stock flows.
const history=await json('data/tw-screener-flows.json.gz').catch(()=>[]),dates=manifest.dates.filter(d=>d<=date).slice(-5);
if(!process.argv.includes('--skip-flows')){
 const jobs=['TWSE','TPEX'].flatMap(market=>dates.map(day=>({market,day})));let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<jobs.length){const {market,day}=jobs[cursor++];const existing=history.find(h=>h.date===day&&h.market===market);if(existing?.rows.some(r=>Number.isFinite(r.foreignShares)&&Number.isFinite(r.trustShares)))continue;
 const compact=day.replaceAll('-',''),roc=`${Number(day.slice(0,4))-1911}/${day.slice(5,7)}/${day.slice(8)}`,url=market==='TWSE'?`https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${compact}&selectType=ALLBUT0999`:`https://www.tpex.org.tw/web/stock/3insti/DAILY_TradE/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(roc)}`;
 try{const payload=await get(url,day===date?'flows-'+market.toLowerCase():'flow-'+market+'-'+compact),flow=parseScreenFlows(payload,market,day);if(flow.length){if(existing)existing.rows=flow;else history.push({date:day,market,rows:flow});}}catch(error){console.log('Flow unavailable',market,day,error.message);}
 }}));
}
for(const s of rows){const now=history.find(h=>h.date===date&&h.market===s.market)?.rows.find(r=>r.symbol===s.symbol);if(now){for(const [key,k] of [['foreign1','foreignShares'],['trust1','trustShares'],['dealer1','dealerShares']])if(Number.isFinite(now[k]))s[key]=now[k]/1000;s.institutionsBuy=['foreign1','trust1','dealer1'].every(k=>Number.isFinite(s[k]))?s.foreign1>0&&s.trust1>0&&s.dealer1>0:null;}}
for(const s of rows){const h=dates.map(d=>history.find(h=>h.date===d&&h.market===s.market)?.rows.find(r=>r.symbol===s.symbol));if(h.length===5&&h.every(Boolean)){for(const [k,field]of [['foreign5','foreignShares'],['trust5','trustShares'],['dealer5','dealerShares']])if(h.every(r=>Number.isFinite(r[field])))s[k]=h.reduce((t,r)=>t+r[field],0)/1000;s.institutionsBuy5=['foreign5','trust5','dealer5'].every(k=>Number.isFinite(s[k]))?s.foreign5>0&&s.trust5>0&&s.dealer5>0:null;}}
await writeFile(new URL('data/tw-screener-flows.json.gz',root),gzipSync(JSON.stringify(history.sort((a,b)=>a.date.localeCompare(b.date)).slice(-44))));
try{const url='https://www.tpex.org.tw/openapi/v1/tpex_3insti_qfii',raw=await get(url,'qfii-tpex');for(const r of raw){const s=stocks.get(r.SecuritiesCompanyCode);if(s?.market==='TPEX'&&rocDate(r.Date)===date)s.foreignRatio=numeric(String(r['PercentageOfSharesOC/FMIHeld']||'').replace('%',''));}sources.foreignOwnership={name:'櫃買外資持股比例',url,ok:true,checkedAt};}catch{}
sources.institutions={name:'TWSE／TPEx 五日三大法人',url:'https://www.twse.com.tw/zh/trading/foreign/t86.html',ok:rows.some(s=>Number.isFinite(s.foreign5)),checkedAt,covered:rows.filter(s=>Number.isFinite(s.foreign5)).length};
sources.prices={name:'TWSE／TPEx 官方收盤與日K',url:'https://openapi.twse.com.tw/',ok:true,checkedAt};
await writeFile(new URL('data/tw-screener.json.gz',root),gzipSync(JSON.stringify({version:1,date,updatedAt:checkedAt,sources,stocks:rows})));
const etfs=['0050','0056','00713','0051','0053','0055','00850'],funds=[];
await Promise.all(etfs.map(async symbol=>{const url=`https://www.yuantaetfs.com/product/detail/${symbol}/ratio`;try{funds.push(parseYuanta(await get(url,'etf'+symbol,true),symbol,url));}catch(error){const previous=oldEtf.funds.find(f=>f.symbol===symbol);if(previous)funds.push({...previous,stale:true});console.log('ETF',symbol,'unavailable');}}));
if(funds.length)await writeFile(new URL('data/tw-etf-holdings.json',root),JSON.stringify({version:1,updatedAt:checkedAt,funds:funds.sort((a,b)=>a.symbol.localeCompare(b.symbol))}));
console.log('Saved',rows.length,'stocks and',funds.length,'funds');
