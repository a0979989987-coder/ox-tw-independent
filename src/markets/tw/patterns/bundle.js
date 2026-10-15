import { aggregateCandles, setSessionCalendar, calendarFromSessions } from './model.js';
import { withDeadline } from '../../../components/resource-deadline.js';
import { computeBundleEntry } from './bundle-compute.js';
import { validateBundleEntry } from './qualification.js';
import { createEntryParser } from './chunk-stream.js';
// Official candles and named-pattern classifications are built once on the server.
const manifestURL=new URL('../../../../data/tw-patterns/manifest.json',import.meta.url);
const entries=new Map(),listeners=new Set();let manifest=null,pending=null,checkedAt=0,manifestCheckedAt=0,manifestFetch=null;
export function subscribeBundle(listener){listeners.add(listener);return()=>listeners.delete(listener);}
let notifyTimer;
const notify=()=>{clearTimeout(notifyTimer);notifyTimer=null;for(const listener of listeners){try{listener(bundleState());}catch(error){console.warn('台股資料更新介面失敗',error);}}};
// Publish batches, not a full-market reclassification and DOM rebuild every 8 ms.
const emit=(immediate=false)=>{if(immediate)notify();else notifyTimer??=setTimeout(notify,160);};
// Per revision: chunk job {downloaded, done} and its status
// (downloading → classifying → loaded, or failed).
const chunks=new Map(),chunkStatus=new Map();let counted=null;
const chunkKey=(chunk,next)=>`${next.date}:${next.updatedAt||''}:${chunk.file}`;
const setStatus=(key,value)=>{chunkStatus.set(key,value);counted=null;};
// Snapshot calendar (or one derived from sessions that still reach the anchor)
// fixes the 2/3/5-session grouping for every chart and classification. It is
// derived once per manifest, not again for each of ~1,900 stocks.
const calendars=new WeakMap();
// The fixed base calendar, the snapshot's own calendar and its session dates.
const sessionCalendarOf=next=>{if(!calendars.has(next))calendars.set(next,calendarFromSessions(next.dates,next.sessionCalendar));return calendars.get(next);};
export const CHUNK_IDLE_MS=15000,CHUNK_TOTAL_MS=120000;
// A slow but advancing download is never cut off by a fixed deadline: each
// received block extends the idle limit, bounded by a total limit. Stocks are
// handed over (`onEntry`) as soon as each one has arrived, after the header.
async function streamChunk(chunk,next,{idleMs=CHUNK_IDLE_MS,totalMs=CHUNK_TOTAL_MS}={},{onHeader,onEntry,signal}){
 if(!/^daily-\d+\.json(?:\.gz)?$/.test(chunk.file))throw Error('分類資料路徑異常');
 const controller=new AbortController();let idle,reason=null,reader=null;
 const fail=(message,name='TimeoutError')=>{if(reason)return;reason=signal?.aborted&&signal.reason instanceof Error?signal.reason:new DOMException(message,name);controller.abort(reason);};
 const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>fail('分類資料下載停滯逾時'),idleMs);};
 const total=setTimeout(()=>fail('分類資料載入逾時'),totalMs),cancel=()=>fail('分類資料已取消','AbortError');
 signal?.addEventListener('abort',cancel,{once:true});
 const stopped=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(reason),{once:true}));stopped.catch(()=>{});
 try{
  touch();
  const result=await Promise.race([fetch(new URL(chunk.file+'?date='+next.date+'&revision='+encodeURIComponent(next.updatedAt||''),manifestURL),{cache:'default',signal:controller.signal}),stopped]);
  if(!result.ok)throw Error('分類資料尚未取得');touch();
  const gzip=chunk.file.endsWith('.gz')&&!result.headers?.get?.('content-encoding')?.includes('gzip');
  if(!result.body?.pipeThrough){
   if(gzip)throw Error('分類資料無法解壓');
   const {entries:list,...header}=await Promise.race([result.json(),stopped]);
   if(!Array.isArray(list))throw Error('分類資料日期不符');
   onHeader(header);for(const entry of list)onEntry(entry);return;
  }
  let body=result.body.pipeThrough(new TransformStream({transform(block,out){touch();out.enqueue(block);}}));
  if(gzip)body=body.pipeThrough(new DecompressionStream('gzip'));
  const parser=createEntryParser({onHeader,onEntry}),decoder=new TextDecoder();reader=body.getReader();
  for(;;){const {done,value}=await Promise.race([reader.read(),stopped]);if(done)break;parser.push(decoder.decode(value,{stream:true}));}
  parser.push(decoder.decode());parser.end();
 }catch(error){reader?.cancel().catch(()=>{});throw reason||error;}
 finally{clearTimeout(idle);clearTimeout(total);signal?.removeEventListener('abort',cancel);}
}
// `downloaded` settles when the whole payload has arrived and been verified,
// `done` when every stock is classified. Classification starts with the first
// stock that arrives; a loader can start the next download meanwhile.
function loadChunk(chunk,next,options){
 const key=chunkKey(chunk,next);
 if(chunks.has(key))return chunks.get(key);
 setStatus(key,'downloading');
 const calendar=sessionCalendarOf(next),arrived=[],stop=new AbortController();let wake=null,ended=false,legacyFrames=false;
 const verify=header=>{if(header.date!==next.date||![5,6,7].includes(header.algorithmVersion))throw Error('分類資料日期不符');legacyFrames=header.algorithmVersion<7;};
 const downloaded=streamChunk(chunk,next,options,{onHeader:verify,onEntry:entry=>{arrived.push(entry);wake?.();},signal:stop.signal})
  .then(()=>{setStatus(key,'classifying');emit();})
  .finally(()=>{ended=true;wake?.();});
 const done=(async()=>{
  try{
   for(;;){
    if(arrived.length){
     const e=arrived.shift();validateBundleEntry(e,next.date);
     // 2W/1M wait for their separately published history (loaded on demand).
     const history=histories.get(e.data.symbol),wait=!history&&awaitsHistory(e,next);
     const prepared=await computeBundleEntry({...e,...(history?{data:{...e.data,history}}:{}),calendar,legacyFrames,...(wait?{deferFrames:HISTORY_FRAMES}:{})},next.date);
     entries.set(e.key,{...e,...prepared,legacyFrames,...(wait?{historyFrames:historyFramesOf(e)}:{}),data:{...e.data,...(history?{history}:{}),classic:prepared.classic}});
     if(wait&&histories.has(e.data.symbol))void completeHistoryFrames(e.data.symbol).catch(()=>{});
     emit();continue;
    }
    if(ended)break;
    await new Promise(resolve=>{wake=resolve;});wake=null;
   }
  }catch(error){stop.abort(error);throw error;}
  await downloaded;
  setStatus(key,'loaded');
  if(manifest===next&&next.chunks.every(c=>chunkStatus.get(chunkKey(c,next))==='loaded'))checkedAt=Date.now();
 })();
 const job={downloaded,done};
 downloaded.catch(()=>{});
 done.catch(()=>{if(chunks.get(key)===job){chunks.delete(key);setStatus(key,'failed');}}).finally(()=>emit());
 chunks.set(key,job);return job;
}
// Weekly/monthly history for 2W and 1M is published in its own files
// (history-NN.json.gz, one fixed file per stock), not in the daily chunks. It
// is downloaded only when a 2W or 1M view needs it; until then those frames
// of a stock are not classified (bundleEntry returns null for them).
export const HISTORY_FRAMES=Object.freeze(['2W','1M']);
const histories=new Map(),historySource=new Map(),historyJobs=new Map(),historyStatus=new Map(),completing=new Map(),historyIndexes=new WeakMap();
const HISTORY_FILE=/^history-\d+\.json\.gz$/;
// [{file,hash,count,symbols}] of a manifest; stocks map to files by bucket.
function historyIndexOf(next){
 if(!next)return [];
 if(historyIndexes.has(next))return historyIndexes.get(next);
 const info=next.history,files=Array.isArray(info?.files)&&Number.isInteger(info.buckets)&&info.buckets>0?info.files.filter(item=>HISTORY_FILE.test(item?.file||'')):[];
 if(!files.length){historyIndexes.set(next,[]);return [];}
 const byFile=new Map(files.map(item=>[item.file,{file:item.file,hash:String(item.hash||''),count:item.count||0,symbols:[]}]));
 for(const stock of next.stocks||[])if(/^\d{4}$/.test(stock.symbol))byFile.get(`history-${String(Number(stock.symbol)%info.buckets).padStart(2,'0')}.json.gz`)?.symbols.push(stock.symbol);
 const index=[...byFile.values()];historyIndexes.set(next,index);return index;
}
const historyKey=item=>`${item.file}:${item.hash}`;
export const hasBundleHistory=()=>historyIndexOf(manifest).length>0;
const historyFramesOf=e=>Object.fromEntries(HISTORY_FRAMES.filter(frame=>e.frames?.[frame]).map(frame=>[frame,e.frames[frame]]));
const awaitsHistory=(e,next)=>!e.data.history&&HISTORY_FRAMES.some(frame=>e.frames?.[frame])&&historyIndexOf(next).length>0;
// A new manifest keeps history whose file content (hash) is unchanged.
function pruneHistories(next){
 const keep=new Set(historyIndexOf(next).map(historyKey));
 for(const [symbol,key]of historySource)if(!keep.has(key)){historySource.delete(symbol);histories.delete(symbol);}
 for(const key of [...historyStatus.keys()])if(!keep.has(key)){historyStatus.delete(key);historyJobs.delete(key);}
}
// Classify the deferred 2W/1M frames of a loaded stock once its history is in.
function completeHistoryFrames(symbol){
 const key=symbol+':1D',entry=entries.get(key),history=histories.get(symbol);
 if(!entry?.historyFrames||!history)return Promise.resolve();
 if(completing.has(symbol))return completing.get(symbol);
 const job=(async()=>{
  const {historyFrames,...rest}=entry;
  const prepared=await computeBundleEntry({...rest,data:{...entry.data,history},frames:historyFrames,onlyFrames:HISTORY_FRAMES,calendar:sessionCalendarOf(manifest)||null,legacyFrames:entry.legacyFrames===true},entry.data.dataDate);
  if(entries.get(key)!==entry)return;
  entries.set(key,{...rest,frames:{...entry.frames,...prepared.frames},data:{...entry.data,history}});emit();
 })().finally(()=>completing.delete(symbol));
 completing.set(symbol,job);return job;
}
// Whole file, with the same progress-based timeout as the daily chunks.
async function readHistoryFile(item,{idleMs=CHUNK_IDLE_MS,totalMs=CHUNK_TOTAL_MS}={}){
 if(!HISTORY_FILE.test(item.file))throw Error('歷史資料路徑異常');
 const controller=new AbortController();let idle,reason=null;
 const fail=message=>{if(reason)return;reason=new DOMException(message,'TimeoutError');controller.abort(reason);};
 const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>fail('歷史資料下載停滯逾時'),idleMs);};
 const total=setTimeout(()=>fail('歷史資料載入逾時'),totalMs);
 const stopped=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(reason),{once:true}));stopped.catch(()=>{});
 try{
  touch();
  const response=await Promise.race([fetch(new URL(item.file+'?h='+encodeURIComponent(item.hash),manifestURL),{cache:'default',signal:controller.signal}),stopped]);
  if(!response.ok)throw Error('歷史資料尚未取得');touch();
  const gzip=!response.headers?.get?.('content-encoding')?.includes('gzip');let text;
  if(response.body?.pipeThrough){
   let body=response.body.pipeThrough(new TransformStream({transform(block,out){touch();out.enqueue(block);}}));
   if(gzip)body=body.pipeThrough(new DecompressionStream('gzip'));
   text=await Promise.race([new Response(body).text(),stopped]);
  }else{if(gzip)throw Error('歷史資料無法解壓');text=await Promise.race([response.text(),stopped]);}
  const payload=JSON.parse(text);
  if(payload?.version!==1||!Array.isArray(payload.entries))throw Error('歷史資料版本不符');
  return payload;
 }catch(error){throw reason||error;}
 finally{clearTimeout(idle);clearTimeout(total);}
}
// downloaded → classifying (deferred frames of loaded stocks) → loaded / failed.
function loadHistoryFile(item,options){
 const key=historyKey(item);
 if(historyJobs.has(key))return historyJobs.get(key);
 historyStatus.set(key,'downloading');
 const downloaded=readHistoryFile(item,options).then(payload=>{
  for(const row of payload.entries)if(/^\d{4}$/.test(row?.key||'')&&row.history&&typeof row.history==='object'){histories.set(row.key,row.history);historySource.set(row.key,key);}
  historyStatus.set(key,'classifying');emit();return payload;
 });
 const done=downloaded.then(async payload=>{
  for(const row of payload.entries)await completeHistoryFrames(row.key);
  historyStatus.set(key,'loaded');
 });
 const job={downloaded,done};
 downloaded.catch(()=>{});
 done.catch(()=>{if(historyJobs.get(key)===job){historyJobs.delete(key);historyStatus.set(key,'failed');}}).finally(()=>emit());
 historyJobs.set(key,job);return job;
}
// The current manifest's history files with their status (for a scheduler).
export function bundleHistoryChunks(){return historyIndexOf(manifest).map(item=>({file:item.file,count:item.count,symbols:item.symbols,status:historyStatus.get(historyKey(item))||'idle'}));}
export function bundleHistoryStatus(file){const item=historyIndexOf(manifest).find(item=>item.file===file);return item?historyStatus.get(historyKey(item))||'idle':'idle';}
// Same contract as ensureBundleChunks, for the history files of these symbols.
export async function ensureHistoryChunks(symbols,{signal,stage='loaded',idleMs,totalMs}={}){
 await ensureBundleManifest({signal});
 const files=historyIndexOf(manifest),wanted=new Set(symbols||[]);
 const targets=symbols==null?files:files.filter(item=>item.symbols.some(symbol=>wanted.has(symbol)));
 const jobs=targets.map(item=>loadHistoryFile(item,{idleMs,totalMs}));
 const settled=await abortable(Promise.allSettled(jobs.map(job=>stage==='downloaded'?job.downloaded:job.done)),signal);
 return {files:targets.map(item=>item.file),failed:targets.flatMap((item,i)=>settled[i].status==='rejected'?[item.file]:[]),errors:settled.flatMap(result=>result.status==='rejected'?[result.reason]:[])};
}
// bundleState() is read per stock by the board; the counts are cached.
function chunkCounts(){
 if(counted?.manifest===manifest)return counted;
 const counts={total:manifest?.chunks?.length||0,loaded:0,failed:0,downloading:0,classifying:0};let failedStocks=0;
 for(const chunk of manifest?.chunks||[]){const status=chunkStatus.get(chunkKey(chunk,manifest));if(status in counts)counts[status]++;if(status==='failed')failedStocks+=chunk.count;}
 return counted={manifest,counts,failedStocks};
}
export function bundleState(){const {counts,failedStocks}=chunkCounts();return {date:manifest?.date,revision:manifest?.updatedAt,total:manifest?.total||0,expected:manifest?.classified||0,dates:manifest?.dates||[],classified:entries.size,unavailable:manifest?.unavailable||[],stocks:manifest?.stocks||[],failed:failedStocks,loading:!!pending||!!manifestFetch||counts.downloading+counts.classifying>0,chunks:{...counts}};}
// The manifest alone (stock list, chunk map, calendar), shared by concurrent callers.
function fetchManifest(){
 return manifestFetch??=withDeadline(async signal=>{const response=await fetch(manifestURL,{cache:'no-cache',signal});if(!response.ok)throw Error('全市場分類索引更新中');return response.json();},8000,'分類索引載入逾時')
  .then(next=>{if(![5,6,7].includes(next.algorithmVersion)||!Array.isArray(next.chunks)||!next.date)throw Error('分類索引版本不符');manifestCheckedAt=Date.now();return next;})
  .finally(()=>{manifestFetch=null;});
}
function applyManifest(next){
 pruneHistories(next);
 if(manifest?.date!==next.date||manifest?.updatedAt!==next.updatedAt){
  chunks.clear();const prefix=`${next.date}:${next.updatedAt||''}:`;for(const key of chunkStatus.keys())if(!key.startsWith(prefix))chunkStatus.delete(key);counted=null;
 }
 manifest=next;counted=null;setSessionCalendar(sessionCalendarOf(next));
 for(const [key,e]of entries)if(e.data.dataDate!==next.date)entries.delete(key);
}
const aborted=()=>new DOMException('Aborted','AbortError');
function abortable(promise,signal){
 if(!signal)return promise;if(signal.aborted)return Promise.reject(aborted());
 return new Promise((resolve,reject)=>{const stop=()=>reject(aborted());signal.addEventListener('abort',stop,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});
}
// Manifest only: no chunk is downloaded. Rechecked at most every 5 minutes.
export function ensureBundleManifest({force=false,signal}={}){
 if(signal?.aborted)return Promise.reject(aborted());
 if(!force&&manifest&&Date.now()-manifestCheckedAt<300000)return Promise.resolve(bundleState());
 const job=fetchManifest().then(next=>{applyManifest(next);emit(true);return bundleState();});
 return abortable(job,signal);
}
// Load status of one chunk of the current manifest (constant time).
export function bundleChunkStatus(file){return manifest?chunkStatus.get(`${manifest.date}:${manifest.updatedAt||''}:${file}`)||'idle':'idle';}
// The current manifest's chunks with their load status (for a scheduler).
export function bundleChunks(){
 const next=manifest;if(!next)return [];
 return next.chunks.map(chunk=>({file:chunk.file,count:chunk.count,symbols:Array.isArray(chunk.symbols)?chunk.symbols:null,status:chunkStatus.get(chunkKey(chunk,next))||'idle'}));
}
// Load only the chunks holding these symbols. `stage:'downloaded'` resolves
// once each payload is verified (classification continues). Failed chunks are
// reported, not thrown; a later call downloads them again.
export async function ensureBundleChunks(symbols,{signal,stage='loaded',idleMs,totalMs}={}){
 await ensureBundleManifest({signal});
 const next=manifest,wanted=new Set(symbols||[]);
 if(!next.chunks.every(chunk=>Array.isArray(chunk.symbols))){
  // Older manifests do not map stocks to chunks: load all with the bounded preloader.
  await abortable(preloadBundle(),signal);
  return {files:next.chunks.map(chunk=>chunk.file),failed:bundleChunks().filter(chunk=>chunk.status==='failed').map(chunk=>chunk.file),errors:[]};
 }
 const targets=next.chunks.filter(chunk=>chunk.symbols.some(symbol=>wanted.has(symbol)));
 const jobs=targets.map(chunk=>loadChunk(chunk,next,{idleMs,totalMs}));
 const settled=await abortable(Promise.allSettled(jobs.map(job=>stage==='downloaded'?job.downloaded:job.done)),signal);
 const failed=targets.flatMap((chunk,i)=>settled[i].status==='rejected'?[chunk.file]:[]);
 return {files:targets.map(chunk=>chunk.file),failed,errors:settled.flatMap(result=>result.status==='rejected'?[result.reason]:[])};
}
export function awaitBundleManifest(signal){
 if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
 const job=preloadBundle();
 return new Promise((resolve,reject)=>{
  let unsubscribe=()=>{};
  const finish=(error)=>{unsubscribe();signal?.removeEventListener('abort',abort);error?reject(error):resolve(bundleState());};
  const abort=()=>finish(new DOMException('Aborted','AbortError'));
  const check=()=>{if(bundleState().date&&bundleState().stocks.length)finish();};
  unsubscribe=subscribeBundle(check);signal?.addEventListener('abort',abort,{once:true});check();
  job.then(()=>{if(bundleState().date&&bundleState().stocks.length)finish();else finish(Error('官方台股觀察池尚未取得'));},finish);
 });
}
export function bundleEntry(symbol,frame='1D',date){const base=entries.get(symbol+':1D');if(!base||date&&base.data.dataDate!==date)return null;if(frame==='1D')return base;const prepared=base.frames?.[frame];if(!prepared)return null;return {key:symbol+':'+frame,data:{...base.data,frame,candles:aggregateCandles(base.data.candles,frame,base.data.dataDate,Date.now(),{history:base.data.history,legacy:base.legacyFrames===true}),classic:prepared.classic},matches:prepared.matches,classic:prepared.classic};}
// Open the requested stock as soon as its verified chunk arrives. The rest of
// the market continues loading in the background for the screener.
export async function awaitBundleSymbol(symbol,signal){
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(bundleEntry(symbol,'1D'))return;
 // A selected stock gets its own shared chunk immediately. It never waits for
 // all 1,900 stocks or unrelated failed chunks to finish.
 await awaitBundleManifest(signal);
 const next=manifest,chunk=next.chunks.find(chunk=>chunk.symbols?.includes(symbol));
 if(chunk){await withDeadline(()=>loadChunk(chunk,next).done,13000,'股票歷史載入逾時',{signal});return;}
 if(next.unavailable?.some(row=>row.symbol===symbol)||next.chunks.every(chunk=>Array.isArray(chunk.symbols)))return;
 // Compatibility with older manifests that do not map stocks to chunks.
 await withDeadline(waitSignal=>new Promise((resolve,reject)=>{
  let off=()=>{};const finish=error=>{off();waitSignal.removeEventListener('abort',abort);error?reject(error):resolve();};
  const abort=()=>finish(new DOMException('Aborted','AbortError'));
  off=subscribeBundle(()=>{if(bundleEntry(symbol,'1D'))finish();});
  waitSignal.addEventListener('abort',abort,{once:true});
  if(bundleEntry(symbol,'1D'))finish();
  preloadBundle().then(()=>finish(),finish);
 }),15000,'股票歷史載入逾時',{signal});
}
export function bundleClassification(symbol,frame='1D',date){return bundleEntry(symbol,frame,date);}
export function bundleEntries(frames=['1D'],date){return [...entries.values()].filter(e=>frames.includes(e.data.frame)&&(!date||e.data.dataDate===date));}
// Whole market, two chunks at a time, in manifest order (radar, bubbles,
// after-close refresh). The pattern board schedules chunks itself.
export async function preloadBundle({force=false,silent=false}={}){
 if(pending)return pending;if(!force&&manifest&&Date.now()-checkedAt<300000)return bundleState();
 const loading=silent?null:globalThis.OXLoading?.begin('tw','載入台股標的',{views:['radar','strength']});
 pending=(async()=>{
  const next=await fetchManifest();
  if(manifest?.date===next.date&&manifest?.updatedAt===next.updatedAt&&!bundleState().failed&&entries.size===next.classified){checkedAt=Date.now();return bundleState();}
  applyManifest(next);
  emit(true);
  loading?.update(entries.size,next.classified);
  let cursor=0;await Promise.all(Array.from({length:2},async()=>{while(cursor<next.chunks.length){
   const chunk=next.chunks[cursor++];try{
    await loadChunk(chunk,next).done;
   }catch{}loading?.update(entries.size+bundleState().failed,next.classified);emit();
  }}));checkedAt=bundleState().failed?0:Date.now();return bundleState();
 })().finally(()=>{pending=null;loading?.finish();emit(true);});
 emit();return pending;
}
