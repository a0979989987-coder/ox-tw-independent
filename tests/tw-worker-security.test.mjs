import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {refreshAuthorized,constantTimeEqual,REFRESH_HEADER} from '../api/v1/tw/refresh-auth.js';
import worker,{bypassesCache,bindIsolate,SNAPSHOT_CACHE_CONTROL} from '../worker/index.js';

const TOKEN='a'.repeat(20)+'-operator-token';
test('refresh is authorized only by the operator token header, compared in constant time',()=>{
  assert.equal(refreshAuthorized({[REFRESH_HEADER]:TOKEN},{}),false,'no token configured');
  assert.equal(refreshAuthorized({[REFRESH_HEADER]:'short'},{OX_REFRESH_TOKEN:'short'}),false,'too short to be a secret');
  assert.equal(refreshAuthorized({},{OX_REFRESH_TOKEN:TOKEN}),false);
  assert.equal(refreshAuthorized({[REFRESH_HEADER]:TOKEN+'x'},{OX_REFRESH_TOKEN:TOKEN}),false);
  assert.equal(refreshAuthorized({[REFRESH_HEADER]:TOKEN},{OX_REFRESH_TOKEN:TOKEN}),true);
  assert.equal(refreshAuthorized(new Headers({[REFRESH_HEADER]:TOKEN}),{OX_REFRESH_TOKEN:TOKEN}),true);
  assert.equal(constantTimeEqual('abc','abd'),false);assert.equal(constantTimeEqual('abc','abc'),true);assert.equal(constantTimeEqual('abc','ab'),false);
  const url=new URL('https://w.test/api/v1/tw/radar?refresh=1');
  assert.equal(bypassesCache(url,new Headers(),{OX_REFRESH_TOKEN:TOKEN}),false,'refresh=1 alone never bypasses the cache');
  assert.equal(bypassesCache(url,new Headers({[REFRESH_HEADER]:TOKEN}),{OX_REFRESH_TOKEN:TOKEN}),true);
});

test('the API ignores an unauthenticated refresh instead of forcing upstream requests',async()=>{
  const source=await readFile(new URL('../api/v1/tw/[endpoint].js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/booleanParam\(req\.query\.refresh/);
  assert.equal((source.match(/[=:]\s*refreshRequested\(req\)/g)||[]).length,3,"research, etf and home use the gated flag");
});

// Fixed copy of a real home snapshot (tests/fixtures), not the daily data/.
const home=await readFile(new URL('./fixtures/tw-home-sample.json',import.meta.url));
const env={ASSETS:{fetch:async request=>new URL(request.url).pathname==='/data/tw-home.json'?new Response(home):new Response('',{status:404})},OX_REFRESH_TOKEN:TOKEN};
test('verified snapshot responses are publicly cacheable and still vary by Origin',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw Error('offline');});
  const response=await worker.fetch(new Request('https://w.test/api/v1/tw/home?section=core',{headers:{Origin:'https://w.test'}}),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),SNAPSHOT_CACHE_CONTROL);
  assert.equal(response.headers.get('Vary'),'Origin');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://w.test');
  const body=await response.json();assert.equal(body.ok,true);assert.equal(body.data.section,'core');
});

test('concurrent requests do not overwrite each other through a shared global environment',async()=>{
  bindIsolate(env);const shared=globalThis.__twEnv;
  assert.ok(Object.isFrozen(shared));assert.equal(shared.OX_ALLOWED_ORIGINS,undefined,'no request origin stored globally');
  const call=host=>worker.fetch(new Request(`https://${host}/api/v1/tw/health`,{headers:{Origin:`https://${host}`}}),env);
  const [a,b]=await Promise.all([call('a.test'),call('b.test')]);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal(a.headers.get('Access-Control-Allow-Origin'),'https://a.test');
  assert.equal(b.headers.get('Access-Control-Allow-Origin'),'https://b.test');
  assert.equal(globalThis.__twEnv,shared,'isolate bindings are assigned once, not per request');
  // A foreign origin is still rejected.
  const denied=await worker.fetch(new Request('https://a.test/api/v1/tw/health',{headers:{Origin:'https://evil.test'}}),env);
  assert.equal(denied.status,403);
});
