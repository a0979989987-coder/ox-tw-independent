import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {awaitBundleSymbol,preloadBundle,bundleEntry} from '../src/markets/tw/patterns/bundle.js';
test('selected stock becomes available while the remaining market chunks are still pending',async t=>{
 const manifest=JSON.parse(await readFile(new URL('../data/tw-patterns/manifest.json',import.meta.url)));
 const payload=JSON.parse(gunzipSync(await readFile(new URL('../data/tw-patterns/'+manifest.chunks[0].file,import.meta.url))));
 const [first,second]=payload.entries;let release;
 const blocked=new Promise(resolve=>release=resolve);
 t.mock.method(globalThis,'fetch',async input=>{
  const path=new URL(input).pathname;
  if(path.endsWith('manifest.json'))return Response.json({...manifest,total:2,classified:2,chunks:[{file:'daily-0.json',count:1},{file:'daily-1.json',count:1}]});
  if(path.endsWith('daily-1.json'))await blocked;
  return Response.json({...payload,entries:[path.endsWith('daily-0.json')?first:second]});
 });
 const selected=awaitBundleSymbol(first.data.symbol);let finished=false;
 const all=preloadBundle().then(()=>finished=true);
 await selected;assert(bundleEntry(first.data.symbol));assert.equal(finished,false);
 release();await all;assert(bundleEntry(second.data.symbol));
});

test('selected stock bypasses blocked background chunks and shares the requested download',async t=>{
 const module=await import('../src/markets/tw/patterns/bundle.js?priority');
 const manifest=JSON.parse(await readFile(new URL('../data/tw-patterns/manifest.json',import.meta.url)));
 const payload=JSON.parse(gunzipSync(await readFile(new URL('../data/tw-patterns/'+manifest.chunks[0].file,import.meta.url))));
 const entries=payload.entries.slice(0,3);let release;const blocked=new Promise(resolve=>release=resolve),calls=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const path=new URL(input).pathname;
  if(path.endsWith('manifest.json'))return Response.json({...manifest,total:3,classified:3,chunks:entries.map((e,i)=>({file:`daily-${i}.json`,count:1,symbols:[e.data.symbol]}))});
  const index=Number(path.match(/daily-(\d+)\.json/)[1]);calls.push(index);if(index<2)await blocked;
  return Response.json({...payload,entries:[entries[index]]});
 });
 let complete=false;const all=module.preloadBundle().then(()=>complete=true);
 try{
  await Promise.all([module.awaitBundleSymbol(entries[2].data.symbol),module.awaitBundleSymbol(entries[2].data.symbol)]);
  assert(module.bundleEntry(entries[2].data.symbol));assert.equal(complete,false);assert.equal(calls.filter(i=>i===2).length,1);
 }finally{release();await all;}
 assert.equal(calls.filter(i=>i===2).length,1);
});

test('retry only downloads failed chunks and a broken UI listener cannot fail data loading',async t=>{
 const module=await import('../src/markets/tw/patterns/bundle.js?retry-chunks');
 const manifest=JSON.parse(await readFile(new URL('../data/tw-patterns/manifest.json',import.meta.url)));
 const payload=JSON.parse(gunzipSync(await readFile(new URL('../data/tw-patterns/'+manifest.chunks[0].file,import.meta.url))));
 const entries=payload.entries.slice(0,2),calls=[0,0];let fail=true;
 t.mock.method(console,'warn',()=>{});
 const stop=module.subscribeBundle(()=>{throw Error('detached UI');});
 t.mock.method(globalThis,'fetch',async input=>{
  const path=new URL(input).pathname;
  if(path.endsWith('manifest.json'))return Response.json({...manifest,total:2,classified:2,chunks:entries.map((e,i)=>({file:`daily-${i}.json`,count:1,symbols:[e.data.symbol]}))});
  const index=Number(path.match(/daily-(\d+)\.json/)[1]);calls[index]++;if(index===1&&fail)throw Error('temporary failure');
  return Response.json({...payload,entries:[entries[index]]});
 });
 try{await module.preloadBundle();assert.equal(module.bundleState().failed,1);fail=false;await module.preloadBundle({force:true});
 assert.deepEqual(calls,[1,2]);assert.equal(module.bundleState().classified,2);assert.equal(module.bundleState().failed,0);
 }finally{stop();}
});
