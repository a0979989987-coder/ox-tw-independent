(() => {
  const version='20261012-startup1';
  const base=document.currentScript?.src||new URL('src/app/module-boot.js',location.href).href;
  const host=document.getElementById('market-unavailable-card');
  // preferences.js resolved the theme before paint. Start light-only sheets now,
  // in parallel with the runtime, instead of when the runtime applies the theme.
  if(document.documentElement?.style?.colorScheme==='light')document.querySelectorAll('link[data-ox-light-href]').forEach(link=>{if(!link.getAttribute('href')){link.dataset.oxLightState='loading';link.addEventListener('load',()=>{link.dataset.oxLightState='loaded';},{once:true});link.addEventListener('error',()=>{link.dataset.oxLightState='error';},{once:true});link.setAttribute('href',link.dataset.oxLightHref);}});
  function deadline(task,label,ms=12000){let timer;return Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(label),{name:'TimeoutError'})),ms);})]).finally(()=>clearTimeout(timer));}
  let chartJob;
  globalThis.OXEnsureChart=()=>chartJob??=(async()=>{
    if(globalThis.LightweightCharts)return;
    for(let attempt=0;attempt<2;attempt++){
      let script;
      try {
        await deadline(()=>new Promise((resolve,reject)=>{
          script=document.createElement('script');script.async=true;
          script.src=new URL('../vendor/lightweight-charts-4.2.3.js?v='+version+(attempt?'&retry='+Date.now():''),base).href;
          script.onload=()=>globalThis.LightweightCharts?resolve():reject(Error('圖表元件未就緒'));
          script.onerror=()=>reject(Error('圖表元件連線失敗'));
          document.head.append(script);
        }),'圖表元件載入逾時',8000);
        return;
      } catch(error){script?.remove();if(attempt)throw error;}
    }
  })().catch(error=>{chartJob=null;throw error;});
  // The chart vendor is not needed for the first screen (official lists). Warm
  // it only after the runtime is ready and the main thread is idle, so it does
  // not compete with first-screen downloads; opening a chart still awaits it.
  const warmChart=()=>{const idle=globalThis.requestIdleCallback||(fn=>setTimeout(fn,1500));idle(()=>globalThis.OXEnsureChart().catch(()=>{}),{timeout:8000});};
  async function boot(){
    for(let attempt=0;attempt<2;attempt++){
      try{return await deadline(()=>import(new URL('../generated/app/runtime.js?v='+version+(attempt?'&retry='+Date.now():''),base).href),'介面下載逾時');}
      catch(error){
        if(globalThis.OXAppReady)return;
        if(attempt||!(error.name==='TimeoutError'||/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message)))throw error;
      }
    }
  }
  if(host&&!host.hasChildNodes()){
    host.setAttribute('aria-busy','true');
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在開啟台股…';host.append(status);
  }
  globalThis.OXRuntimeReady=boot().then(value=>{host?.removeAttribute('aria-busy');warmChart();return value;}).catch(error=>{
    if(globalThis.OXAppReady)return;
    // A runtime missing after a deploy means this HTML is stale: reload once.
    if(/dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error?.message||'')&&globalThis.OXAssetReload?.('runtime'))return;
    host?.removeAttribute('aria-busy');
    // The page keeps a failed chunk as failed: only a reload fetches it again.
    if(host){host.textContent='台股介面連線未完成，請重新載入。';const button=document.createElement('button');button.type='button';button.textContent='重新載入';button.onclick=()=>location.reload();host.append(button);}
    throw error;
  });
  globalThis.OXRuntimeReady.catch(()=>{});
})();
