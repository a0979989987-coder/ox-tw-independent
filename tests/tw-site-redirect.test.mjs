import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
// The deployed bundle, where process.env is the Worker's own environment that
// lists the allowed origins (the raw source would read Node's environment).
import worker from '../dist/server/index.js';
import {PAGES_URL,redirectScript,withPagesRedirect} from '../scripts/site-redirect.mjs';

const REPO='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/';
const PAGES_ORIGIN='https://a0979989987-coder.github.io';
const forward=(hostname,search='',hash='')=>{const calls=[];
 vm.runInNewContext(redirectScript,{location:{hostname,search,hash,replace:url=>calls.push(url)}});return calls;};

test('the Sites page forwards to GitHub Pages first, keeping query and hash, with a no-script refresh',()=>{
 const html=withPagesRedirect('<!doctype html><html><head><meta charset="utf-8"><title>OX</title></head><body></body></html>');
 assert.match(html,/^<!doctype html><html><head><script data-ox-pages-redirect>/,'runs before any other head content');
 assert(html.includes(`<noscript><meta http-equiv="refresh" content="0; url=${PAGES_URL}"></noscript>`));
 assert.deepEqual(forward('ox-tw-independent.btcfly.chatgpt.site','?view=radar&symbol=8299','#chart'),[PAGES_URL+'?view=radar&symbol=8299#chart']);
 assert.deepEqual(forward('ox-tw-independent.btcfly.chatgpt.site'),[PAGES_URL]);
 for(const local of ['localhost','127.0.0.1','[::1]','ox.localhost'])assert.deepEqual(forward(local,'?a=1','#b'),[],local+' stays for local testing');
});

test('only the Sites build carries the forward; the GitHub Pages build does not',async()=>{
 const built=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
 const basePath=built.match(/name="ox-site-base-path" content="([^"]*)"/)?.[1];
 assert.equal(built.includes('data-ox-pages-redirect'),!basePath,`base path "${basePath}"`);
});

test('GitHub Pages can still read the Sites API across origins; other origins cannot',async t=>{
 const saved=await readFile(new URL('../data/tw-radar.json',import.meta.url));
 t.mock.method(globalThis,'fetch',async input=>{
  const url=String(input?.url??input);
  if(url===REPO+'data/tw-radar.json')return new Response(saved);
  return new Response('unavailable',{status:503});
 });
 const env={ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
 const call=(path,init={})=>worker.fetch(new Request('https://ox-tw-independent.btcfly.chatgpt.site/api/v1/tw/'+path,init),env,{});
 const pages={headers:{Origin:PAGES_ORIGIN}};
 const symbol=JSON.parse(saved).data.radar.find(row=>row.market==='TPEX').symbol;
 for(const path of [`quote?symbol=${symbol}`,'radar?limit=1','quote?symbol=9999']){
  const response=await call(path,pages);
  assert.equal(response.headers.get('access-control-allow-origin'),PAGES_ORIGIN,path);
  assert.match(response.headers.get('vary')||'',/Origin/,path);
  assert.notEqual(response.status,403,path);
 }
 const preflight=await call('candles?symbol=2330',{method:'OPTIONS',headers:{Origin:PAGES_ORIGIN,'Access-Control-Request-Method':'GET'}});
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),PAGES_ORIGIN);
 assert.match(preflight.headers.get('access-control-allow-methods'),/GET/);
 const foreign=await call(`quote?symbol=${symbol}`,{headers:{Origin:'https://example.com'}});
 assert.equal(foreign.status,403);assert.equal((await foreign.json()).error.code,'ORIGIN_NOT_ALLOWED');
 assert.equal(foreign.headers.get('access-control-allow-origin'),null);
});
