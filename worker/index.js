import handler from '../api/v1/tw/[endpoint].js';
const cache=new Map();
export default {
 async fetch(request,env,ctx){
  const allowedOrigins=new Set([new URL(request.url).origin,'https://a0979989987-coder.github.io']);
  globalThis.__twEnv={...env,OX_ALLOWED_ORIGINS:[...allowedOrigins].join(',')};
  globalThis.__twAssets=env.ASSETS;
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')){
    const origin=request.headers.get('Origin');
    if(origin&&!allowedOrigins.has(origin))return Response.json({ok:false,error:{code:'ORIGIN_NOT_ALLOWED'}},{status:403});
    if(!/^\/api\/v1\/tw\/[a-z-]+$/.test(url.pathname))return Response.json({ok:false,error:{code:'ENDPOINT_NOT_FOUND'}},{status:404});
    const endpoint=url.pathname.split('/').at(-1),key=url.pathname+url.search+'|'+(origin||'');
    const saved=cache.get(key);if(request.method==='GET'&&endpoint!=='outlook'&&!url.searchParams.has('refresh')&&saved&&Date.now()-saved.time<60000)return new Response(saved.body,{status:saved.status,headers:saved.headers});
    const headers=Object.fromEntries(request.headers);headers.host=url.host;headers['x-forwarded-host']=url.host;
    let body;if(request.method==='POST')try{body=await request.json();}catch{return Response.json({error:'INVALID_JSON'},{status:400});}
    const req={method:request.method,headers,query:{...Object.fromEntries(url.searchParams),endpoint},body,url:request.url};
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
