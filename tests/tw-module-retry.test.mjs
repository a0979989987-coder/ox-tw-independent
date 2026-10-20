import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {loadToolModule,loadChunk,freshModuleURL} from '../src/components/load-tool-module.js?module-retry';
import {reloadOnce,needsReload} from '../src/components/tool-load-error.js?module-retry';

const site='https://a0979989987-coder.github.io/ox-tw-independent/';
const base=site+'src/generated/app/runtime-0123456789ab.js?v=0123456789ab';
const missing=()=>Object.assign(new TypeError('Failed to fetch dynamically imported module: '+site+'src/generated/app/chunks/x.js'));
function published(t,chunks){
  Object.assign(globalThis,{OXChunkURLs:chunks,OXChunkBase:base});
  t.after(()=>{delete globalThis.OXChunkURLs;delete globalThis.OXChunkBase;delete globalThis.OXToolLoaders;delete globalThis.OXLoadToolStyles;});
}

test('a failed chunk is retried under a fresh URL of the same published chunk',async t=>{
  published(t,{'/src/markets/tw/bubbles/view.js':'chunks/view-AAAA.js','ox-tool-styles':'chunks/tool-styles-BBBB.js'});
  const tool={mountTWBubbles(){}},imported=[];let first=0,styles=0;
  globalThis.OXToolLoaders={'/src/markets/tw/bubbles/view.js':async()=>{first++;throw missing();}};
  globalThis.OXLoadToolStyles=async()=>{styles++;};
  const module=await loadToolModule(site+'src/markets/tw/bubbles/view.js?v=1',{pause:()=>{},importer:async url=>{imported.push(url);return tool;}});
  assert.equal(module,tool);assert.equal(first,1);
  assert.equal(imported.length,1);
  assert.match(imported[0],/^https:\/\/a0979989987-coder\.github\.io\/ox-tw-independent\/src\/generated\/app\/chunks\/view-AAAA\.js\?oxImportRetry=\d+-\d+$/);
  assert.equal(styles,1,'the style chunk that loaded is not imported again');
});

test('the style chunk retries on its own; a tool chunk that loaded is not evaluated twice',async t=>{
  published(t,{'/src/markets/tw/etf/savings.js':'chunks/savings-CCCC.js','ox-tool-styles':'chunks/tool-styles-DDDD.js'});
  const tool={mountSavings(){}},imported=[];let toolLoads=0,styleLoads=0;
  globalThis.OXToolLoaders={'/src/markets/tw/etf/savings.js':async()=>{toolLoads++;return tool;}};
  globalThis.OXLoadToolStyles=async()=>{styleLoads++;throw missing();};
  // A separate module instance: the first test already loaded the style chunk.
  const {loadToolModule}=await import('../src/components/load-tool-module.js?module-retry-styles');
  assert.equal(await loadToolModule(site+'src/markets/tw/etf/savings.js',{pause:()=>{},importer:async url=>{imported.push(url);return {};}}),tool);
  assert.equal(toolLoads,1);assert.equal(styleLoads,1);
  assert.equal(imported.length,1);assert.match(imported[0],/chunks\/tool-styles-DDDD\.js\?oxImportRetry=/);
});

test('when the fresh URL fails too, the error asks for a reload (online only)',async t=>{
  published(t,{'/src/markets/tw/chart-radar.js':'chunks/chart-radar-EEEE.js','/src/markets/tw/screener/view.js':'chunks/view-FFFF.js'});
  const fails=async()=>{throw missing();};
  const online=await loadChunk(site+'src/markets/tw/chart-radar.js?v=1',fails,{pause:()=>{},importer:fails}).catch(error=>error);
  assert(needsReload(online),'a chunk the module imports failed: only a new page can fetch it');
  const offline=await loadChunk(site+'src/markets/tw/screener/view.js?v=1',fails,{pause:()=>{},importer:fails,online:()=>false}).catch(error=>error);
  assert(offline instanceof TypeError);assert(!needsReload(offline),'offline, an in-page retry can still work later');
  // A manual retry imports another fresh URL rather than the failed one.
  const urls=[];const ok={ready:true};
  assert.equal(await loadChunk(site+'src/markets/tw/screener/view.js?v=1',fails,{pause:()=>{},importer:async url=>{urls.push(url);return ok;}}),ok);
  assert.equal(urls.length,1);assert.match(urls[0],/chunks\/view-FFFF\.js\?oxImportRetry=/);
  // Errors that are not network failures are not retried or marked.
  const syntax=await loadChunk(site+'src/components/news/workspace.js',async()=>{throw new SyntaxError('Unexpected token');},{pause:()=>{}}).catch(error=>error);
  assert(syntax instanceof SyntaxError&&!needsReload(syntax));
});

test('a published build never retries through the unbundled source tree',()=>{
  assert.equal(freshModuleURL(site+'src/markets/tw/unknown.js',{chunks:{},base}),null);
  assert.match(freshModuleURL(site+'src/markets/tw/unknown.js?v=2',{chunks:undefined,base:undefined}),/unknown\.js\?v=2&oxImportRetry=/,'source mode re-imports the module itself');
});

test('the automatic reload happens once per build and tab, and never without sessionStorage',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let reloads=0;const reload=()=>reloads++;
  assert.equal(reloadOnce({storage,build:'aaa',reload}),true);
  assert.equal(reloadOnce({storage,build:'aaa',reload}),false,'no loop within one build');
  assert.equal(reloadOnce({storage,build:'bbb',reload}),true,'a newer build may recover once');
  assert.equal(reloads,2);
  assert.equal(reloadOnce({storage:{getItem(){throw new DOMException('denied','SecurityError');}},build:'ccc',reload}),false);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new DOMException('denied','SecurityError');}});
  try{assert.equal(reloadOnce({build:'ddd',reload}),false,'a throwing sessionStorage getter is safe');}
  finally{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage;}
  assert.equal(reloads,2);
});

test('the published runtime maps every dynamic import to its chunk',async()=>{
  const dir=new URL('../dist/client/src/generated/app/',import.meta.url);
  const runtime=(await readdir(dir)).find(name=>/^runtime-[a-f0-9]{12}\.js$/.test(name));
  const code=await readFile(new URL(runtime,dir),'utf8');
  const chunks=JSON.parse(code.match(/OXChunkURLs=(\{[^}]*\})/)?.[1]||'null');
  assert(chunks,'chunk map present');
  for(const key of ['ox-tool-styles','/src/markets/tw/chart-radar.js','/src/markets/tw/screener/view.js','/src/components/news/workspace.js','/src/markets/tw/bubbles/view.js','/src/markets/tw/etf/savings.js','/src/markets/tw/savings/view.js','/src/markets/tw/api.js'])
    assert(chunks[key],key);
  const files=new Set(await readdir(new URL('chunks/',dir)));
  for(const path of Object.values(chunks))assert(files.has(path.replace(/^chunks\//,'')),path);
  // Every import() in the published chunks targets a mapped chunk.
  const mapped=new Set(Object.values(chunks).map(path=>path.replace(/^chunks\//,'')));
  for(const name of files){
    if(!name.endsWith('.js'))continue;
    for(const [,target] of (await readFile(new URL('chunks/'+name,dir),'utf8')).matchAll(/import\("\.\/([\w-]+\.js)"\)/g))assert(mapped.has(target),`${name} → ${target}`);
  }
});
