(() => {
  const version='20261012-controls2';
  async function chartLibrary(){
    if(globalThis.LightweightCharts)return;
    // Recover a failed vendor download without requiring a full page reload.
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timer=setTimeout(()=>{script.remove();reject(Error('圖表元件載入逾時'));},10000);
      script.src=new URL('../vendor/lightweight-charts-4.2.3.js?retry='+version,document.currentScript?.src||new URL('src/app/module-boot.js',location.href)).href;
      script.onload=()=>{clearTimeout(timer);globalThis.LightweightCharts?resolve():reject(Error('圖表元件尚未就緒'));};
      script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('圖表元件連線失敗'));};
      document.head.append(script);
    });
  }
  async function boot(){
    await chartLibrary();
    try{return await import('../generated/runtime.js?v=20261012-controls2');}
    catch(error){
      // Only retry a download failure. Re-running a partially executed module
      // after a code error could register duplicate event handlers.
      if(!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error?.message||''))throw error;
      return import('../generated/runtime.js?v=20261012-controls2&retry=1');
    }
  }
  globalThis.OXRuntimeReady=boot().catch(error=>{
    const host=document.getElementById('market-unavailable-card');host.textContent='台股工具暫時無法載入。';
    const button=document.createElement('button');button.textContent='重新連線';button.onclick=()=>location.reload();host.append(button);throw error;
  });
})();
