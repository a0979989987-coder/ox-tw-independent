import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {TOOL_STYLES,newsAssets} from '../scripts/client-assets.mjs';
import {createStyleLoader} from '../src/components/style-resource.js';
import {createNewsLoader} from '../src/components/news/snapshot-request.js';
import {eventDay,upcomingEventDays} from '../src/components/news/model.js';

test('calendar boot is small without discarding any official events or news records',async()=>{
  const original=JSON.parse(await readFile(new URL('../data/news.json',import.meta.url)));
  const assets=newsAssets(original);
  assert.deepEqual(assets.calendar.events,original.events);
  assert.deepEqual(assets.calendar.eventCoverage,original.eventCoverage);
  assert.deepEqual(assets.feed.news,original.news);
  assert.deepEqual(assets.feed.pendingNews,original.pendingNews);
  assert.equal(assets.calendar.feedComplete,false);assert.equal(assets.feed.feedComplete,true);
  assert.deepEqual(assets.calendar.news,[]);
  assert(JSON.stringify(assets.calendar).length<JSON.stringify(original).length*.15);
  assert(JSON.stringify(assets.headline).length<1024);
});

test('published shadow styles are complete and do not need any extra network request',async t=>{
  const previousStyles=globalThis.OXStyleTexts,previousLocation=globalThis.location;
  t.after(()=>{if(previousStyles===undefined)delete globalThis.OXStyleTexts;else globalThis.OXStyleTexts=previousStyles;if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;});
  globalThis.location={origin:'https://example.test'};
  globalThis.OXStyleTexts=Object.fromEntries(await Promise.all(TOOL_STYLES.map(async p=>['/'+p,await readFile(new URL('../'+p,import.meta.url),'utf8')])));
  const load=createStyleLoader(()=>assert.fail('bundled CSS should not fetch'));
  for(const file of TOOL_STYLES)assert.equal(await load('https://example.test/ox-tw-independent/'+file+'?old-version=1'),globalThis.OXStyleTexts['/'+file]);
  assert(TOOL_STYLES.includes('src/markets/tw/radar-ui-light.css'));
  assert(TOOL_STYLES.includes('src/components/patterns/patterns-light.css'));
});

test('standalone CSS fallback evicts failures and reloads on retry',async()=>{
  const options=[];
  const load=createStyleLoader(async(url,opts)=>{options.push(opts);if(options.length===1)throw TypeError('network');return new Response('main{color:white}');},20);
  await assert.rejects(load('https://other.test/style.css'));
  assert.equal(await load('https://other.test/style.css'),'main{color:white}');
  assert.equal(options[1].cache,'reload');
  await load('https://other.test/style.css');assert.equal(options.length,2);
});

test('news retries connection and stalled body reads with a finite deadline',async()=>{
  const data={schemaVersion:1,news:[],events:[]};let calls=0;
  const load=createNewsLoader(async()=>{if(++calls===1)return {ok:true,json:()=>new Promise(()=>{})};return new Response(JSON.stringify(data));},5);
  assert.deepEqual(await load('/calendar'),data);assert.equal(calls,2);
  calls=0;await assert.rejects(createNewsLoader(async()=>{calls++;return new Promise(()=>{});},5)('/calendar'),{name:'TimeoutError'});assert.equal(calls,2);
  calls=0;await assert.rejects(createNewsLoader(async()=>{calls++;return new Response('',{status:403});},5)('/calendar'));assert.equal(calls,1);
});

test('cached event dates retain Taipei midnight boundaries and update when source values change',()=>{
  const event={occursAt:'2026-10-11T16:30:00Z',category:'macro',markets:['tw'],title:'Test'};
  assert.equal(eventDay(event),'2026-10-12');
  assert.equal(eventDay(event),'2026-10-12');
  event.occursAt='2026-10-12T16:30:00Z';assert.equal(eventDay(event),'2026-10-13');
  event.date='2026-10-14';assert.equal(eventDay(event),'2026-10-14');
  const state={categories:null,importance:null};
  assert.deepEqual(upcomingEventDays({events:[event]},'tw',state,'2026-10-12').map(d=>[d.date,d.events.length]),[['2026-10-12',0],['2026-10-14',1]]);
});

