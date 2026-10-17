import { withDeadline } from './resource-deadline.js';
const failed = new Set();
const loaded = new Map();
const bundledTools=new Set(['/src/components/patterns/view.js','/src/markets/tw/patterns/source.js','/src/markets/tw/patterns/index-cache.js','/src/markets/tw/bubbles/view.js','/src/markets/tw/etf/view.js','/src/markets/tw/etf/savings.js']);
let attempt = 0;
const transient = error => error?.name === 'TimeoutError' ||
  error?.name === 'TypeError' && /fetch|dynamically imported module|importing a module script|load.*module|module.*load/i.test(error.message);
const switched = () => new DOMException('已切換工具','AbortError');
const importURL = url => import(url);
export function moduleKey(url){
  if(/^ox-[\w-]+$/.test(url))return url;
  const path=new URL(url).pathname,index=path.indexOf('/src/');
  return index<0?path:path.slice(index);
}
// A browser keeps a failed module fetch in the page's module map: importing
// the same URL again rejects at once, without any request. A retry therefore
// imports a new URL. A published build compiles import('./x.js') to one fixed
// chunk URL, so build.mjs lists those chunks (OXChunkURLs, relative to
// OXChunkBase) and the retry imports the chunk with a fresh query. Never fall
// back to the unbundled sources there: they would be a second copy of the app.
export function freshModuleURL(url,{chunks=globalThis.OXChunkURLs,base=globalThis.OXChunkBase}={}){
  const fresh=target=>{target.searchParams.set('oxImportRetry',`${Date.now()}-${++attempt}`);return target.href;};
  if(chunks&&typeof chunks==='object'){const chunk=chunks[moduleKey(url)];return chunk&&base?fresh(new URL(chunk,base)):null;}
  return /^ox-/.test(url)?null:fresh(new URL(url));
}
// Bound stalled imports too. After a failure each attempt, including a manual
// retry, imports a new fresh URL (a fresh URL that failed is remembered too).
// When fresh URLs fail as well, the failure is in a chunk the module imports
// (same URL for every importer), which only a new page can fetch again: the
// error carries oxReload so the screen offers a reload. Offline, a later
// in-page retry can still succeed.
async function loadModule(key,{load,retryURL=()=>null,current=()=>true,importer=importURL,pause=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000,online=()=>globalThis.navigator?.onLine!==false}={}){
  if(loaded.has(key))return loaded.get(key);
  let error;
  for(let retry=0;retry<2;retry++){
    if(!current())throw switched();
    const target=failed.has(key)?retryURL():null;
    try{const module=await withDeadline(()=>target?importer(target):load(),timeoutMs,'工具下載逾時');loaded.set(key,module);failed.delete(key);return module;}
    catch(cause){
      error=cause;
      if(!transient(cause)||!current())throw cause;
      failed.add(key);
      if(retry)break;
      await pause(250);
    }
  }
  if(online())try{error.oxReload=true;}catch{}
  throw error;
}
// Dynamic imports inside the app (K-line radar, screener, news workspace…).
// `load` is the literal import() the bundler compiles; `url` names the same
// module (new URL(specifier, import.meta.url)) for fresh-URL retries.
export function loadChunk(url,load,options={}){
  const original=String(url);
  return loadModule('chunk:'+moduleKey(original),{...options,load,retryURL:()=>freshModuleURL(original)});
}

export async function loadToolModule(url,options={}) {
  if(options.current&&!options.current())throw switched();
  const original=String(url),path=moduleKey(original),bundle=bundledTools.has(path);
  if(!bundle)return loadModule(original,{...options,load:()=>(options.importer||importURL)(original),retryURL:()=>freshModuleURL(original)});
  if(globalThis.OXToolModules)return globalThis.OXToolModules[path];
  // Published builds split each tool into its own chunk; import it on demand,
  // with the tool stylesheet chunk. Each one retries on its own, so a chunk
  // that loaded is never evaluated twice.
  const lazy=()=>{
    const tool=globalThis.OXToolLoaders?.[path];if(!tool)return null;
    const styles=globalThis.OXLoadToolStyles;
    return Promise.all([
      styles&&loadModule('ox-tool-styles',{...options,load:styles,retryURL:()=>freshModuleURL('ox-tool-styles')}),
      loadModule('ox-tool:'+path,{...options,load:tool,retryURL:()=>freshModuleURL(original)})
    ]).then(modules=>modules[1]);
  };
  const pending=lazy();if(pending)return pending;
  if(globalThis.OXRuntimeReady){await globalThis.OXRuntimeReady;if(options.current&&!options.current())throw switched();return globalThis.OXToolModules?.[path]||lazy()||Promise.reject(Error('市場介面尚未載入，請重新連線'));}
  throw Error('市場介面尚未載入，請重新連線');
}
