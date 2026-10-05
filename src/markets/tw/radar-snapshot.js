// Only verified official membership is eligible for an immediate cached view.
const KEY='ox-tw-official-radar-v3',MAX_AGE=7*86400000;
export function validRadarSnapshot(saved,now=Date.now()) {
 const data=saved?.data,meta=data?.modesMeta;
 return !!(Number.isFinite(saved?.savedAt)&&saved.savedAt<=now+60000&&now-saved.savedAt<MAX_AGE
  &&Array.isArray(data?.radar)&&/^\d{4}-\d{2}-\d{2}$/.test(data.dataDate)
  &&meta?.asOf===data.dataDate&&meta?.calendarReady===true
  &&['risk','disposal','release'].every(mode=>meta[mode]?.status==='ready'&&Array.isArray(data.modes?.[mode])));
}
export function savedRadarSnapshot(storage=globalThis.localStorage) {
 try {const saved=JSON.parse(storage?.getItem(KEY)||'null');return validRadarSnapshot(saved)?saved:null;}catch{return null;}
}
export function saveRadarSnapshot(saved,storage=globalThis.localStorage) {
 if(!validRadarSnapshot(saved))return false;
 const previous=savedRadarSnapshot(storage);if(previous?.data.dataDate>saved.data.dataDate)return false;
 try {storage?.setItem(KEY,JSON.stringify(saved));return true;}catch{return false;}
}
let pending,bundled,expiresAt=0;
export function bundledRadarSnapshot() {
 if(bundled&&Date.now()<expiresAt&&validRadarSnapshot(bundled))return Promise.resolve(bundled);
 if(pending)return pending;
 const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),6000);
 pending=fetch(new URL('../../../data/tw-radar.json',import.meta.url),{cache:'no-cache',signal:controller.signal})
  .then(r=>{if(!r.ok)throw Error('官方名單快取未取得');return r.json();})
  .then(saved=>{if(!validRadarSnapshot(saved))throw Error('官方名單快取已過期');bundled=saved;expiresAt=Date.now()+60000;return saved;})
  .finally(()=>{clearTimeout(deadline);pending=null;});
 return pending;
}
