import { aggregateCandles } from './model.js';
import { withDeadline } from '../../../components/resource-deadline.js';
import { readJSONBody } from '../../../components/json-body.js';
import { computeBundleEntry } from './bundle-compute.js';
import { validateBundleEntry } from './qualification.js';
// Official candles and named-pattern classifications are built once on the server.
const manifestURL=new URL('../../../../data/tw-patterns/manifest.json',import.meta.url);
const entries=new Map(),listeners=new Set();let manifest=null,pending=null,checkedAt=0,failed=0;
export function subscribeBundle(listener){listeners.add(listener);return()=>listeners.delete(listener);}
let notifyTimer;
const notify=()=>{clearTimeout(notifyTimer);notifyTimer=null;for(const listener of listeners){try{listener(bundleState());}catch(error){console.warn('台股資料更新介面失敗',error);}}};
// Publish batches, not a full-market reclassification and DOM rebuild every 8 ms.
const emit=(immediate=false)=>{if(immediate)notify();else notifyTimer??=setTimeout(notify,160);};
const chunks=new Map();
async function loadChunk(chunk,next){
 const key=`${next.date}:${next.updatedAt||''}:${chunk.file}`;
 if(chunks.has(key))return chunks.get(key);
 const job=(async()=>{
  if(!/^daily-\d+\.json(?:\.gz)?$/.test(chunk.file))throw Error('分類資料路徑異常');
  const payload=await withDeadline(async signal=>{const result=await fetch(new URL(chunk.file+'?date='+next.date+'&revision='+encodeURIComponent(next.updatedAt||''),manifestURL),{cache:'default',signal});if(!result.ok)throw Error('分類資料尚未取得');return readJSONBody(result);},12000,'分類資料載入逾時');
  if(payload.date!==next.date||![5,6].includes(payload.algorithmVersion)||!Array.isArray(payload.entries))throw Error('分類資料日期不符');
  for(const e of payload.entries){
   validateBundleEntry(e,next.date);
   const prepared=await computeBundleEntry(e,next.date);
   entries.set(e.key,{...e,...prepared,data:{...e.data,classic:prepared.classic}});
   emit();
  }
 })().catch(error=>{chunks.delete(key);throw error;}).finally(()=>emit());
 chunks.set(key,job);return job;
}
export function bundleState(){return {date:manifest?.date,revision:manifest?.updatedAt,total:manifest?.total||0,expected:manifest?.classified||0,dates:manifest?.dates||[],classified:entries.size,unavailable:manifest?.unavailable||[],stocks:manifest?.stocks||[],failed,loading:!!pending};}
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
export function bundleEntry(symbol,frame='1D',date){const base=entries.get(symbol+':1D');if(!base||date&&base.data.dataDate!==date)return null;if(frame==='1D')return base;const prepared=base.frames?.[frame];if(!prepared)return null;return {key:symbol+':'+frame,data:{...base.data,frame,candles:aggregateCandles(base.data.candles,frame,base.data.dataDate),classic:prepared.classic},matches:prepared.matches,classic:prepared.classic};}
// Open the requested stock as soon as its verified chunk arrives. The rest of
// the market continues loading in the background for the screener.
export async function awaitBundleSymbol(symbol,signal){
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(bundleEntry(symbol,'1D'))return;
 // A selected stock gets its own shared chunk immediately. It never waits for
 // all 1,900 stocks or unrelated failed chunks to finish.
 await awaitBundleManifest(signal);
 const next=manifest,chunk=next.chunks.find(chunk=>chunk.symbols?.includes(symbol));
 if(chunk){await withDeadline(()=>loadChunk(chunk,next),13000,'股票歷史載入逾時',{signal});return;}
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
export async function preloadBundle({force=false,silent=false}={}){
 if(pending)return pending;if(!force&&manifest&&Date.now()-checkedAt<300000)return bundleState();
 const loading=silent?null:globalThis.OXLoading?.begin('tw','載入台股標的',{views:['radar','strength']});
 pending=(async()=>{
  const next=await withDeadline(async signal=>{const response=await fetch(manifestURL,{cache:'no-cache',signal});if(!response.ok)throw Error('全市場分類索引更新中');return response.json();},8000,'分類索引載入逾時');
  if(![5,6].includes(next.algorithmVersion)||!Array.isArray(next.chunks)||!next.date)throw Error('分類索引版本不符');
  if(manifest?.date===next.date&&manifest?.updatedAt===next.updatedAt&&!failed&&entries.size===next.classified){checkedAt=Date.now();return bundleState();}
  if(manifest?.date!==next.date||manifest?.updatedAt!==next.updatedAt)chunks.clear();
  manifest=next;failed=0;
  for(const [key,e]of entries)if(e.data.dataDate!==next.date)entries.delete(key);
  emit(true);
  loading?.update(entries.size,next.classified);
  let cursor=0;await Promise.all(Array.from({length:2},async()=>{while(cursor<next.chunks.length){
   const chunk=next.chunks[cursor++];try{
    await loadChunk(chunk,next);
   }catch{failed+=chunk.count;}loading?.update(entries.size+failed,next.classified);emit();
  }}));checkedAt=failed?0:Date.now();return bundleState();
 })().finally(()=>{pending=null;loading?.finish();emit(true);});
 emit();return pending;
}
