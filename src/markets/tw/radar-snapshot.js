import {fetchWithProgress} from '../../components/progress-fetch.js';
// Only verified official membership is eligible for an immediate cached view.
const KEY='ox-tw-independent:ox-tw-official-radar-v3',MAX_AGE=7*86400000;
export function completeRadarMembership(data){
 const meta=data?.modesMeta;
 return !!(Array.isArray(data?.radar)&&/^\d{4}-\d{2}-\d{2}$/.test(data.dataDate)
  &&meta?.asOf===data.dataDate&&meta?.calendarReady===true
  &&['risk','disposal','release'].every(mode=>meta[mode]?.status==='ready'&&Array.isArray(data.modes?.[mode])));
}
export function validRadarSnapshot(saved,now=Date.now()) {
 return !!(Number.isFinite(saved?.savedAt)&&saved.savedAt<=now+60000&&now-saved.savedAt<MAX_AGE
  &&completeRadarMembership(saved?.data));
}
// With site data blocked, reading `localStorage` itself throws (SecurityError),
// so a default parameter must not touch it outside a try.
function localStore(){try{return globalThis.localStorage;}catch{return null;}}
export function savedRadarSnapshot(storage=localStore()) {
 try {const saved=JSON.parse(storage?.getItem(KEY)||'null');return validRadarSnapshot(saved)?saved:null;}catch{return null;}
}
export function saveRadarSnapshot(saved,storage=localStore()) {
 if(!validRadarSnapshot(saved)||!storage)return false;
 const previous=savedRadarSnapshot(storage);if(previous?.data.dataDate>saved.data.dataDate)return false;
 try {storage?.setItem(KEY,JSON.stringify(saved));return true;}catch{return false;}
}
let pending,bundled,expiresAt=0,status='idle';
// The HTML preloads this exact URL (same mode/credentials/cache) so the request
// starts with the page instead of after the runtime downloads.
export function radarSnapshotURL(doc=globalThis.document) {
 const link=doc?.querySelector?.('link[rel="preload"][data-tw-radar]');
 return link?.href||new URL('../../../data/tw-radar.json',import.meta.url).href;
}
export function radarSnapshotStatus(){return status;}
export function bundledRadarSnapshot({idleMs=8000,totalMs=60000}={}) {
 if(bundled&&Date.now()<expiresAt&&validRadarSnapshot(bundled))return Promise.resolve(bundled);
 if(pending)return pending;
 status='pending';
 pending=fetchWithProgress(radarSnapshotURL(),{idleMs,totalMs,init:{mode:'cors',credentials:'same-origin'}})
  .then(({response,text})=>{if(!response.ok)throw Error('官方名單快取未取得');return JSON.parse(text);})
  .then(saved=>{if(!validRadarSnapshot(saved))throw Error('官方名單快取已過期');bundled=saved;expiresAt=Date.now()+60000;status='ready';return saved;})
  .catch(error=>{status='failed';throw error;})
  .finally(()=>{pending=null;});
 return pending;
}

// First-screen cache in IndexedDB. Only the official risk/disposal/release
// lists (with their membership metadata) are kept: the radar opens on those
// lists, while the complete 1,900-stock quote list always comes from the
// published snapshot or the API. Reads are asynchronous and never block the
// first paint; any IndexedDB failure simply means no cache.
const IDB_NAME='ox-tw-independent',IDB_STORE='first-screen',IDB_KEY='radar-modes-v1';
export function firstScreenSnapshot(saved){
 if(!validRadarSnapshot(saved))return null;
 const {modes,modesMeta,dataDate}=saved.data;
 return {savedAt:saved.savedAt,slim:true,data:{dataDate,modesMeta,modes:{risk:modes.risk,disposal:modes.disposal,release:modes.release}}};
}
export function validFirstScreenSnapshot(saved,now=Date.now()){
 return saved?.slim===true&&Number.isFinite(saved.savedAt)&&saved.savedAt<=now+60000&&now-saved.savedAt<MAX_AGE
  &&completeRadarMembership({...saved.data,radar:[]});
}
let dbJob=null;
function openFirstScreenDB(idb=globalThis.indexedDB){
 if(!idb)return Promise.reject(Error('IndexedDB unavailable'));
 return dbJob??=new Promise((resolve,reject)=>{
  const request=idb.open(IDB_NAME,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(IDB_STORE);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('IndexedDB blocked'));
 }).catch(error=>{dbJob=null;throw error;});
}
function idbRequest(mode,operate,timeoutMs=2000){
 return openFirstScreenDB().then(db=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('IndexedDB timeout')),timeoutMs);
  const tx=db.transaction(IDB_STORE,mode),request=operate(tx.objectStore(IDB_STORE));
  tx.oncomplete=()=>{clearTimeout(timer);resolve(request.result);};
  tx.onerror=tx.onabort=()=>{clearTimeout(timer);reject(tx.error||Error('IndexedDB failed'));};
 }));
}
let removedLegacy=false;
function removeLegacyCache(storage=localStore()){
 // The old 2.3 MB localStorage copy was parsed synchronously on every start.
 if(removedLegacy)return;removedLegacy=true;
 try{storage?.removeItem(KEY);}catch{}
}
export async function readCachedRadar(){
 removeLegacyCache();
 try{const saved=await idbRequest('readonly',store=>store.get(IDB_KEY));return validFirstScreenSnapshot(saved)?saved:null;}
 catch{return null;}
}
let lastWritten='';
export async function writeCachedRadar(saved){
 const slim=saved?.slim?saved:firstScreenSnapshot(saved);
 if(!validFirstScreenSnapshot(slim))return false;
 const stamp=slim.data.dataDate+':'+slim.savedAt;if(stamp===lastWritten)return false;
 try{
  const previous=await idbRequest('readonly',store=>store.get(IDB_KEY));
  if(validFirstScreenSnapshot(previous)&&previous.data.dataDate>slim.data.dataDate)return false;
  await idbRequest('readwrite',store=>store.put(slim,IDB_KEY));lastWritten=stamp;return true;
 }catch{return false;}
}
