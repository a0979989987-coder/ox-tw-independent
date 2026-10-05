import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validRadarSnapshot,savedRadarSnapshot,saveRadarSnapshot,bundledRadarSnapshot} from '../src/markets/tw/radar-snapshot.js';
import {seedTWRadar,refreshTWMarketState,createTWMarketState} from '../src/markets/tw/engine.js';
import {twProvider} from '../src/markets/tw/api.js?v=20261005-recovery20';
twProvider.configure({apiBase:'https://taiwan.test/api'});
const published=JSON.parse(readFileSync(new URL('../data/tw-radar.json',import.meta.url),'utf8'));
test('cached TW membership is bounded by age, official date, calendar and complete source status',()=>{
 assert(validRadarSnapshot(published,published.savedAt));
 assert(!validRadarSnapshot(published,published.savedAt+8*86400000));
 assert(!validRadarSnapshot({...published,savedAt:published.savedAt+120000},published.savedAt));
 for(const data of [{...published.data,dataDate:'2026-09-29'},{...published.data,modesMeta:{...published.data.modesMeta,calendarReady:false}},{...published.data,modesMeta:{...published.data.modesMeta,risk:{status:'error'}}}])assert(!validRadarSnapshot({...published,data},published.savedAt));
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const fresh={...published,savedAt:Date.now()};assert(saveRadarSnapshot(fresh,storage));assert.deepEqual(savedRadarSnapshot(storage),fresh);
 assert.equal(savedRadarSnapshot({getItem(){throw Error('denied')}}),null);
});
test('TW renders verified risk membership while live radar waits, accepts the eventual fresh empty list and rejects an older seed',async t=>{
 const saved={...published,savedAt:Date.now()-1000};
 seedTWRadar(saved);assert.equal(createTWMarketState().data.radarModes.risk.length,published.data.modes.risk.length);assert(createTWMarketState().data.usingCachedRadar);
 let release;const radarWait=new Promise(r=>release=r);
 t.mock.method(globalThis,'fetch',async input=>{if(new URL(input).pathname.endsWith('/radar'))await radarWait;return new Response(JSON.stringify({ok:true,data:new URL(input).pathname.endsWith('/radar')?{...published.data,radar:[],modes:{risk:[],disposal:[],release:[]}}:{}}));});
 const pending=refreshTWMarketState({force:true});await Promise.resolve();
 assert.equal(createTWMarketState().data.radarModes.risk.length,published.data.modes.risk.length);
 release();const fresh=await pending;assert.equal(fresh.data.radarModes.risk.length,0);assert(!fresh.data.usingCachedRadar);
 assert.equal(seedTWRadar(saved),fresh);
});

test('bundled verified snapshot shares concurrent fetches and reuses success for only sixty seconds',async t=>{let now=Date.now(),calls=0,release;const paused=new Promise(r=>release=r);t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{calls++;if(calls===1)await paused;return new Response(JSON.stringify({...published,savedAt:now}));});const a=bundledRadarSnapshot(),b=bundledRadarSnapshot();assert.equal(a,b);release();const snapshot=await a;assert.equal(await bundledRadarSnapshot(),snapshot);assert.equal(calls,1);now+=61000;const next=await bundledRadarSnapshot();assert.equal(calls,2);assert.notEqual(next,snapshot);now+=61000;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('offline');});await assert.rejects(bundledRadarSnapshot());assert.equal(calls,3);});

test('a later download timestamp cannot replace a newer verified trading date in storage',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const newer={...published,savedAt:Date.now()-1000};assert(saveRadarSnapshot(newer,storage));
 const oldDate=new Date(published.data.dataDate+'T00:00:00Z');oldDate.setUTCDate(oldDate.getUTCDate()-1);const date=oldDate.toISOString().slice(0,10);
 const older={...published,savedAt:Date.now(),data:{...published.data,dataDate:date,modesMeta:{...published.data.modesMeta,asOf:date}}};
 assert(validRadarSnapshot(older));assert.equal(saveRadarSnapshot(older,storage),false);assert.equal(savedRadarSnapshot(storage).data.dataDate,published.data.dataDate);
});
