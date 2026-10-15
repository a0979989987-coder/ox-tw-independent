import handler from '../api/v1/tw/[endpoint].js';
import {readSnapshotAsset,snapshotEndpoint} from './snapshots.js';
import {refreshAuthorized} from '../api/v1/tw/refresh-auth.js';
const cache=new Map();
// The bundled API reads process.env (compiled to globalThis.__twEnv) and the
// asset shim reads globalThis.__twReadAsset. Only isolate-wide bindings go
// there, assigned when the binding object changes; anything that varies per
// request (such as this request's own origin) travels with the request.
let boundEnv=null;
export function bindIsolate(env){
 if(boundEnv===env)return;
 boundEnv=env;
 globalThis.__twEnv=Object.freeze({...env});
 globalThis.__twAssets=env.ASSETS;
 globalThis.__twReadAsset=path=>readSnapshotAsset(path,env.ASSETS);
}
// Verified snapshots are the same public data for every visitor.
export const SNAPSHOT_CACHE_CONTROL='public, max-age=60, s-maxage=300';
// refresh=1 bypasses caches only with the operator token header.
export const bypassesCache=(url,headers,env)=>url.searchParams.has('refresh')&&refreshAuthorized(headers,env);
export default {
 async fetch(request,env,ctx){
  const allowedOrigins=new Set([new URL(request.url).origin,'https://a0979989987-coder.github.io']);
  bindIsolate(env);
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')){
    const origin=request.headers.get('Origin');
    if(origin&&!allowedOrigins.has(origin))return Response.json({ok:false,error:{code:'ORIGIN_NOT_ALLOWED'}},{status:403});
    if(!/^\/api\/v1\/tw\/[a-z-]+$/.test(url.pathname))return Response.json({ok:false,error:{code:'ENDPOINT_NOT_FOUND'}},{status:404});
    const endpoint=url.pathname.split('/').at(-1),key=url.pathname+url.search+'|'+(origin||'');
    if(request.method==='GET'&&['radar','home','research'].includes(endpoint)){
      try{
        const data=await snapshotEndpoint(endpoint,url.searchParams,async path=>JSON.parse(new TextDecoder().decode(await readSnapshotAsset(path,env.ASSETS))));
        if(data){const h={'Cache-Control':SNAPSHOT_CACHE_CONTROL,'Vary':'Origin','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json; charset=utf-8'};if(origin)h['Access-Control-Allow-Origin']=origin;
          return Response.json({ok:true,data,meta:{provider:'independent-verified-snapshot',realtime:false}},{headers:h});}
      }catch(error){console.warn('Snapshot fallback',endpoint,error.message);}
    }
    const saved=cache.get(key);if(request.method==='GET'&&endpoint!=='outlook'&&!bypassesCache(url,request.headers,env)&&saved&&Date.now()-saved.time<60000)return new Response(saved.body,{status:saved.status,headers:saved.headers});
    const headers=Object.fromEntries(request.headers);headers.host=url.host;headers['x-forwarded-host']=url.host;
    let body;if(request.method==='POST')try{body=await request.json();}catch{return Response.json({error:'INVALID_JSON'},{status:400});}
    const req={method:request.method,headers,query:{...Object.fromEntries(url.searchParams),endpoint},body,url:request.url,allowedOrigins:[...allowedOrigins]};
    const responseHeaders=new Headers();let status=200,result='';
    const res={setHeader(k,v){responseHeaders.set(k,v);},status(s){status=s;return this;},json(data){responseHeaders.set('Content-Type','application/json; charset=utf-8');result=JSON.stringify(data);return this;},end(data=''){result=data;return this;}};
    try{await handler(req,res);}catch(error){console.error('Taiwan API',endpoint,error.message);return Response.json({ok:false,error:{code:'TW_DATA_SERVER_ERROR',message:'台股資料暫時無法取得'}},{status:503});}
    if(request.method==='GET'&&status===200&&endpoint!=='outlook'){if(cache.size>60)cache.delete(cache.keys().next().value);cache.set(key,{body:result,status,headers:responseHeaders,time:Date.now()});}
    return new Response(result||null,{status,headers:responseHeaders});
  }
  if(!env.ASSETS)return new Response('Site assets unavailable',{status:503});
  return env.ASSETS.fetch(request);
 }
};
