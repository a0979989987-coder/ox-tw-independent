import {dailyCandles} from './patterns/model.js';
import {twProvider} from './api.js?v=20261005-recovery20';

export const HISTORY_START=Object.freeze({TWSE:'2010-01-01',TPEX:'1994-01-01'});
const records=new Map();
const abort=signal=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
export const previousDate=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
export function historyRange(cursor,floor){
 const end=new Date(cursor+'T00:00:00Z');
 const start=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-2,1)).toISOString().slice(0,10);
 return {from:start<floor?floor:start,to:cursor};
}
export function mergeDailyHistory(older,newer,asOf){return dailyCandles([...older,...newer],asOf);}
export function preserveHistoryViewport(previous,next,range){
 if(!range||!previous.length||!next.length)return range;
 const anchor=Math.min(previous.length-1,Math.max(0,Math.floor(range.from)));
 const index=next.findIndex(c=>c.time===previous[anchor].time);
 if(index<0)return range;
 const shift=index-anchor;return {from:range.from+shift,to:range.to+shift};
}

// Cache only official, validated bars. Browser storage is optional; a quota or
// private-browsing restriction must not stop viewing or loading history.
let database;
function openDatabase(){
 if(typeof indexedDB==='undefined')return Promise.resolve(null);
 return database??=(new Promise(resolve=>{const request=indexedDB.open('ox-tw-independent:ox-tw-chart-history',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('history',{keyPath:'key'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null);
 }));
}
async function readStored(key){try{const db=await openDatabase();if(!db)return null;return await new Promise(resolve=>{const request=db.transaction('history').objectStore('history').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);});}catch{return null;}}
async function writeStored(record){try{const db=await openDatabase();if(!db)return;const value={version:1,key:record.key,symbol:record.symbol,market:record.market,asOf:record.asOf,cursor:record.cursor,coverageStart:record.coverageStart,complete:record.complete,daily:record.daily,savedAt:Date.now()};
 await new Promise(resolve=>{const transaction=db.transaction('history','readwrite'),store=transaction.objectStore('history');store.put(value);
  const request=store.getAll();request.onsuccess=()=>{for(const row of request.result.sort((a,b)=>b.savedAt-a.savedAt).slice(30))store.delete(row.key);};
  transaction.oncomplete=resolve;transaction.onerror=resolve;transaction.onabort=resolve;
 });
 }catch{}}

// Optional browser storage must never hold an already verified chart open.
function readStoredWithinBudget(key){
 return new Promise(resolve=>{
  const timer=setTimeout(()=>resolve(null),1000);
  readStored(key).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(null);});
 });
}
export async function chartHistory(symbol,market,asOf,seed=[],signal){
 abort(signal);if(!/^\d{4}$/.test(symbol)||!HISTORY_START[market]||!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('股票歷史資料識別尚未取得');
 const key=`${symbol}:${market}:${asOf}`;let record=records.get(key);
 if(!record){const stored=await readStoredWithinBudget(key);abort(signal);
  record={key,symbol,market,asOf,floor:HISTORY_START[market],cursor:asOf,coverageStart:seed[0]?.date||asOf,daily:dailyCandles(seed,asOf),complete:false,pending:null,error:null};
  if(stored?.version===1&&stored.symbol===symbol&&stored.market===market&&stored.asOf===asOf&&stored.coverageStart>=record.floor&&stored.coverageStart<=asOf&&stored.cursor===previousDate(stored.coverageStart)&&stored.complete===(stored.coverageStart===record.floor)&&Array.isArray(stored.daily)){
   record.daily=mergeDailyHistory(stored.daily,record.daily,asOf);record.cursor=stored.cursor;record.coverageStart=stored.coverageStart;record.complete=stored.complete;
  }
  records.set(key,record);if(records.size>30)records.delete(records.keys().next().value);
 }else record.daily=mergeDailyHistory(record.daily,seed,asOf);
 return record;
}

export async function loadHistoryPage(record,signal,fetchPage=options=>twProvider.getCandles(record.symbol,options)){
 abort(signal);if(record.complete)return record;
 if(record.pending){try{await record.pending;abort(signal);return record;}catch(error){abort(signal);if(error.name!=='AbortError')throw error;}}
 const range=historyRange(record.cursor,record.floor);record.error=null;
 record.pending=(async()=>{
  const page=await fetchPage({...range,interval:'1D',adjusted:false,history:true,signal,timeoutMs:45000});abort(signal);
  if(page?.symbol!==record.symbol||page.market!==record.market||page.from!==range.from||page.to!==range.to||page.adjusted!==false||page.meta?.historyPage!==true||page.meta?.earliestAvailableDate!==record.floor||!Array.isArray(page.candles))throw Error('官方歷史資料回應範圍不符');
  const rows=dailyCandles(page.candles,record.asOf);
  if(rows.some(c=>c.date<range.from||c.date>range.to))throw Error('官方歷史資料日期超出查詢範圍');
  // The official page wins for overlapping dates. Empty, successful pages
  // advance the cursor; an outage must never mark the history complete.
  record.daily=mergeDailyHistory(record.daily,rows,record.asOf);
  record.coverageStart=range.from;record.cursor=previousDate(range.from);record.complete=range.from===record.floor;
  await writeStored(record);return record;
 })().catch(error=>{abort(signal);if(error.name!=='AbortError')record.error=error;throw error;}).finally(()=>{record.pending=null;});
 return record.pending;
}
