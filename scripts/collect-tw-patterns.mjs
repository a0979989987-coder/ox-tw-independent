import { gzipSync, gunzipSync } from 'node:zlib';
import { unlinkSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { officialJSON } from '../server/markets/tw/research.js';
import { tradingCalendar } from '../server/markets/tw/surveillance.js';
import { selectUniverse } from '../src/markets/tw/patterns/model.js';
import { parseMarketDay, buildPatternEntry, ALGORITHM_VERSION } from '../server/markets/tw/pattern-snapshot.js';
const run=promisify(execFile);
const official=process.argv.includes('--curl')?async url=>JSON.parse((await run('curl',['--http1.1','-fsSL','--retry','2','--max-time','35',url],{maxBuffer:20000000})).stdout):officialJSON;
const snapshot=JSON.parse(await readFile(new URL('../data/tw-research.json',import.meta.url),'utf8'));
const stocks=selectUniverse(snapshot.stocks,0),companies=new Map(stocks.map(s=>[`${s.market}:${s.symbol}`,s]));
const dir=new URL('../data/tw-patterns/',import.meta.url), cacheDir=new URL('../.tw-pattern-report-cache/',import.meta.url);
await mkdir(dir,{recursive:true});await mkdir(cacheDir,{recursive:true});
const series=new Map(stocks.map(s=>[s.symbol,new Map()]));let prior=null;
try{prior=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));for(const chunk of prior.chunks){const rows=JSON.parse(chunk.file.endsWith('.gz')?gunzipSync(await readFile(new URL(chunk.file,dir))).toString():await readFile(new URL(chunk.file,dir),'utf8'));for(const e of rows.entries)if(series.has(e.data.symbol))for(const c of e.data.candles)series.get(e.data.symbol).set(c.date,c);}}catch{}
const calendar=tradingCalendar(await official('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule'));if(!calendar)throw Error('Official calendar unavailable');
const dates=[],cursor=new Date(snapshot.date+'T00:00:00Z');
for(let i=0;i<366&&dates.length<180;i++){const date=cursor.toISOString().slice(0,10),open=calendar.isOpen(date);if(open===null)break;if(open)dates.push(date);cursor.setUTCDate(cursor.getUTCDate()-1);}
const closed=new Set(prior?.closed||[]);
for(const row of prior?.unavailable||[])for(const c of row.candles||[])series.get(row.symbol)?.set(c.date,c);
const reused=new Set((prior?.dates||[]).filter(d=>d!==snapshot.date));const priorSymbols=new Set((prior?.stocks||[]).map(s=>s.symbol));const newSymbols=stocks.some(s=>!priorSymbols.has(s.symbol));const pending=dates.filter(d=>!closed.has(d)&&(newSymbols||!reused.has(d)));let position=0,historyCutoff=null;
async function report(date,market){
 const file=new URL(`${market}-${date}.json`,cacheDir);try{return JSON.parse(await readFile(file,'utf8'));}catch{}
 const compact=date.replaceAll('-',''),url=market==='TWSE'?`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${compact}&type=ALLBUT0999`:`https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${Number(date.slice(0,4))-1911}%2F${date.slice(5,7)}%2F${date.slice(8)}&se=EW&o=json`;
 let error;for(let i=0;i<6;i++){try{const orders=[`response=json&date=${compact}&type=ALLBUT0999`,`date=${compact}&type=ALLBUT0999&response=json`,`type=ALLBUT0999&response=json&date=${compact}`,`response=json&type=ALLBUT0999&date=${compact}`,`date=${compact}&response=json&type=ALLBUT0999`,`type=ALLBUT0999&date=${compact}&response=json`];const target=market==='TWSE'?url.split('?')[0]+'?'+(i>=3?orders[i].replace('ALLBUT0999','ALL'):orders[i]):url;const payload=await official(target);if(!(market==='TWSE'&&payload.stat==='很抱歉，沒有符合條件的資料!'))parseMarketDay(payload,market,date,companies);await writeFile(file,JSON.stringify(payload));return payload;}catch(e){error=e;await new Promise(r=>setTimeout(r,500*(i+1)));}}
 throw error;
}
await Promise.all(Array.from({length:2},async()=>{while(position<pending.length){const date=pending[position++];if(historyCutoff&&date<=historyCutoff)continue;let listed,otc;try{listed=await report(date,'TWSE');otc=await report(date,'TPEX');}catch(error){if(dates.indexOf(date)<40)throw error;historyCutoff=!historyCutoff||date>historyCutoff?date:historyCutoff;console.warn('Older history unavailable; retaining consecutive verified sessions after '+historyCutoff);continue;}const otcRows=parseMarketDay(otc,'TPEX',date,companies);if(listed.stat==='很抱歉，沒有符合條件的資料!'){if(otcRows.length||date===snapshot.date)throw Error('Unexpected official market closure '+date);closed.add(date);console.log('Official closed '+date);continue;}for(const row of [...parseMarketDay(listed,'TWSE',date,companies),...otcRows])series.get(row.symbol)?.set(date,row.candle);console.log('Official history '+date);}}));
const entries=[],unavailable=[];
for(const stock of stocks){const result=buildPatternEntry(stock,[...series.get(stock.symbol).values()].filter(c=>dates.includes(c.date)&&(!historyCutoff||c.date>historyCutoff)),snapshot.date);if(result.key)entries.push(result);else unavailable.push({...result,candles:[...series.get(stock.symbol).values()].filter(c=>dates.includes(c.date)&&(!historyCutoff||c.date>historyCutoff)).sort((a,b)=>a.time-b.time).slice(-200)});}
if(entries.length<stocks.length*.8)throw Error('Insufficient official history; prior index retained');
const chunks=[];for(let i=0;i<entries.length;i+=100){const file=`daily-${String(i/100).padStart(2,'0')}.json.gz`,rows=entries.slice(i,i+100);await writeFile(new URL(file,dir),gzipSync(JSON.stringify({date:snapshot.date,algorithmVersion:ALGORITHM_VERSION,entries:rows}),{level:9}));chunks.push({file,count:rows.length,symbols:rows.map(e=>e.data.symbol)});}
const manifest={date:snapshot.date,updatedAt:new Date().toISOString(),algorithmVersion:ALGORITHM_VERSION,frame:'1D',total:stocks.length,classified:entries.length,unavailable,dates:dates.filter(d=>!closed.has(d)&&(!historyCutoff||d>historyCutoff)).sort(),closed:[...closed].sort(),chunks,stocks:stocks.map(({symbol,name,market,price,changePct,turnoverTwd})=>({symbol,name,market,price,changePct,turnoverTwd})),source:'TWSE MI_INDEX／TPEx dailyQuotes · 官方日 OHLC · 未還原'};
await writeFile(new URL('manifest.json',dir),JSON.stringify(manifest));
console.log(JSON.stringify({total:stocks.length,classified:entries.length,unavailable:unavailable.length,chunks:chunks.length}));

for(const file of readdirSync(dir))if(/^daily-\d+\.json$/.test(file))unlinkSync(new URL(file,dir));
