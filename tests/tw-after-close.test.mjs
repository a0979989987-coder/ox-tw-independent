import test from 'node:test';
import assert from 'node:assert/strict';
import {afterCloseSlot,createAfterCloseRefresh} from '../src/markets/tw/after-close.js';
import {retainResearchFlows} from '../server/markets/tw/research.js';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

test('Taipei close refresh waits until 13:35, follows five-minute publication windows and pauses on weekends',()=>{
  assert.equal(afterCloseSlot(new Date('2026-10-01T05:34:59Z')),null);
  assert.equal(afterCloseSlot(new Date('2026-10-01T05:35:00Z')),'2026-10-01:0');
  assert.equal(afterCloseSlot(new Date('2026-10-01T05:39:59Z')),'2026-10-01:0');
  assert.equal(afterCloseSlot(new Date('2026-10-01T05:40:00Z')),'2026-10-01:1');
  assert.equal(afterCloseSlot(new Date('2026-10-01T15:59:59Z')),'2026-10-01:96');
  assert.equal(afterCloseSlot(new Date('2026-10-01T16:00:00Z')),null);
  assert.equal(afterCloseSlot(new Date('2026-10-03T06:00:00Z')),null);
});
test('close refresh coalesces pending work, refreshes on return and never polls hidden/offline/inactive markets',async()=>{
  let now=new Date('2026-10-01T05:35:00Z'),active=true,visible=false,online=true,calls=0,finish,cleared=0;
  const refresh=createAfterCloseRefresh(()=>{calls++;return new Promise(r=>finish=r);},{now:()=>now,active:()=>active,visible:()=>visible,online:()=>online,setTimer:()=>1,clearTimer:()=>cleared++});
  refresh.start();await refresh.check();assert.equal(calls,0);
  visible=true;const pending=refresh.check();await Promise.resolve();assert.equal(calls,1);
  assert.equal(refresh.check(),pending);now=new Date('2026-10-01T05:40:00Z');assert.equal(refresh.check(),pending);
  finish();await pending;
  online=false;await refresh.check();assert.equal(calls,1);online=true;
  const second=refresh.check();await Promise.resolve();assert.equal(calls,2);finish();await second;
  await refresh.check();assert.equal(calls,2);
  active=false;now=new Date('2026-10-01T05:45:00Z');await refresh.check();assert.equal(calls,2);
  refresh.stop();assert.equal(cleared,1);active=true;await refresh.check();assert.equal(calls,2);
});
test('a failed close refresh remains eligible for retry within the same publication window',async()=>{
  let calls=0;
  const refresh=createAfterCloseRefresh(()=>{if(++calls===1)throw Error('temporary source outage');},{now:()=>new Date('2026-10-01T05:35:00Z'),setTimer:()=>1,clearTimer:()=>{}});
  refresh.start();await refresh.check();await refresh.check();assert.equal(calls,2);refresh.stop();
});
test('later institutional outages retain verified same-day amounts including zero, without carrying yesterday into a new close',()=>{
  const previous={date:'2026-10-01',stocks:[{symbol:'2330',market:'TWSE',netTwd:100,foreignTwd:0},{symbol:'6207',market:'TPEX',netTwd:-20}]};
  const snapshot={date:'2026-10-01',sourceHealth:{TWSE:{ok:false},TPEX:{ok:true}},stocks:[{symbol:'2330',market:'TWSE',price:150,netTwd:null,foreignTwd:null},{symbol:'6207',market:'TPEX',netTwd:30}]};
  const next=retainResearchFlows(structuredClone(snapshot),previous);
  assert.equal(next.stocks[0].netTwd,100);assert.equal(next.stocks[0].foreignTwd,0);assert.equal(next.stocks[0].price,150);assert.equal(next.sourceHealth.TWSE.stale,true);assert.equal(next.stocks[1].netTwd,30);
  assert.equal(retainResearchFlows({...snapshot,date:'2026-10-02'},previous).stocks[0].netTwd,null);
  assert.equal(retainResearchFlows({...snapshot,sourceHealth:{TWSE:{ok:true},TPEX:{ok:true}}},previous).stocks[0].netTwd,null);
});
test('forced research refresh can receive a newer deployed snapshot despite API failure and notifies an open bubble view',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
  let version=1;const requests=[];
  globalThis.fetch=async url=>{requests.push(String(url));return String(url).includes('data/tw-research.json')?{ok:true,json:async()=>({date:'2026-10-01',updatedAt:`2026-10-01T0${version}:00:00Z`,stocks:[{symbol:'2330',price:version}]})}:{ok:false};};
  try{
    const module=await import('../src/markets/tw/research-data.js?after-close-test');let changes=0;
    const stop=module.subscribeResearch(()=>changes++);
    await module.loadResearch({force:true});version=2;await module.loadResearch({force:true});
    assert.equal(module.savedResearch().stocks[0].price,2);assert.equal(changes,2);
    version=1;await module.loadResearch({force:true});assert.equal(module.savedResearch().stocks[0].price,2);
    assert.equal(requests.filter(url=>url.includes('data/tw-research.json')).length,3);
    assert(requests.filter(url=>!url.includes('data/tw-research.json')).every(url=>url.includes('refresh=1&t=')));stop();
  }finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
test('an official same-day classification revision reloads chunks instead of retaining the earlier close forever',async()=>{
  const originalFetch=globalThis.fetch;
  const manifest=JSON.parse(await readFile(new URL('../data/tw-patterns/manifest.json',import.meta.url),'utf8'));
  const payload=JSON.parse(gunzipSync(await readFile(new URL('../data/tw-patterns/'+manifest.chunks[0].file,import.meta.url))).toString());
  const entry=structuredClone(payload.entries[0]);let version=1,chunks=0;
  globalThis.fetch=async url=>String(url).includes('manifest.json')?{ok:true,json:async()=>({...manifest,updatedAt:'revision-'+version,classified:1,total:1,chunks:[{file:'daily-00.json',count:1}]})}:{ok:true,headers:{get:()=>null},json:async()=>{chunks++;return {date:manifest.date,algorithmVersion:5,entries:[{...entry,data:{...entry.data,revision:version},matches:{revision:version}}]};}};
  try{
    const module=await import('../src/markets/tw/patterns/bundle.js?revision-test');
    await module.preloadBundle({force:true,silent:true});assert.equal(chunks,1);
    await module.preloadBundle({force:true,silent:true});assert.equal(chunks,1);
    version=2;await module.preloadBundle({force:true,silent:true});assert.equal(chunks,2);
    assert.equal(module.bundleEntry(entry.data.symbol).data.revision,2);
  }finally{globalThis.fetch=originalFetch;}
});
