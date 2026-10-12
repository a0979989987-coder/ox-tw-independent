import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {createBundleComputer} from '../src/markets/tw/patterns/bundle-compute.js';
import {qualifyBundleEntry,qualifyBundleEntryCooperatively} from '../src/markets/tw/patterns/qualification.js';
import {classifyTWSeries} from '../src/markets/tw/classic.js';
import {qualifyPatternMatches} from '../src/components/patterns/matcher.js';
import {aggregateCandles} from '../src/markets/tw/patterns/model.js';
import {formatNewsTime} from '../src/components/news/model.js';

const manifest=JSON.parse(await readFile(new URL('../data/tw-patterns/manifest.json',import.meta.url)));
const payload=JSON.parse(gunzipSync(await readFile(new URL('../data/tw-patterns/'+manifest.chunks[0].file,import.meta.url))));
const entry=payload.entries[0], date=manifest.date, now=Date.parse(date+'T08:00:00Z');
function original(entry){
  const qualify=(candles,frame,matches)=>{const classic=classifyTWSeries(candles,frame);return {classic,matches:qualifyPatternMatches({candles,classic,volatility:classic.long.atr||classic.short.atr||0},matches)};};
  return {...qualify(entry.data.candles,'1D',entry.matches),frames:Object.fromEntries(Object.entries(entry.frames||{}).map(([frame,value])=>[frame,qualify(aggregateCandles(entry.data.candles,frame,date,now),frame,value.matches)]))};
}

test('moving classification off the UI thread retains every daily and aggregate grade',t=>{
  t.mock.method(Date,'now',()=>now);
  for(const value of payload.entries.slice(0,8))assert.deepEqual(qualifyBundleEntry(value,date,now),original(value));
  assert.throws(()=>qualifyBundleEntry({...entry,data:{...entry.data,dataDate:'1999-01-01'}},date,now),/格式異常/);
});

test('compiled browser worker computes in a real background thread without invoking the UI fallback',async t=>{
  t.mock.method(Date,'now',()=>now);
  const script=await readFile(new URL('../dist/client/src/generated/tw-bundle-worker.js',import.meta.url),'utf8');
  const thread=new ThreadWorker(`const {parentPort}=require('node:worker_threads');Date.now=()=>${now};const self={postMessage:data=>parentPort.postMessage(data)};${script};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
  t.after(()=>thread.terminate());
  const adapter={postMessage:data=>thread.postMessage(data),terminate:()=>thread.terminate()};
  thread.on('message',data=>adapter.onmessage({data}));thread.on('error',error=>adapter.onerror(error));
  let calls=0;
  const compute=createBundleComputer({workerFactory:()=>{calls++;return adapter;},fallback:()=>assert.fail('Worker must do the classification')});
  const results=await Promise.all(payload.entries.slice(0,3).map(value=>compute(value,date,now)));
  assert.equal(calls,1);
  results.forEach((result,index)=>assert.deepEqual(result,original(payload.entries[index])));
});

test('worker startup failure and a stalled worker recover once without leaving queued jobs pending',async()=>{
  let factories=0,fallbacks=0,terminated=0;
  const fallback=async value=>{fallbacks++;return value.key;};
  const blocked=createBundleComputer({workerFactory:()=>{factories++;throw Error('Unsupported webview');},fallback});
  assert.equal(await blocked(entry,date),entry.key);assert.equal(await blocked(entry,date),entry.key);assert.equal(factories,1);
  const stalled=createBundleComputer({workerFactory:()=>({postMessage(){},terminate(){terminated++;}}),fallback,timeoutMs:5});
  assert.deepEqual(await Promise.all([stalled(entry,date),stalled(entry,date)]),[entry.key,entry.key]);
  assert.equal(terminated,1);assert.equal(fallbacks,4);
  assert.equal(await stalled(entry,date),entry.key);assert.equal(terminated,1);
});

test('compatibility fallback yields between timeframes without losing classification results',async t=>{
  t.mock.method(Date,'now',()=>now);
  let yields=0;
  const result=await qualifyBundleEntryCooperatively(entry,date,now,async()=>{yields++;});
  assert.equal(yields,Object.keys(entry.frames).length+2);
  assert.deepEqual(result,original(entry));
});

test('published runtime requests the exact content-versioned worker',async()=>{
  const worker=await readFile(new URL('../dist/client/src/generated/tw-bundle-worker.js',import.meta.url));
  const version=createHash('sha256').update(worker).digest('hex').slice(0,12);
  const runtime=await readFile(new URL('../dist/client/src/generated/runtime.js',import.meta.url),'utf8');
  assert(runtime.includes('tw-bundle-worker.js?v='+version));
  assert(!runtime.includes('tw-bundle-worker.js?v=20261012-startup2'));
});

test('reused news timestamp formatter retains Taipei time and missing-value labels',()=>{
  const value='2026-10-11T16:30:00Z';
  const expected=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value));
  for(let index=0;index<100;index++)assert.equal(formatNewsTime(value),expected);
  assert.equal(formatNewsTime(undefined),'時間待確認');assert.equal(formatNewsTime('invalid'),'時間待確認');
});
