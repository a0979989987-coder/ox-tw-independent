import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,relative} from 'node:path';
import worker from '../dist/server/index.js';
const root=resolve(import.meta.dirname,'../dist/client');
const flag=process.argv.indexOf('--port'),port=Number(flag>=0?process.argv[flag+1]:process.env.PORT)||4173;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const env={ASSETS:{async fetch(request){
  const url=new URL(typeof request==='string'?request:request.url),path=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),file=resolve(root,'.'+path),rel=relative(root,file);
  if(rel.startsWith('..')||rel.split('/').some(p=>p.startsWith('.')))return new Response('Not found',{status:404});
  try{await stat(file);return new Response(await readFile(file),{headers:{'Content-Type':mime[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}}};
createServer(async(req,res)=>{
 try{
  const headers=new Headers(Object.entries(req.headers).filter(([,v])=>typeof v==='string'));
  const chunks=[];if(!['GET','HEAD'].includes(req.method))for await(const c of req)chunks.push(c);
  const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...chunks.length?{body:Buffer.concat(chunks)}:{}});
  const response=await worker.fetch(request,env,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error.message);res.writeHead(500);res.end('Unavailable');}
}).listen(port,'0.0.0.0',()=>console.log(`Local: http://localhost:${port}/`));
