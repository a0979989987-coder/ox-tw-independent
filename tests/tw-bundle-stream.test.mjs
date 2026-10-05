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
