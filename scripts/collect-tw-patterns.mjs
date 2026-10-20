import { gzipSync, gunzipSync } from 'node:zlib';
import { unlinkSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { officialJSON } from '../server/markets/tw/research.js';
import { tradingCalendar } from '../server/markets/tw/surveillance.js';
import { selectUniverse, calendarFromSessions } from '../src/markets/tw/patterns/model.js';
import { parseMarketDay, buildPatternEntry, buildHistory, historyTarget, historyFiles, sessionWindow, HISTORY_WEEKS, HISTORY_MONTHS, HISTORY_BUCKETS, HISTORY_FILE_VERSION, ALGORITHM_VERSION } from '../server/markets/tw/pattern-snapshot.js';
import { createHash } from 'node:crypto';
import { boundedAttempts, curlRequest } from '../server/markets/tw/official-attempts.js';
const scriptStarted=Date.now();
const run=promisify(execFile);
// timeoutMs bounds one request; retry=false makes it a single attempt.
const official=process.argv.includes('--curl')
 ?async(url,options)=>{const {args,execTimeoutMs}=curlRequest(url,options);return JSON.parse((await run('curl',args,{maxBuffer:20000000,timeout:execTimeoutMs})).stdout);}
 :(url,{timeoutMs=14000}={})=>officialJSON(url,fetch,{timeoutMs:Math.min(14000,timeoutMs)});
const snapshot=JSON.parse(await readFile(new URL('../data/tw-research.json',import.meta.url),'utf8'));
const stocks=selectUniverse(snapshot.stocks,0),companies=new Map(stocks.map(s=>[`${s.market}:${s.symbol}`,s]));
const dir=new URL('../data/tw-patterns/',import.meta.url), cacheDir=new URL('../.tw-pattern-report-cache/',import.meta.url);
await mkdir(dir,{recursive:true});await mkdir(cacheDir,{recursive:true});
const series=new Map(stocks.map(s=>[s.symbol,new Map()]));let prior=null;
// Weekly/monthly history published by the previous snapshot, per stock.
const priorHistory=new Map();let priorLoaded=false;
try{prior=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));for(const chunk of prior.chunks){const rows=JSON.parse(chunk.file.endsWith('.gz')?gunzipSync(await readFile(new URL(chunk.file,dir))).toString():await readFile(new URL(chunk.file,dir),'utf8'));for(const e of rows.entries){if(e.data.history&&!priorHistory.has(e.data.symbol))priorHistory.set(e.data.symbol,e.data.history);if(series.has(e.data.symbol))for(const c of e.data.candles)series.get(e.data.symbol).set(c.date,c);}}priorLoaded=true;
 // Published history files (read after the chunks, so they take precedence).
 for(const item of prior.history?.files||[]){if(!/^history-\d+\.json\.gz$/.test(item.file))throw Error('history file name');const rows=JSON.parse(gunzipSync(await readFile(new URL(item.file,dir))).toString());if(rows.version!==HISTORY_FILE_VERSION||!Array.isArray(rows.entries))throw Error('history file version');for(const e of rows.entries)priorHistory.set(e.key,e.history);}
}catch{priorLoaded=false;}
const calendar=tradingCalendar(await official('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule'));if(!calendar)throw Error('Official calendar unavailable');
// Newest sessions first; a year the official schedule no longer lists is
// covered by the known session calendar (it does not shrink in January).
const dates=sessionWindow(snapshot.date,{official:calendar,calendar:prior?.sessionCalendar});
const closed=new Set(prior?.closed||[]);
for(const row of prior?.unavailable||[]){if(row.history&&!priorHistory.has(row.symbol))priorHistory.set(row.symbol,row.history);for(const c of row.candles||[])series.get(row.symbol)?.set(c.date,c);}
const reused=new Set((prior?.dates||[]).filter(d=>d!==snapshot.date));const priorSymbols=new Set((prior?.stocks||[]).map(s=>s.symbol));const newSymbols=stocks.some(s=>!priorSymbols.has(s.symbol));const pending=dates.filter(d=>!closed.has(d)&&(newSymbols||!reused.has(d)));let position=0,historyCutoff=null;
// deadline (ms epoch): each attempt gets only the time that is left, and no
// attempt starts once it has passed.
async function report(date,market,{cache=true,attempts=6,deadline=null}={}){
 const file=new URL(`${market}-${date}.json`,cacheDir);if(cache)try{return JSON.parse(await readFile(file,'utf8'));}catch{}
 const compact=date.replaceAll('-',''),url=market==='TWSE'?`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${compact}&type=ALLBUT0999`:`https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${Number(date.slice(0,4))-1911}%2F${date.slice(5,7)}%2F${date.slice(8)}&se=EW&o=json`;
 return boundedAttempts(async(i,options)=>{const orders=[`response=json&date=${compact}&type=ALLBUT0999`,`date=${compact}&type=ALLBUT0999&response=json`,`type=ALLBUT0999&response=json&date=${compact}`,`response=json&type=ALLBUT0999&date=${compact}`,`date=${compact}&response=json&type=ALLBUT0999`,`type=ALLBUT0999&date=${compact}&response=json`];const target=market==='TWSE'?url.split('?')[0]+'?'+(i>=3?orders[i].replace('ALLBUT0999','ALL'):orders[i]):url;const payload=await official(target,options);if(!(market==='TWSE'&&payload.stat==='很抱歉，沒有符合條件的資料!'))parseMarketDay(payload,market,date,companies);if(cache)await writeFile(file,JSON.stringify(payload));return payload;},{attempts,deadline});
}
await Promise.all(Array.from({length:2},async()=>{while(position<pending.length){const date=pending[position++];if(historyCutoff&&date<=historyCutoff)continue;let listed,otc;try{listed=await report(date,'TWSE');otc=await report(date,'TPEX');}catch(error){if(dates.indexOf(date)<40)throw error;historyCutoff=!historyCutoff||date>historyCutoff?date:historyCutoff;console.warn('Older history unavailable; retaining consecutive verified sessions after '+historyCutoff);continue;}const otcRows=parseMarketDay(otc,'TPEX',date,companies);if(listed.stat==='很抱歉，沒有符合條件的資料!'){if(otcRows.length||date===snapshot.date)throw Error('Unexpected official market closure '+date);closed.add(date);console.log('Official closed '+date);continue;}for(const row of [...parseMarketDay(listed,'TWSE',date,companies),...otcRows])series.get(row.symbol)?.set(date,row.candle);console.log('Official history '+date);}}));
// Fixed session numbering for 2/3/5-session bars: carry the verified closure
// list forward, extending it with the official sessions of this window.
// Fixed base (official sessions from the anchor), the prior snapshot's
// calendar, the official holiday schedule (plus recorded closures such as
// typhoon days) for a gap, then this window.
const sessionCalendar=calendarFromSessions([...(prior?.dates||[]),...dates].filter(d=>!closed.has(d)),prior?.sessionCalendar,{official:{isOpen:date=>closed.has(date)?false:calendar.isOpen(date)}});
if(sessionCalendar.through<snapshot.date)console.warn(`Session calendar known through ${sessionCalendar.through}; later 2/3/5-day bars use weekday numbers until it is extended`);
// Weekly/monthly history before the daily window (2W and 1M need years).
// Every weekday from historyFrom onward has been fetched for the stocks that
// were in the universe. Each run extends it backwards within a bounded budget,
// newest session first, so a TWSE/TPEx outage only pauses the back-fill.
const windowDates=dates.filter(d=>!closed.has(d)&&(!historyCutoff||d>historyCutoff)).sort(),windowStart=windowDates[0];
// Coverage is only trusted when every prior chunk was read back.
const priorFrom=prior&&priorLoaded?(prior.historyFrom||prior.dates?.[0]||null):null;
if(!priorFrom)priorHistory.clear();
let historyFrom=priorFrom&&priorFrom<windowStart?priorFrom:windowStart;
const previousDay=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const target=historyTarget(windowStart),budgetDays=Number(process.env.TW_HISTORY_BACKFILL_DAYS||130),deadline=scriptStarted+Number(process.env.TW_HISTORY_BACKFILL_MS||6*60000);
let backfilled=0;
for(let date=previousDay(historyFrom);historyFrom>target&&date>=target&&backfilled<budgetDays&&Date.now()<deadline;date=previousDay(date)){
 if([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())){historyFrom=date;continue;}
 try{
  // Older years are outside the official holiday calendar: TWSE's
  // no-data answer identifies a closed session (TPEx is not queried then).
  const listed=await report(date,'TWSE',{cache:false,attempts:1,deadline});
  if(listed.stat!=='很抱歉，沒有符合條件的資料!'){const otc=await report(date,'TPEX',{cache:false,attempts:1,deadline});for(const row of [...parseMarketDay(listed,'TWSE',date,companies),...parseMarketDay(otc,'TPEX',date,companies)])series.get(row.symbol)?.set(date,row.candle);}
  historyFrom=date;backfilled++;
  await new Promise(r=>setTimeout(r,250));
 }catch(error){console.warn(`History back-fill paused at ${date}: ${error.message}`);break;}
}
if(backfilled)console.log(`History back-filled ${backfilled} sessions; covered from ${historyFrom} (target ${target})`);
const coveredSymbols=new Set([...(prior?.stocks||[]).map(s=>s.symbol),...priorHistory.keys()]);
function stockHistory(stock){
 const previous=priorHistory.get(stock.symbol),known=previous?.from||(coveredSymbols.has(stock.symbol)?priorFrom:null);
 // A stock that joined after the global back-fill passed keeps its own start.
 const from=known&&known===priorFrom?historyFrom:known&&known<windowStart?known:windowStart;
 return buildHistory({daily:[...series.get(stock.symbol).values()],prior:previous,from,windowStart,asOf:snapshot.date,calendar:sessionCalendar});
}
const entries=[],unavailable=[],histories=new Map();
for(const stock of stocks){const history=stockHistory(stock);if(history)histories.set(stock.symbol,history);const result=buildPatternEntry(stock,[...series.get(stock.symbol).values()].filter(c=>dates.includes(c.date)&&(!historyCutoff||c.date>historyCutoff)),snapshot.date,{calendar:sessionCalendar,history});if(result.key)entries.push(result);else unavailable.push({...result,candles:[...series.get(stock.symbol).values()].filter(c=>dates.includes(c.date)&&(!historyCutoff||c.date>historyCutoff)).sort((a,b)=>a.time-b.time).slice(-200)});}
if(entries.length<stocks.length*.8)throw Error('Insufficient official history; prior index retained');
const chunks=[];for(let i=0;i<entries.length;i+=100){const file=`daily-${String(i/100).padStart(2,'0')}.json.gz`,rows=entries.slice(i,i+100);await writeFile(new URL(file,dir),gzipSync(JSON.stringify({date:snapshot.date,algorithmVersion:ALGORITHM_VERSION,entries:rows}),{level:9}));chunks.push({file,count:rows.length,symbols:rows.map(e=>e.data.symbol)});}
// History files are rewritten only when their content changes (weekly or
// monthly, or while the back-fill advances); unchanged files keep their bytes.
const historyIndex=[];
for(const {file,count,symbols,text} of historyFiles(histories)){
 const target=new URL(file,dir);let same=false;
 try{same=gunzipSync(await readFile(target)).toString()===text;}catch{}
 if(!same)await writeFile(target,gzipSync(text,{level:9}));
 historyIndex.push({file,count,hash:createHash('sha256').update(text).digest('hex').slice(0,16)});
 if(!same)console.log('History file updated '+file);
}
const manifest={date:snapshot.date,updatedAt:new Date().toISOString(),algorithmVersion:ALGORITHM_VERSION,frame:'1D',total:stocks.length,classified:entries.length,unavailable,dates:dates.filter(d=>!closed.has(d)&&(!historyCutoff||d>historyCutoff)).sort(),closed:[...closed].sort(),sessionCalendar,historyFrom,history:{weeks:HISTORY_WEEKS,months:HISTORY_MONTHS,target,version:HISTORY_FILE_VERSION,buckets:HISTORY_BUCKETS,frames:['2W','1M'],files:historyIndex},chunks,stocks:stocks.map(({symbol,name,market,price,changePct,turnoverTwd})=>({symbol,name,market,price,changePct,turnoverTwd})),source:'TWSE MI_INDEX／TPEx dailyQuotes · 官方日 OHLC · 未還原'};
await writeFile(new URL('manifest.json',dir),JSON.stringify(manifest));
console.log(JSON.stringify({total:stocks.length,classified:entries.length,unavailable:unavailable.length,chunks:chunks.length,historyFrom,frames:Object.fromEntries(['2W','1M'].map(f=>[f,entries.filter(e=>e.frames[f]).length]))}));

const historyNames=new Set(historyIndex.map(item=>item.file));
for(const file of readdirSync(dir))if(/^daily-\d+\.json$/.test(file)||/^history-\d+\.json\.gz$/.test(file)&&!historyNames.has(file))unlinkSync(new URL(file,dir));