test('news model can be imported and searched when an older browser lacks Intl.Segmenter',async t=>{
  const saved=Intl.Segmenter;t.after(()=>{Intl.Segmenter=saved;});Intl.Segmenter=undefined;
  const module=await import('../src/components/news/model.js?compat-test');
  assert.equal(module.taipeiDay('2026-10-11T16:30:00Z'),'2026-10-12');
  assert(module.hotWords([{title:'AI 台積電',assets:[]}]).some(([word])=>word==='AI'));
});

test('runtime starts independently of a failed chart vendor and exposes a bounded retry',async()=>{
  const code=(await readFile(new URL('../src/app/module-boot.js',import.meta.url),'utf8')).replace('import(new URL(','__import(new URL(');
  for(const src of ['https://example.test/ox-tw-independent/src/app/module-boot.js','']){
  const children=[],attributes=new Map(),host={hasChildNodes:()=>false,setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),append:n=>children.push(n)};
  let imported=0,chartAttempts=0;
  const context=vm.createContext({URL,Error,Promise,Date,setTimeout,clearTimeout,location:new URL('https://example.test/ox-tw-independent/'),
    document:{currentScript:{src},getElementById:()=>host,createElement:()=>({setAttribute(){},remove(){}}),head:{append(script){chartAttempts++;assert.match(script.src,/\/ox-tw-independent\/src\/vendor\/lightweight-charts/);queueMicrotask(()=>script.onerror());}}},
    __import:async url=>{imported++;assert.match(url,/\/ox-tw-independent\/src\/generated\/app\/runtime.js/);return {ready:true};}});
  vm.runInContext(code,context);
  assert.deepEqual(await context.OXRuntimeReady,{ready:true});assert.equal(imported,1);assert(!attributes.has('aria-busy'));
  await assert.rejects(context.OXEnsureChart());assert(chartAttempts<=4);
  }
});

test('published boot/runtime versions match; first screen is small and tool CSS is a lazy chunk',async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const boot=await readFile(new URL('../dist/client/src/app/module-boot.js',import.meta.url),'utf8');
  const version=boot.match(/const version='([a-f0-9]{12})'/)?.[1];assert(version);
  assert(html.includes(`runtime-${version}.js?v=`+version));assert(html.includes("const version='"+version+"'"));
  assert(!/<script[^>]+src=/.test(html),'HTML must not wait for separate bootstrap/helper scripts');
  assert(!html.includes('<script src="src/vendor/lightweight-charts'));
  assert(!html.includes('src="src/components/news/center.js"'));
  const runtime=await readFile(new URL(`../dist/client/src/generated/app/runtime-${version}.js`,import.meta.url),'utf8');
  // The entry only imports the shared app chunk: retrying it cannot start the app twice.
  assert(runtime.length<4000);assert(!runtime.includes('switchAppView'));
  const preloads=[...html.matchAll(/<link rel="modulepreload" href="([^"?]+)/g)].map(m=>m[1]);
  let firstScreen=0;
  for(const path of preloads)firstScreen+=(await readFile(new URL('../dist/client/'+path,import.meta.url))).length;
  assert(firstScreen<450000,`first-screen JavaScript is ${firstScreen} bytes`);
  const chunks=await readdir(new URL('../dist/client/src/generated/app/chunks/',import.meta.url));
  const styleChunk=chunks.find(name=>name.startsWith('tool-styles-'));assert(styleChunk);
  assert(!preloads.some(path=>path.endsWith(styleChunk)),'tool CSS is not downloaded for the first screen');
  const styleText=await readFile(new URL('../dist/client/src/generated/app/chunks/'+styleChunk,import.meta.url),'utf8');
  for(const path of TOOL_STYLES)assert(styleText.includes('/'+path));
  for(const tool of ['workspace-','chart-radar-','savings-'])assert(chunks.some(name=>name.startsWith(tool))&&!preloads.some(path=>path.includes('/'+tool)),tool);
});

test('critical news and styled-content reveal cannot be parked behind a paused animation frame',async()=>{
  const center=await readFile(new URL('../src/components/news/center.js',import.meta.url),'utf8');
  assert.match(center,/queueMicrotask\(\(\)=>\{renderQueued=false;renderNow\(\)/);
  const styles=await readFile(new URL('../src/components/style-ready.js',import.meta.url),'utf8');
  assert(!styles.includes('requestAnimationFrame'));
});
