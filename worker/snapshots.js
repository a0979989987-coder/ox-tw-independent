import {completeRadarMembership} from '../src/markets/tw/radar-snapshot.js';
import {acceptHomeSection,withOfficialTaiwanClose} from '../src/markets/tw/home-model.js';
const repository='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
const memo=new Map(),pending=new Map();
// Only this independent repository's public data can be read. No caller-supplied URL.
export async function readSnapshotAsset(path,assets,{fetcher=fetch,now=Date.now()}={}){
 if(!/^data\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:json|json\.gz)$/.test(path)||path.includes('..'))throw Error('Invalid snapshot path');
 const old=memo.get(path);if(old&&now-old.time<60000)return old.bytes;
 if(pending.has(path))return pending.get(path);
 const job=(async()=>{
  try{
   const response=await fetcher(repository+path,{signal:AbortSignal.timeout(6000),headers:{Accept:'application/octet-stream'}});
   if(!response.ok)throw Error('Independent snapshot unavailable');
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>20000000||!bytes.length)throw Error('Invalid snapshot size');
   if(path.endsWith('.json'))JSON.parse(new TextDecoder().decode(bytes));
   if(memo.size>=40)memo.delete(memo.keys().next().value);memo.set(path,{time:now,bytes});return bytes;
  }catch{
   if(old)return old.bytes;
   const response=await assets.fetch(new Request('https://assets.local/'+path));
   if(!response.ok)throw Error('Saved snapshot unavailable');return new Uint8Array(await response.arrayBuffer());
  }
 })().finally(()=>pending.delete(path));pending.set(path,job);return job;
}
// Pre-compressed .json.gz is sent as application/gzip with no Content-Encoding:
// the CDN leaves that type alone and the browser hands the gzip bytes to the
// page, which decompresses them itself. Labelling it application/json let the
// CDN wrap a second gzip layer around it, so the page received gzip bytes.
const etags=new WeakMap();
async function etagOf(bytes){
 if(!etags.has(bytes)){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));etags.set(bytes,'W/"'+[...digest.slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join('')+'"');}
 return etags.get(bytes);
}
export async function snapshotAssetResponse(path,request,assets,options){
 const bytes=await readSnapshotAsset(path,assets,options),gzip=path.endsWith('.gz');
 if(gzip&&(bytes[0]!==0x1f||bytes[1]!==0x8b))throw Error('Invalid gzip snapshot');
 const headers={'Content-Type':gzip?'application/gzip':'application/json','Cache-Control':'public, max-age=0, must-revalidate','ETag':await etagOf(bytes)};
 if(request.headers.get('If-None-Match')===headers.ETag)return new Response(null,{status:304,headers});
 return new Response(bytes,{headers});
}
export async function snapshotEndpoint(endpoint,params,read){
 if(!['radar','home','research'].includes(endpoint))return null;
 const snapshot=await read(`data/tw-${endpoint}.json`);
 if(endpoint==='radar'){
  if(!completeRadarMembership(snapshot.data))throw Error('Official membership incomplete');
  const market=(params.get('market')||'ALL').toUpperCase(),tier=(params.get('tier')||'ALL').toUpperCase();
  const limit=Math.min(2000,Math.max(1,Number(params.get('limit'))||500));
  const rows=snapshot.data.radar.filter(row=>(market==='ALL'||row.market===market)&&(tier==='ALL'||row.tier===tier));
  const sort=params.get('sort')||'oxScore',keys={oxScore:'oxScore',turnover:'turnover',turnoverTwd:'turnoverTwd',changePct:'changePct',volume:'volume'};
  if(keys[sort])rows.sort((a,b)=>(Number(b[keys[sort]])||0)-(Number(a[keys[sort]])||0));
  return {...snapshot.data,radar:rows.slice(0,limit),snapshotUpdatedAt:new Date(snapshot.savedAt).toISOString()};
 }
 if(endpoint==='research'){
  if(!snapshot.date||!Array.isArray(snapshot.stocks)||!snapshot.stocks.length)throw Error('Research snapshot incomplete');return snapshot;
 }
 const section=params.get('section')||'core';if(!['core','briefing','night'].includes(section))return null;
 const data=acceptHomeSection(section,section==='briefing'?withOfficialTaiwanClose(snapshot.briefing,snapshot.core):snapshot[section]),status=snapshot[section+'Status'];
 if(!data||!status?.checkedAt)throw Error('Home section unavailable');
 return {...status,section,data,refreshed:false};
}
