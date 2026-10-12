(() => {
  const version='20261012-startup1';
  const base=document.currentScript?.src||new URL('src/app/module-boot.js',location.href).href;
  const host=document.getElementById('market-unavailable-card');
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
  // A slow chart vendor must not prevent navigation, news or indicators opening.
  globalThis.OXEnsureChart().catch(()=>{});
  async function boot(){
    for(let attempt=0;attempt<2;attempt++){
      try{return await deadline(()=>import(new URL('../generated/runtime.js?v='+version+(attempt?'&retry='+Date.now():''),base).href),'介面下載逾時');}
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
  globalThis.OXRuntimeReady=boot().then(value=>{host?.removeAttribute('aria-busy');return value;}).catch(error=>{
    if(globalThis.OXAppReady)return;
    host?.removeAttribute('aria-busy');
    if(host){host.textContent='台股介面連線未完成，請重試。';const button=document.createElement('button');button.textContent='重新連線';button.onclick=()=>location.reload();host.append(button);}
    throw error;
  });
  globalThis.OXRuntimeReady.catch(()=>{});
})();
