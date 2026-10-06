import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {snapshotEndpoint,readSnapshotAsset} from '../worker/snapshots.js';
import {seedTWRadar,refreshTWMarketState} from '../src/markets/tw/engine.js';
import {twProvider} from '../src/markets/tw/api.js?v=20261005-recovery20';
const saved=JSON.parse(await readFile(new URL('../data/tw-radar.json',import.meta.url)));
test('partial source HTTP success cannot erase complete official risk membership',async t=>{
 twProvider.configure({apiBase:'https://tw.test/api'});seedTWRadar({...saved,savedAt:Date.now()-1000});
 t.mock.method(globalThis,'fetch',async input=>{
  const partial={...saved.data,modes:{...saved.data.modes,risk:saved.data.modes.risk.slice(0,64)},modesMeta:{...saved.data.modesMeta,risk:{status:'partial'}}};
  return Response.json({ok:true,data:String(input).includes('/radar')?partial:{}});
 });
 const state=await refreshTWMarketState({force:true});assert.equal(state.data.radarModes.risk.length,saved.data.modes.risk.length);
 assert.equal(state.data.meta.sourceErrors.radar.code,'TW_RADAR_INCOMPLETE_SOURCES');assert(state.data.usingCachedRadar);
});
test('API uses independently published dates and keeps all disposition modes despite quote pagination',async()=>{
 const data=await snapshotEndpoint('radar',new URLSearchParams('limit=2'),async()=>saved);
 assert.equal(data.radar.length,2);assert.equal(data.modes.risk.length,saved.data.modes.risk.length);
 assert.equal(data.snapshotUpdatedAt,new Date(saved.savedAt).toISOString());
 const partial={...saved,data:{...saved.data,modesMeta:{...saved.data.modesMeta,disposal:{status:'partial'}}}};
 await assert.rejects(snapshotEndpoint('radar',new URLSearchParams(),async()=>partial));
});
test('data reads only the independent repository; outages retain previously verified bytes',async()=>{
 let calls=0,fail=false;const assets={fetch(){assert.fail('valid repository data must not fall back to an older bundled copy');}};
 const fetcher=async url=>{assert.equal(url,'https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/data/test.json');calls++;if(fail)throw Error('offline');return Response.json({date:'2026-10-06'});};
 const first=await readSnapshotAsset('data/test.json',assets,{fetcher,now:100000});
 assert.equal(await readSnapshotAsset('data/test.json',assets,{fetcher,now:100001}),first);assert.equal(calls,1);
 fail=true;assert.equal(await readSnapshotAsset('data/test.json',assets,{fetcher,now:200000}),first);
 await assert.rejects(readSnapshotAsset('../other/data.json',assets,{fetcher}));
});
